import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  CoderAgent,
  CoderEvent,
  CoderProposal,
} from "../ai/agents/coder.agent";
import { PrismaService } from "../core/prisma.service";
import { RedactionService } from "../redaction/redaction.service";
import { S3Service } from "../core/s3.service";
import { extractPdfTextFromBuffer } from "../coverage/scripts/_pdf-chunker";

/**
 * Divider we insert between the clinical note and the face sheet
 * BEFORE redacting. Redaction runs once on the combined string, so
 * token counters (e.g. [NAME_1], [DOB_1]) stay consistent across
 * both blocks — which matters because the same patient typically
 * appears in both. After redaction we split on the divider and pass
 * each half to the agent as a labeled section. The divider string
 * is purely ASCII and does not match any redaction pattern, so it
 * survives redact() unchanged.
 */
const NOTE_FACESHEET_DIVIDER = "\n\n===HANNA_FS_BOUNDARY_c9f2===\n\n";

// Cheap heuristic for the risk band when the model forgets it.
function deriveBand(score: number): "LOW" | "REVIEW" | "RISK" {
  if (score <= 25) return "LOW";
  if (score <= 60) return "REVIEW";
  return "RISK";
}

// How often, at most, we flush the reasoning buffer to the DB while
// the agent is running. Anything shorter than poll-interval is wasted
// writes; anything longer means the live view lags behind reality.
const REASONING_FLUSH_MS = 1500;

@Injectable()
export class CodingService {
  private readonly logger = new Logger(CodingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    private readonly coder: CoderAgent,
    private readonly redaction: RedactionService,
  ) {}

  /**
   * Synchronous enqueue — creates an IN_PROGRESS row, kicks off the
   * background run, and returns fast. This is the handler the HTTP
   * controller calls; it stays well under Cloudflare's 100s cap.
   *
   * The background run updates the SAME row when it finishes (DRAFT
   * with the proposal, or FAILED with an errorMessage). The UI polls
   * `getLatestForEncounter` for progress + terminal state.
   */
  async enqueueGeneration(encounterId: number): Promise<{
    coding: { id: number; status: string };
  }> {
    const encounter = await this.prisma.encounter.findUnique({
      where: { id: encounterId },
      select: { id: true, providerNote: true },
    });
    if (!encounter)
      throw new NotFoundException(`Encounter ${encounterId} not found`);
    if (!encounter.providerNote) {
      throw new BadRequestException(
        `Encounter ${encounterId} has no signed provider note yet`,
      );
    }

    const coding = await this.prisma.encounterCoding.create({
      data: {
        encounterId,
        status: "IN_PROGRESS",
        basedOnNoteVersion: "SIGNED",
        startedAt: new Date(),
        reasoningLog: [],
      },
      select: { id: true, status: true },
    });

    // Fire-and-forget. We intentionally do NOT await — the whole
    // point of the async path is that the HTTP response returns
    // before the agent completes. Errors are captured inside
    // runGeneration and written to the row's errorMessage field.
    //
    // Wrapped in a microtask via setImmediate so we also don't
    // block even for the few ms it takes to set up the run.
    setImmediate(() => {
      void this.runGeneration(coding.id).catch((err) => {
        // runGeneration catches its own errors and writes FAILED
        // to the row. If it throws past that, something is very
        // wrong — log but don't crash the process.
        this.logger.error(
          `Unhandled error in runGeneration(${coding.id}): ${(err as Error).message}`,
          (err as Error).stack,
        );
      });
    });

    return { coding };
  }

