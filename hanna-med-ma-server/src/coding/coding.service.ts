import {
	BadRequestException,
	Injectable,
	Logger,
	NotFoundException,
} from "@nestjs/common";
import { CoderAgent, CoderProposal } from "../ai/agents/coder.agent";
import { PrismaService } from "../core/prisma.service";
import { S3Service } from "../core/s3.service";

// PDF text extraction via pdf-parse v2's class API. Lazy-required so
// the module still boots on cold environments where the library's
// test-PDF-on-import is missing.
type PDFParseCtor = new (opts: { data: Buffer }) => {
	getText: () => Promise<{ text: string }>;
};
let PDFParse: PDFParseCtor | null = null;
async function extractPdfText(buf: Buffer): Promise<string> {
	if (!PDFParse) {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const mod = require("pdf-parse");
		PDFParse = mod.PDFParse ?? mod.default ?? mod;
	}
	const parser = new PDFParse!({ data: buf });
	const res = await parser.getText();
	return (res.text || "").trim();
}

// Cheap heuristic for the risk band when the model forgets it.
function deriveBand(score: number): "LOW" | "REVIEW" | "RISK" {
	if (score <= 25) return "LOW";
	if (score <= 60) return "REVIEW";
	return "RISK";
}

@Injectable()
export class CodingService {
	private readonly logger = new Logger(CodingService.name);

	constructor(
		private readonly prisma: PrismaService,
		private readonly s3: S3Service,
		private readonly coder: CoderAgent,
	) {}

	/**
	 * Persist a new DRAFT coding for this encounter. Runs the CoderAgent
	 * end-to-end: downloads the signed PDF, extracts text, calls the agent,
	 * stores the proposal JSON + flattened metrics.
	 *
	 * Idempotency: callers that don't want a duplicate pass should check
	 * `getLatestForEncounter` first (the default endpoint does this).
	 */
	async generateForEncounter(encounterId: number): Promise<{
		coding: { id: number };
		proposal: CoderProposal | null;
	}> {
		const encounter = await this.prisma.encounter.findUnique({
			where: { id: encounterId },
			include: {
				patient: { select: { emrSystem: true, facility: true } },
				doctor: { select: { specialty: true } },
			},
		});
		if (!encounter) throw new NotFoundException(`Encounter ${encounterId} not found`);
		if (!encounter.providerNote) {
			throw new BadRequestException(
				`Encounter ${encounterId} has no signed provider note yet`,
			);
		}

		this.logger.log(
			`Generating coding for encounter ${encounterId} — note=${encounter.providerNote}`,
		);

		const pdfBuffer = await this.s3.downloadBuffer(encounter.providerNote);
		const noteText = await extractPdfText(pdfBuffer);
		if (!noteText || noteText.length < 50) {
			throw new BadRequestException(
				`Provider note PDF produced no usable text (got ${noteText.length} chars)`,
			);
		}

		// Locality/contractor default to Miami-Dade / First Coast FL Part B.
		// This is Phase-1 scope — extending to other regions happens when we
		// ingest more Localities and more FCSO-sibling MACs.
		const t0 = Date.now();
		const result = await this.coder.run({
			noteText,
			locality: "04",
			contractorNumber: "09102",
			specialty: encounter.doctor?.specialty ?? undefined,
			// Heuristic POS: Baptist = inpatient (21), otherwise leave blank.
			pos: encounter.patient?.emrSystem === "BAPTIST" ? "21" : undefined,
			year: new Date().getFullYear(),
		});
		const durationMs = Date.now() - t0;

		const proposal = result.proposal;
		const score =
			proposal && typeof proposal.auditRiskScore === "number"
				? proposal.auditRiskScore
				: null;
		const band = proposal?.riskBand ?? (score !== null ? deriveBand(score) : null);

		// Bundle the extracted note text into the stored proposal so the
		// UI can render evidence-span highlights without re-downloading
		// and re-parsing the PDF on every read.
		const storedProposal = proposal
			? { ...proposal, noteText }
			: { rawText: result.rawText, noteText };

		const coding = await this.prisma.encounterCoding.create({
			data: {
				encounterId,
				status: "DRAFT",
				basedOnNoteVersion: "SIGNED",
				proposal: storedProposal as unknown as
					import("@prisma/client").Prisma.InputJsonValue,
				primaryCpt: proposal?.primaryCpt ?? null,
				auditRiskScore: score,
				riskBand: band,
				toolCallCount: result.toolCalls.length,
				runDurationMs: durationMs,
			},
			select: { id: true },
		});

		this.logger.log(
			`Encounter ${encounterId} coded in ${durationMs}ms — id=${coding.id}, primary=${proposal?.primaryCpt}, score=${score}`,
		);

		return { coding, proposal };
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