  /**
   * Background worker — runs the agent against an already-created
   * IN_PROGRESS row. Streams reasoning events into reasoningLog as
   * the agent progresses (debounced), then terminally marks the row
   * DRAFT or FAILED.
   *
   * Exported so tests / scripts can drive it synchronously; the
   * normal flow goes through enqueueGeneration.
   */
  async runGeneration(codingId: number): Promise<void> {
    const coding = await this.prisma.encounterCoding.findUnique({
      where: { id: codingId },
      select: {
        id: true,
        encounterId: true,
        status: true,
      },
    });
    if (!coding) {
      this.logger.warn(`runGeneration: coding ${codingId} not found`);
      return;
    }
    if (coding.status !== "IN_PROGRESS") {
      this.logger.warn(
        `runGeneration: coding ${codingId} is ${coding.status}, refusing to run`,
      );
      return;
    }

    const encounter = await this.prisma.encounter.findUnique({
      where: { id: coding.encounterId },
      include: {
        patient: { select: { emrSystem: true, facility: true } },
        doctor: {
          select: {
            specialty: true,
            specialtyRel: {
              select: { name: true, systemPrompt: true },
            },
            practiceId: true,
            practice: {
              select: { id: true, name: true, systemPrompt: true },
            },
          },
        },
      },
    });
    if (!encounter || !encounter.providerNote) {
      await this.markFailed(
        codingId,
        `Encounter ${coding.encounterId} has no provider note`,
      );
      return;
    }

    this.logger.log(
      `runGeneration(${codingId}) — encounter=${coding.encounterId}, note=${encounter.providerNote}`,
    );

    const t0 = Date.now();

    // Reasoning buffer + debounced flush. The agent emits events
    // synchronously as it streams; we accumulate and UPDATE at
    // most once per REASONING_FLUSH_MS so we don't hammer the DB.
    const events: CoderEvent[] = [];
    let dirty = false;
    let lastFlush = 0;
    const flushIfDirty = async (force = false) => {
      if (!dirty) return;
      const now = Date.now();
      if (!force && now - lastFlush < REASONING_FLUSH_MS) return;
      lastFlush = now;
      dirty = false;
      const snapshot = [...events];
      try {
        await this.prisma.encounterCoding.update({
          where: { id: codingId },
          data: {
            reasoningLog:
              snapshot as unknown as import("@prisma/client").Prisma.InputJsonValue,
          },
        });
      } catch (err) {
        // A failed progress-flush isn't fatal — the final flush
        // at the end of the run will retry with the full log.
        this.logger.warn(
          `Progress flush failed for ${codingId}: ${(err as Error).message}`,
        );
      }
    };
    // Background ticker to flush while the agent is working even if
    // no new events arrive briefly. Cleared in finally.
    const ticker = setInterval(() => {
      void flushIfDirty();
    }, REASONING_FLUSH_MS);

    try {
      const noteBuffer = await this.s3.downloadBuffer(encounter.providerNote);
      const rawNoteText = await extractPdfTextFromBuffer(noteBuffer);
      if (!rawNoteText || rawNoteText.length < 50) {
        throw new Error(
          `Provider note PDF produced no usable text (got ${rawNoteText.length} chars)`,
        );
      }

      // Face sheet (optional). The agent receives it as a separate
      // labeled block inside the user message; we don't parse it
      // upstream. Any S3 / pdf-parse failure drops us to "no face
      // sheet" which the prompt handles explicitly.
      let rawFaceSheetText = "";
      if (encounter.faceSheet) {
        try {
          const fsBuffer = await this.s3.downloadBuffer(encounter.faceSheet);
          rawFaceSheetText = await extractPdfTextFromBuffer(fsBuffer);
          if (rawFaceSheetText.length < 50) {
            this.logger.warn(
              `Face sheet ${encounter.faceSheet} produced ${rawFaceSheetText.length} chars — treating as missing`,
            );
            rawFaceSheetText = "";
          }
        } catch (err) {
          this.logger.warn(
            `Face sheet download/extract failed for ${encounter.faceSheet}: ${(err as Error).message} — coding without it`,
          );
          rawFaceSheetText = "";
        }
      }

      // HIPAA boundary: redact PHI across the concatenated note +
      // face sheet so token counters stay consistent between the
      // two. Both halves are recovered by splitting on the divider.
      const combined = rawFaceSheetText
        ? rawNoteText + NOTE_FACESHEET_DIVIDER + rawFaceSheetText
        : rawNoteText;
      const { redacted, tokens } = this.redaction.redact(combined);
      const [noteText, faceSheetText] = rawFaceSheetText
        ? (redacted.split(NOTE_FACESHEET_DIVIDER) as [string, string])
        : [redacted, ""];
      this.logger.log(
        `Redacted ${Object.keys(tokens).length} PHI tokens across ${combined.length} chars (note ${rawNoteText.length}, facesheet ${rawFaceSheetText.length})`,
      );

      const result = await this.coder.run({
        noteText,
        faceSheetText,
        locality: "04",
        contractorNumber: "09102",
        specialty: encounter.doctor?.specialtyRel
          ? {
              name: encounter.doctor.specialtyRel.name,
              systemPrompt: encounter.doctor.specialtyRel.systemPrompt,
            }
          : encounter.doctor?.specialty
            ? { name: encounter.doctor.specialty, systemPrompt: "" }
            : undefined,
        practice: encounter.doctor?.practice
          ? {
              name: encounter.doctor.practice.name,
              systemPrompt: encounter.doctor.practice.systemPrompt,
            }
          : undefined,
        practiceId: encounter.doctor?.practiceId ?? null,
        pos: encounter.patient?.emrSystem === "BAPTIST" ? "21" : undefined,
        // Encounter.type is CONSULT / PROGRESS already — drives E/M family selection.
        encounterType: encounter.type,
        year: new Date().getFullYear(),
        onEvent: (event) => {
          events.push(event);
          dirty = true;
        },
      });

      const durationMs = Date.now() - t0;

      if (!result.proposal) {
        throw new Error(
          `Agent finished without calling finalize_coding (${result.toolCalls.length} tool calls)`,
        );
      }

      // Rehydrate every string field in the proposal so the UI
      // renders real PHI instead of tokens.
      const proposal = this.redaction.rehydrateDeep(result.proposal, tokens);
      const score =
        typeof proposal.auditRiskScore === "number"
          ? proposal.auditRiskScore
          : null;
      const band =
        proposal.riskBand ?? (score !== null ? deriveBand(score) : null);

      // Bundle the rehydrated note text into the stored proposal
      // so the UI can render evidence-span highlights without
      // re-downloading the PDF.
      const rehydratedNoteText = this.redaction.rehydrate(noteText, tokens);
      const storedProposal = { ...proposal, noteText: rehydratedNoteText };

      await this.prisma.encounterCoding.update({
        where: { id: codingId },
        data: {
          status: "DRAFT",
          proposal:
            storedProposal as unknown as import("@prisma/client").Prisma.InputJsonValue,
          primaryCpt: proposal.primaryCpt ?? null,
          auditRiskScore: score,
          riskBand: band,
          toolCallCount: result.toolCalls.length,
          runDurationMs: durationMs,
          reasoningLog:
            events as unknown as import("@prisma/client").Prisma.InputJsonValue,
          completedAt: new Date(),
        },
      });

      this.logger.log(
        `Encounter ${coding.encounterId} coded in ${durationMs}ms — id=${codingId}, primary=${proposal.primaryCpt}, score=${score}`,
      );
    } catch (err) {
      const message = (err as Error).message || String(err);
      this.logger.error(
        `runGeneration(${codingId}) failed: ${message}`,
        (err as Error).stack,
      );
      await this.markFailed(codingId, message, events, Date.now() - t0);
    } finally {
      clearInterval(ticker);
    }
  }

  private async markFailed(
    codingId: number,
    message: string,
    events: CoderEvent[] = [],
    durationMs?: number,
  ): Promise<void> {
    try {
      await this.prisma.encounterCoding.update({
        where: { id: codingId },
        data: {
          status: "FAILED",
          errorMessage: message.slice(0, 2000),
          reasoningLog:
            events as unknown as import("@prisma/client").Prisma.InputJsonValue,
          runDurationMs: durationMs ?? null,
          completedAt: new Date(),
        },
      });
    } catch (err) {
      this.logger.error(
        `Could not even mark coding ${codingId} as FAILED: ${(err as Error).message}`,
      );
    }
  }

  /** Most recent coding for an encounter, or null if there is none yet. */
  async getLatestForEncounter(encounterId: number) {
    return this.prisma.encounterCoding.findFirst({
      where: { encounterId },
      orderBy: { createdAt: "desc" },
    });
  }

  /** All codings for an encounter — ordered newest-first. Used for history. */
  async listForEncounter(encounterId: number) {
    return this.prisma.encounterCoding.findMany({
      where: { encounterId },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Coder-inbox feed for a specific doctor. Returns every encounter
   * that's eligible for coding (signed note present) paired with the
   * latest coding pass (or null if the doctor hasn't run the AI Coder
   * against it yet).
   *
   * The returned list is already sorted in the order we want the UI
   * to render it: highest audit-risk first, then by dateOfService
   * (most recent first). Encounters without a coding float to the
   * top of the "never run" bucket.
   *
   * Filters are applied in-memory after fetch since the scale today
   * is <200 encounters per doctor — pagination / proper server-side
   * filtering can be added when that's no longer true.
   */
  async getInbox(
    doctorId: number,
    filters: {
      status?: string;
      riskBand?: string;
      emrSystem?: string;
      search?: string;
    } = {},
  ) {
    const encounters = await this.prisma.encounter.findMany({
      where: {
        doctorId,
        noteStatus: "FOUND_SIGNED",
      },
      select: {
        id: true,
        type: true,
        dateOfService: true,
        deadline: true,
        noteStatus: true,
        patient: {
          select: {
            id: true,
            name: true,
            emrSystem: true,
            facility: true,
          },
        },
        codings: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            status: true,
            primaryCpt: true,
            auditRiskScore: true,
            riskBand: true,
            runDurationMs: true,
            toolCallCount: true,
            errorMessage: true,
            createdAt: true,
            completedAt: true,
          },
        },
      },
    });

    // Flatten `codings: [latest] | []` into `coding: latest | null`.
    const entries = encounters.map((e) => ({
      encounterId: e.id,
      type: e.type,
      dateOfService: e.dateOfService,
      deadline: e.deadline,
      patient: e.patient,
      coding: e.codings[0] ?? null,
    }));

    // Apply in-memory filters. Status "NEVER_RUN" is a synthetic
    // bucket for encounters with no coding row at all.
    const filtered = entries.filter((entry) => {
      if (filters.emrSystem && entry.patient?.emrSystem !== filters.emrSystem) {
        return false;
      }
      if (filters.search) {
        const q = filters.search.trim().toLowerCase();
        if (q && !entry.patient?.name.toLowerCase().includes(q)) return false;
      }
      if (filters.status) {
        if (filters.status === "NEVER_RUN") {
          if (entry.coding !== null) return false;
        } else {
          if (!entry.coding || entry.coding.status !== filters.status)
            return false;
        }
      }
      if (filters.riskBand) {
        if (!entry.coding || entry.coding.riskBand !== filters.riskBand)
          return false;
      }
      return true;
    });

    // Sort: NEVER_RUN first (action needed), then by risk DESC, then
    // by most-recent DoS. This surfaces "new signed notes awaiting
    // first coding" at the top — Hajira's most urgent column.
    filtered.sort((a, b) => {
      const aScore = a.coding
        ? (a.coding.auditRiskScore ?? -1)
        : Number.POSITIVE_INFINITY;
      const bScore = b.coding
        ? (b.coding.auditRiskScore ?? -1)
        : Number.POSITIVE_INFINITY;
      if (aScore !== bScore) return bScore - aScore;
      return (
        new Date(b.dateOfService).getTime() -
        new Date(a.dateOfService).getTime()
      );
    });

    // Status counts computed against the UNFILTERED set so the
    // filter chips stay stable when the user toggles them.
    const counts = {
      total: entries.length,
      NEVER_RUN: entries.filter((e) => !e.coding).length,
      IN_PROGRESS: entries.filter((e) => e.coding?.status === "IN_PROGRESS")
        .length,
      DRAFT: entries.filter((e) => e.coding?.status === "DRAFT").length,
      APPROVED: entries.filter((e) => e.coding?.status === "APPROVED").length,
      TRANSFERRED_TO_CARETRACKER: entries.filter(
        (e) => e.coding?.status === "TRANSFERRED_TO_CARETRACKER",
      ).length,
      FAILED: entries.filter((e) => e.coding?.status === "FAILED").length,
      riskHigh: entries.filter((e) => e.coding?.riskBand === "RISK").length,
    };

    return { entries: filtered, counts };
  }

  /**
   * Doctor/coder sign-off. Flips DRAFT/UNDER_REVIEW → APPROVED and
   * records who approved + when.
   */
  async approve(codingId: number, doctorId: number) {
    const existing = await this.prisma.encounterCoding.findUnique({
      where: { id: codingId },
      select: { id: true, status: true },
    });
    if (!existing) throw new NotFoundException(`Coding ${codingId} not found`);
    if (existing.status === "TRANSFERRED_TO_CARETRACKER") {
      throw new BadRequestException(
        `Coding ${codingId} already transferred — cannot re-approve`,
      );
    }
    if (existing.status === "IN_PROGRESS" || existing.status === "FAILED") {
      throw new BadRequestException(
        `Coding ${codingId} is ${existing.status} — cannot approve`,
      );
    }
    return this.prisma.encounterCoding.update({
      where: { id: codingId },
      data: {
        status: "APPROVED",
        approvedByDoctorId: doctorId,
        approvedAt: new Date(),
      },
    });
  }

  /**
   * Mark a coding as transferred to CareTracker (manual step by Hajira
   * today). Irreversible — subsequent regenerations create a new DRAFT.
   */
  async markTransferred(codingId: number) {
    return this.prisma.encounterCoding.update({
      where: { id: codingId },
      data: { status: "TRANSFERRED_TO_CARETRACKER" },
    });
  }
}
