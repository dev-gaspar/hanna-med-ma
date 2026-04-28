import { Injectable, Logger } from "@nestjs/common";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { tool } from "@langchain/core/tools";
import {
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { z } from "zod";
import { LangChainModelService } from "../langchain-model.service";
import { CoverageService } from "../../coverage/coverage.service";
import { getCoderPrompt } from "../prompts/coder.prompt";
import { currentTimeForDisplay } from "../../core/date.util";
import { PrismaService } from "../../core/prisma.service";

// Zod schema for the final JSON proposal. `finalize_coding` is the
// agent's exit door — when it calls this tool, we capture the payload
// and return it verbatim. This gives us a typed JSON output without
// relying on the model to stay in markdown/plain-text format.
const cptProposalSchema = z.object({
  code: z.string().describe("5-char CPT/HCPCS code, e.g., 11721"),
  modifiers: z
    .array(z.string())
    .default([])
    .describe("CPT modifiers, e.g., ['25'], or [] when none"),
  units: z
    .number()
    .int()
    .min(1)
    .default(1)
    .describe("Units billed; typically 1"),
  pos: z
    .string()
    .optional()
    .describe("Place of Service code, e.g., '11' office, '21' inpatient"),
  evidenceSpan: z
    .string()
    .describe("Verbatim quote from the note that justifies this code"),
  rationale: z
    .string()
    .describe("1–2 sentences explaining why this code was chosen"),
});

const icd10ProposalSchema = z.object({
  code: z.string().describe("ICD-10-CM code"),
  evidenceSpan: z.string().describe("Verbatim quote from the note"),
  rationale: z.string().describe("1–2 sentences"),
});

// Forcing-function blocks. The agent CANNOT skip these — Zod rejects the
// finalize_coding call if any field is missing. Reasoning: cycles 1-6
// showed that passive prompt rules (2-of-3 MDM, modifier-57) are
// silently ignored when many rules compete for attention. Promoting
// them to required output fields makes the agent perform the work
// AND makes the work auditable post-hoc.
const mdmScoringSchema = z.object({
  problems: z
    .enum(["MINIMAL", "LOW", "MODERATE", "HIGH"])
    .describe(
      "Element 1 — number/complexity of problems THIS provider actively manages in the Assessment/Plan. Comorbidities managed by other specialties do NOT elevate this.",
    ),
  problemsRationale: z
    .string()
    .describe(
      "Which problems were counted toward this level and which were excluded as managed-by-other-specialty.",
    ),
  data: z
    .enum(["MINIMAL", "LIMITED", "MODERATE", "EXTENSIVE"])
    .describe(
      "Element 2 — amount/complexity of data reviewed (notes, tests, independent interpretation, external coordination).",
    ),
  dataRationale: z
    .string()
    .describe(
      "Which data categories were involved and how many of the moderate-tier requirements were met.",
    ),
  risk: z
    .enum(["MINIMAL", "LOW", "MODERATE", "HIGH"])
    .describe(
      "Element 3 — risk of complications/morbidity/mortality at the time of decision (not based on the actual outcome).",
    ),
  riskRationale: z
    .string()
    .describe(
      "What drove the risk level: drug management, surgery decision, hospitalization decision, etc.",
    ),
  finalLevel: z
    .enum(["STRAIGHTFORWARD", "LOW", "MODERATE", "HIGH"])
    .describe(
      "Final MDM = the level met by AT LEAST 2-of-3 elements. Map element 1+3 directly; map element 2 MINIMAL→STRAIGHTFORWARD, LIMITED→LOW.",
    ),
  twoOfThreeJustification: z
    .string()
    .describe(
      "State explicitly which 2 elements support finalLevel and why the third is irrelevant. Required to prove 2-of-3 was applied, not 'highest single element'.",
    ),
  notApplicableReason: z
    .string()
    .nullable()
    .describe(
      "Set to a non-null reason ONLY for PROCEDURE-only encounters with no E/M billed. Otherwise null and all other fields must be filled.",
    ),
});

const payerAnalysisSchema = z.object({
  payerNameOnFaceSheet: z
    .string()
    .nullable()
    .describe(
      "Verbatim payer name as it appears on the face sheet (e.g., 'Humana ConvivaMC HMO', 'BCBS PPC/PPS/PHS'). Null when no face sheet was attached.",
    ),
  patientAge: z
    .number()
    .int()
    .nullable()
    .describe(
      "Patient age in years from the face sheet. Null when missing — Self-Pay routing requires age.",
    ),
  category: z
    .enum([
      "ALWAYS_INITIAL_HOSPITAL",
      "ALWAYS_CONSULT",
      "DEPENDS_HUMAN_REVIEW",
    ])
    .describe(
      "Result of `lookup_payer_rule`. Drives the E/M family selection on CONSULT encounters. PROGRESS / PROCEDURE encounters still record the lookup for audit but the family is fixed by encounter type.",
    ),
  eligibleFamily: z
    .enum(["99221-99223", "99253-99255", "DEPENDS"])
    .describe(
      "The CPT family allowed by the payer rule. Must match the family of the primary E/M code on a CONSULT encounter.",
    ),
  matchType: z
    .enum([
      "PRACTICE_EXACT",
      "PRACTICE_CONTAINS",
      "PRACTICE_PATTERN",
      "GLOBAL_EXACT",
      "GLOBAL_CONTAINS",
      "GLOBAL_PATTERN",
      "FALLBACK_DEPENDS",
    ])
    .describe(
      "How `lookup_payer_rule` resolved the rule (practice-scoped exact match, practice substring, global fallback, etc.). Copy verbatim from the tool result so the audit trail can reconstruct WHY this category was chosen.",
    ),
  ruleId: z
    .number()
    .int()
    .nullable()
    .describe(
      "Primary key of the matched PayerEMRule row, or null when matchType=FALLBACK_DEPENDS.",
    ),
  source: z
    .string()
    .nullable()
    .describe(
      "Provenance of the rule (e.g., 'Hajira 2026-04-27 calibration doc'). Null on fallback.",
    ),
  notApplicableReason: z
    .string()
    .nullable()
    .describe(
      "Set to a non-null reason ONLY when no face sheet was attached AND the encounter is PROCEDURE-only (no E/M family decision needed). Otherwise null and the other fields must be filled.",
    ),
});

const limbThreatAssessmentSchema = z.object({
  applicable: z
    .boolean()
    .describe(
      "True when the encounter involves a foot/leg/limb pathology where limb-loss is on the differential (diabetic foot infection, gangrene, osteomyelitis, severe PAD with rest pain, deep ulcer, necrotizing infection, post-trauma compromised limb). False for everything else (joint pain, plantar fasciitis, ingrown toenail, routine debridement, post-op check, etc.).",
    ),
  evidenceLevel: z
    .enum(["NONE", "SUSPECTED_PENDING", "CONFIRMED"])
    .describe(
      "How well the limb-threat is supported by evidence at the time of THIS encounter. NONE = doesn't apply or no documentation. SUSPECTED_PENDING = clinical concern but imaging/labs are pending or limb-salvage decision still being deliberated. CONFIRMED = positive imaging (X-ray, MRI, bone scan), positive cultures, or operative findings already documented.",
    ),
  surgicalDecisionStatus: z
    .enum(["NOT_APPLICABLE", "DELIBERATING", "DECIDED_AND_SCHEDULED"])
    .describe(
      "Where the surgical-management decision sits. NOT_APPLICABLE when no surgical option is on the table. DELIBERATING when the note says things like 'will discuss with patient', 'pending family meeting', 'considering amputation if no improvement'. DECIDED_AND_SCHEDULED when the patient is consented, NPO ordered, OR booked, etc.",
    ),
  evidenceSpan: z
    .string()
    .nullable()
    .describe(
      "Verbatim quote from the note that supports `evidenceLevel`. Null when applicable=false.",
    ),
  decisionEvidenceSpan: z
    .string()
    .nullable()
    .describe(
      "Verbatim quote from the note that supports `surgicalDecisionStatus`. Null when surgicalDecisionStatus=NOT_APPLICABLE.",
    ),
  rationale: z
    .string()
    .describe(
      "One-line explanation of how this assessment ties into MDM Element 1 (problems) and Element 3 (risk). Cite the practice convention that anchors the threshold for HIGH problems.",
    ),
});

const surgeryDecisionSchema = z.object({
  evaluatedThisVisit: z
    .boolean()
    .describe(
      "True if THIS encounter documents the initial decision for major surgery (CPT with 90-day global). Signals: patient consented, NPO, surgery scheduled within ~24h.",
    ),
  evidenceSpan: z
    .string()
    .nullable()
    .describe(
      "Verbatim quote from the note that proves the decision. Null if evaluatedThisVisit=false.",
    ),
  modifier57Applied: z
    .boolean()
    .describe(
      "Whether -57 was appended to the primary E/M CPT. MUST be true if evaluatedThisVisit=true on a CONSULT/PROGRESS code; MUST be false otherwise.",
    ),
  reasoning: z
    .string()
    .describe(
      "One-line explanation of the modifier-57 decision. Cite the rule and the evidence (or absence).",
    ),
});

const finalSchema = z.object({
  primaryCpt: z.string().describe("The main CPT being billed"),
  cptProposals: z.array(cptProposalSchema).min(1),
  mdm: mdmScoringSchema.describe(
    "Three-element MDM scoring + 2-of-3 final level. Required for every encounter; for PROCEDURE-only encounters set notApplicableReason and leave the level enums at STRAIGHTFORWARD/MINIMAL.",
  ),
  surgeryDecision: surgeryDecisionSchema.describe(
    "Explicit evaluation of decision-for-surgery and modifier-57. Required for every encounter so the agent has to think about it even when it does not apply.",
  ),
  payerAnalysis: payerAnalysisSchema.describe(
    "Result of the `lookup_payer_rule` tool — required for every encounter so the agent has to actually call the tool and copy its verdict here. The family chosen for the primary E/M MUST match `eligibleFamily` on CONSULT encounters; the schema does not auto-enforce this so the agent must cross-check.",
  ),
  limbThreatAssessment: limbThreatAssessmentSchema
    .nullable()
    .optional()
    .describe(
      "Specialty-gated forcing function. Fill ONLY when the active specialty delta explicitly instructs to evaluate limb-threat (Podiatry, Vascular, etc.). Specialties that don't engage with limb pathology (Internal Medicine, Cardiology, etc.) leave this null/omitted. The clinical-trigger list and the obligation to fill the block live in the specialty delta (Layer 2), not in the universal prompt. The cap rules that USE this block live in the practice convention (Layer 3).",
    ),
  icd10Proposals: z
    .array(icd10ProposalSchema)
    .min(1)
    .describe("Ordered: primary diagnosis first"),
  ncciIssues: z
    .array(
      z.object({
        column1: z.string(),
        column2: z.string(),
        action: z.enum(["collapsed", "modifier-added", "kept-both"]),
        note: z.string(),
      }),
    )
    .default([]),
  mueIssues: z
    .array(
      z.object({
        cpt: z.string(),
        requestedUnits: z.number(),
        maxUnits: z.number(),
        action: z.enum(["reduced", "split", "kept"]),
        note: z.string(),
      }),
    )
    .default([]),
  lcdCitations: z
    .array(
      z.object({
        lcdId: z.string(),
        lcdTitle: z.string(),
        articleId: z.string().optional(),
        relevantExcerpt: z.string().describe("The paragraph that governs"),
      }),
    )
    .default([]),
  documentationGaps: z
    .array(
      z.object({
        forCode: z.string(),
        missingElement: z.string(),
        suggestedLanguage: z
          .string()
          .describe("Concrete wording the provider could add"),
      }),
    )
    .default([]),
  providerQuestions: z
    .array(z.string())
    .default([])
    .describe("Specific asks back to the provider"),
  auditRiskNotes: z
    .array(z.string())
    .default([])
    .describe("Anything that could trigger an audit or denial"),
  auditRiskScore: z
    .number()
    .int()
    .min(0)
    .max(100)
    .describe(
      "0-100 risk that this claim gets denied/audited. 0-25 = low (docs bulletproof), 26-60 = review (minor gaps), 61+ = risk (structural issues).",
    ),
  riskBand: z
    .enum(["LOW", "REVIEW", "RISK"])
    .describe("Coarse band derived from auditRiskScore."),
  riskBreakdown: z
    .array(
      z.object({
        dimension: z.enum([
          "LCD compliance",
          "NCCI pairs",
          "MUE",
          "Specificity",
          "Documentation completeness",
        ]),
        verdict: z.enum(["ok", "partial", "fail"]),
        note: z.string().optional(),
      }),
    )
    .default([])
    .describe("Five required dimensions matching the Defense panel rows."),
  summary: z.string().describe("One-paragraph narrative Hajira can read"),
});

export type CoderProposal = z.infer<typeof finalSchema>;

/**
 * Events emitted by the agent during a run. The CodingService persists
 * these into `encounter_codings.reasoningLog` so the UI can render a
 * live timeline while the run is in-flight AND a collapsible history
 * after it completes.
 *
 * `ts` is milliseconds since the run started (not wall clock) — makes
 * the UI "running for 2m 14s" trivial to derive.
 */
export type CoderEvent =
  | { ts: number; type: "think"; text: string }
  | {
      ts: number;
      type: "tool_call";
      tool: string;
      args: Record<string, unknown>;
      callId?: string;
    }
  | {
      ts: number;
      type: "tool_result";
      tool: string;
      summary: string;
      callId?: string;
    };

export interface CoderInput {
  noteText: string;
  locality: string;
  contractorNumber: string;
  year?: number;
  /**
   * Pre-loaded specialty from CodingService. `systemPrompt` is the
   * delta appended to the base prompt; empty string when we know
   * the specialty but no delta has been authored yet. `name` is
   * used only for the header section of the base prompt.
   */
  specialty?: { name: string; systemPrompt: string };
  /**
   * Pre-loaded practice (group) the doctor belongs to. `systemPrompt`
   * is the practice convention delta — billing/biller workflow
   * conventions specific to this group, layered on top of base +
   * specialty. Empty string is treated as "no practice convention".
   * `name` is shown in the Context header so the agent knows which
   * practice's conventions are in scope.
   */
  practice?: { name: string; systemPrompt: string };
  /**
   * FK of the practice above. Passed to `lookup_payer_rule` so the
   * resolver can prefer practice-specific rows over the global
   * default. Null/undefined means "fall back to global rules".
   */
  practiceId?: number | null;
  pos?: string;
  /**
   * Role this encounter plays on the admission. Drives E/M family
   * selection (initial 99221-99223 vs. subsequent 99231-99233).
   * In production comes from `Encounter.type`; in the batch
   * validator it comes from Hajira's "Type of Encounter" column.
   */
  encounterType?: "CONSULT" | "PROGRESS" | "PROCEDURE";
  /**
   * Raw face-sheet text (already redacted) for this admission. The
   * agent reads this directly the same way it reads the clinical
   * note — no upstream regex or per-EMR parser. Payer identity,
   * patient age, pre-auth info, MAC jurisdiction are all inferred
   * by the agent from the text + the policy RAG. When absent, the
   * agent proceeds without payer context and flags the gap as an
   * audit-risk note.
   */
  faceSheetText?: string;
  /**
   * Which Anthropic model to use:
   *   - "sonnet" (default) — production quality, higher latency,
   *     hits Tier-1 rate limits on large batches.
   *   - "haiku" — 3x faster, 7x the rate-limit headroom. Used by
   *     the batch validator and local dev.
   */
  modelVariant?: "sonnet" | "haiku";
  /**
   * Optional live-reasoning sink. Called once per agent step (text
   * generation) and once per tool boundary. Failures inside the
   * callback are swallowed so a buggy UI sink can never kill the
   * coding run.
   */
  onEvent?: (event: CoderEvent) => void;
}

export interface CoderResult {
  proposal: CoderProposal | null;
  rawText: string;
  toolCalls: string[];
}

// Pull any text content out of a LangChain message whose `content` may
// be a string or an array of content parts (Claude's native format).
function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => {
        if (typeof p === "string") return p;
        if (
          p &&
          typeof p === "object" &&
          (p as { type?: string }).type === "text"
        ) {
          return (p as { text?: string }).text ?? "";
        }
        return "";
      })
      .join("");
  }
  return "";
}

// Turn a raw tool-result JSON string into a single-line human summary.
// The reasoning log persists summaries, not full payloads — tool
// results can be 50KB+ and the UI only needs the shape. The agent
// still gets the full payload (this runs AFTER the tool return).
function summarizeToolResult(toolName: string, raw: unknown): string {
  const text = typeof raw === "string" ? raw : JSON.stringify(raw);
  try {
    const data: unknown = JSON.parse(text);

    if (Array.isArray(data)) {
      if (data.length === 0) return "0 results";
      const first = data[0] as Record<string, unknown>;
      if (
        toolName === "search_cpt_codes" ||
        toolName === "search_icd10_codes"
      ) {
        const code = first.code as string | undefined;
        const sim =
          typeof first.similarity === "number"
            ? (first.similarity as number).toFixed(2)
            : "?";
        return `${data.length} hits · top: ${code ?? "?"} (sim ${sim})`;
      }
      if (toolName === "search_lcd_chunks") {
        const kind = first.kind as string | undefined;
        const doc = first.docId as string | undefined;
        const sim =
          typeof first.similarity === "number"
            ? (first.similarity as number).toFixed(2)
            : "?";
        return `${data.length} chunks · top: ${kind ?? "?"} ${doc ?? "?"} (sim ${sim})`;
      }
      if (toolName === "search_coding_guidelines") {
        const section = first.section as string | undefined;
        const sim =
          typeof first.similarity === "number"
            ? (first.similarity as number).toFixed(2)
            : "?";
        return `${data.length} guideline chunks · top: §${section ?? "?"} (sim ${sim})`;
      }
      if (toolName === "search_policy_rules") {
        const citation = first.citation as string | undefined;
        const kind = first.kind as string | undefined;
        const sim =
          typeof first.similarity === "number"
            ? (first.similarity as number).toFixed(2)
            : "?";
        const label = citation ?? kind ?? "?";
        return `${data.length} policy chunks · top: ${label} (sim ${sim})`;
      }
      if (toolName === "get_lcds_for_cpt") {
        const id = first.lcdId as string | undefined;
        return `${data.length} LCD${data.length === 1 ? "" : "s"} · top: ${id ?? "?"}`;
      }
      return `${data.length} results`;
    }

    if (data && typeof data === "object") {
      const obj = data as Record<string, unknown>;
      if (toolName === "get_fee_schedule") {
        const amt = obj.amount as
          | { nonFacility?: number; facility?: number }
          | undefined;
        const cpt = obj.cpt as string | undefined;
        const nf =
          amt?.nonFacility != null
            ? `$${Number(amt.nonFacility).toFixed(2)}`
            : "?";
        const f =
          amt?.facility != null ? `$${Number(amt.facility).toFixed(2)}` : "?";
        return `${cpt ?? "?"} · nonFac ${nf} · fac ${f}`;
      }
      if (toolName === "check_ncci_bundle") {
        if (obj.bundled === false) return "not bundled";
        const ind = obj.modifierIndicator as string | undefined;
        return `bundled · modifier-indicator=${ind ?? "?"}`;
      }
      if (toolName === "check_mue_limit") {
        if (obj.note) return String(obj.note);
        const u = obj.maxUnitsPerDay as number | undefined;
        const mai = obj.mai as string | number | undefined;
        return `max ${u ?? "?"}/day · MAI=${mai ?? "?"}`;
      }
      if (toolName === "finalize_coding") {
        return "proposal captured";
      }
      if (obj.error) return `error: ${String(obj.error).slice(0, 80)}`;
    }
  } catch {
    // Non-JSON tool output — fall through to truncated raw text.
  }
  return text.length > 100 ? `${text.slice(0, 100)}…` : text;
}

@Injectable()
export class CoderAgent {
  private readonly logger = new Logger(CoderAgent.name);

  constructor(
    private readonly modelService: LangChainModelService,
    private readonly coverage: CoverageService,
    private readonly prisma: PrismaService,
  ) {}

  async run(input: CoderInput): Promise<CoderResult> {
    const year = input.year ?? new Date().getFullYear();
    const basePrompt = getCoderPrompt({
      locality: input.locality,
      contractorNumber: input.contractorNumber,
      year,
      specialty: input.specialty?.name,
      practice: input.practice?.name,
      pos: input.pos,
      encounterType: input.encounterType,
      hasFaceSheet: !!input.faceSheetText && input.faceSheetText.length > 0,
      currentDate: currentTimeForDisplay(),
    });

    // Specialty delta is pre-loaded by CodingService from the
    // Specialty relation. No DB lookup here — keeps the agent
    // pure-ish and lets callers decide how to resolve specialty.
    const specialtyDelta = input.specialty?.systemPrompt?.trim() || "";
    // Practice convention delta — billing/biller workflow rules
    // specific to this group (ICD ranking caps, modifier timing
    // conventions, payer-specific overrides). Lives in its own
    // cache_control block so it reuses across encounters of the
    // same practice without invalidating the specialty cache.
    const practiceDelta = input.practice?.systemPrompt?.trim() || "";

    // Up to three cache_control blocks so Anthropic's prompt cache
    // (5-min TTL) reuses each layer independently:
    //   1. base prompt — hits on ANY encounter
    //   2. specialty delta — hits across same-specialty encounters
    //   3. practice convention delta — hits across same-practice
    //      encounters
    // The note text itself goes through as a user message and is
    // NOT cached (every encounter is different).
    const systemMessage = new SystemMessage({
      content: [
        {
          type: "text",
          text: basePrompt,
          cache_control: { type: "ephemeral" },
        },
        ...(specialtyDelta
          ? [
              {
                type: "text",
                text: specialtyDelta,
                cache_control: { type: "ephemeral" },
              },
            ]
          : []),
        ...(practiceDelta
          ? [
              {
                type: "text",
                text: practiceDelta,
                cache_control: { type: "ephemeral" },
              },
            ]
          : []),
      ],
    });

    let captured: CoderProposal | null = null;
    const toolCalls: string[] = [];
    const runStart = Date.now();
    // Safe wrapper: never let the callback kill the run.
    const emit = (event: CoderEvent) => {
      if (!input.onEvent) return;
      try {
        input.onEvent(event);
      } catch (err) {
        this.logger.warn(
          `onEvent handler threw (ignored): ${(err as Error).message}`,
        );
      }
    };

    const tools = [
      tool(
        async ({ query, k }) => {
          toolCalls.push("search_cpt_codes");
          const hits = await this.coverage.searchCpt(query, k ?? 8);
          return JSON.stringify(hits);
        },
        {
          name: "search_cpt_codes",
          description:
            "Semantic search over the CPT/HCPCS catalog. Pass a short clinical phrase describing what was done (e.g., 'debridement of 7 mycotic toenails'). Returns top-K candidates with descriptions + status.",
          schema: z.object({
            query: z.string(),
            k: z.number().int().min(1).max(20).optional(),
          }),
        },
      ),
      tool(
        async ({ query, k, billableOnly }) => {
          toolCalls.push("search_icd10_codes");
          const hits = await this.coverage.searchIcd10(
            query,
            k ?? 8,
            billableOnly ?? true,
          );
          return JSON.stringify(hits);
        },
        {
          name: "search_icd10_codes",
          description:
            "Semantic search over the ICD-10-CM catalog. Pass a diagnosis description. Set billableOnly=false only if you need parent categories.",
          schema: z.object({
            query: z.string(),
            k: z.number().int().min(1).max(20).optional(),
            billableOnly: z.boolean().optional(),
          }),
        },
      ),
      tool(
        async ({ query, k, contractorNumber }) => {
          toolCalls.push("search_lcd_chunks");
          const hits = await this.coverage.searchLcdChunks(
            query,
            k ?? 5,
            contractorNumber,
          );
          return JSON.stringify(hits);
        },
        {
          name: "search_lcd_chunks",
          description:
            "Semantic search over chunked LCD + Article text. Pass a clinical phrase. Returns governing paragraphs. Pass contractorNumber='09102' to filter to First Coast FL.",
          schema: z.object({
            query: z.string(),
            k: z.number().int().min(1).max(10).optional(),
            contractorNumber: z.string().optional(),
          }),
        },
      ),
      tool(
        async ({ query, k }) => {
          toolCalls.push("search_coding_guidelines");
          const hits = await this.coverage.searchCodingGuidelines(
            query,
            k ?? 5,
          );
          return JSON.stringify(hits);
        },
        {
          name: "search_coding_guidelines",
          description:
            "Search the ICD-10-CM Official Guidelines for Coding and Reporting (FY2026). Use this when you need authoritative guidance on combination codes, sequencing rules, 'code first' / 'use additional code' mandates, or any specificity question. Returns the actual paragraph from the CMS guidelines document, tagged with its section number (e.g. 'I.C.4.a.2').",
          schema: z.object({
            query: z.string(),
            k: z.number().int().min(1).max(10).optional(),
          }),
        },
      ),
      tool(
        async ({ query, k, kinds }) => {
          toolCalls.push("search_policy_rules");
          const hits = await this.coverage.searchPolicyRules(
            query,
            k ?? 5,
            kinds,
          );
          return JSON.stringify(hits);
        },
        {
          name: "search_policy_rules",
          description:
            "Search authoritative CMS policy prose: the Medicare Claims Processing Manual (billing rules — WHICH E/M family is payable, consult-code replacement, modifier AI / 25 / 57 rules, teaching-physician rules, telehealth, etc.), the NCCI Policy Manual (WHY two CPTs bundle and when a modifier can unbundle them), and the Global Surgery Booklet MLN 907166 (0/10/90-day global periods, what's bundled inside each global). Use this BEFORE finalizing whenever you're choosing between E/M families, applying a modifier for the first time, deciding if an E/M on the same day as a procedure is separately payable, or justifying a CPT against bundling. Returns passages with their citation (e.g. 'CMS Claims Processing Manual Ch.12 §30.6.10') so you can quote the source in your rationale. Filter by kind when you know which doc applies.",
          schema: z.object({
            query: z.string(),
            k: z.number().int().min(1).max(10).optional(),
            kinds: z
              .array(
                z.enum([
                  "CMS_CLAIMS_MANUAL",
                  "NCCI_POLICY_MANUAL",
                  "GLOBAL_SURGERY_BOOKLET",
                ]),
              )
              .optional(),
          }),
        },
      ),
      tool(
        async ({ cpt, locality, year, modifier }) => {
          toolCalls.push("get_fee_schedule");
          try {
            return JSON.stringify(
              await this.coverage.findFee({
                cpt,
                locality: locality ?? input.locality,
                year: year ?? input.year ?? new Date().getFullYear(),
                modifier,
              }),
            );
          } catch (e: unknown) {
            return JSON.stringify({
              error: (e as Error).message,
            });
          }
        },
        {
          name: "get_fee_schedule",
          description:
            "Look up the localized Medicare payment for a CPT+modifier. Returns the Medicare statusCode: A=Active (Medicare pays), I=Inactive (MEDICARE does not pay — the code is still valid CPT and billable to commercial / self-pay payers under their own contracts; we do not index those prices), R=Restricted. Returns NotFound when the CPT isn't on the Medicare schedule at all — same interpretation as 'I' for billing-decision purposes. NEVER treat 'I' or NotFound as 'invalid code' — defer to the payer-aware Rule 1 logic in the prompt.",
          schema: z.object({
            cpt: z.string(),
            locality: z.string().optional(),
            year: z.number().int().optional(),
            modifier: z.string().optional(),
          }),
        },
      ),
      tool(
        async ({ cpt1, cpt2 }) => {
          toolCalls.push("check_ncci_bundle");
          return JSON.stringify(await this.coverage.checkNcciPair(cpt1, cpt2));
        },
        {
          name: "check_ncci_bundle",
          description:
            "Check if two CPTs bundle per NCCI PTP. Returns modifierIndicator (0=never, 1=bypassable with modifier, 9=N/A) and rationale.",
          schema: z.object({ cpt1: z.string(), cpt2: z.string() }),
        },
      ),
      tool(
        async ({ cpt, serviceType }) => {
          toolCalls.push("check_mue_limit");
          const lim = await this.coverage.getMueLimit(
            cpt,
            serviceType ?? "PRACTITIONER",
          );
          return JSON.stringify(lim ?? { note: `No MUE on file for ${cpt}.` });
        },
        {
          name: "check_mue_limit",
          description:
            "Fetch the Medically Unlikely Edit (max units/day) for a CPT. Default service type PRACTITIONER.",
          schema: z.object({
            cpt: z.string(),
            serviceType: z
              .enum(["PRACTITIONER", "OUTPATIENT", "DME"])
              .optional(),
          }),
        },
      ),
      tool(
        async ({ cpt, contractorNumber }) => {
          toolCalls.push("get_lcds_for_cpt");
          return JSON.stringify(
            await this.coverage.getLcdsForCpt(
              cpt,
              contractorNumber ?? input.contractorNumber,
            ),
          );
        },
        {
          name: "get_lcds_for_cpt",
          description:
            "Return every LCD (via its companion Article) that governs this CPT in the given MAC jurisdiction.",
          schema: z.object({
            cpt: z.string(),
            contractorNumber: z.string().optional(),
          }),
        },
      ),
      tool(
        async ({ payerName, patientAge }) => {
          toolCalls.push("lookup_payer_rule");
          return JSON.stringify(
            await this.coverage.lookupPayerRule({
              payerName,
              patientAge: patientAge ?? null,
              practiceId: input.practiceId ?? null,
            }),
          );
        },
        {
          name: "lookup_payer_rule",
          description:
            "Look up which E/M family (99221-99223 vs 99253-99255) a payer requires for an inpatient consult, scoped to the current practice. Pass the payer name from the face sheet and the patient's age (when known — Self-Pay age cutoff matters). Returns the category (ALWAYS_INITIAL_HOSPITAL | ALWAYS_CONSULT | DEPENDS_HUMAN_REVIEW), the eligible code family, the matched rule's source/notes, and a rationale. Call ONCE per encounter on any CONSULT/PROGRESS encounter, before deciding the primary CPT, and copy the result into the `payerAnalysis` field of finalize_coding.",
          schema: z.object({
            payerName: z
              .string()
              .describe(
                "Primary payer name from the face sheet (e.g., 'Humana ConvivaMC HMO', 'BCBS PPC/PPS/PHS', 'Self Pay').",
              ),
            patientAge: z
              .number()
              .int()
              .nullable()
              .optional()
              .describe(
                "Patient age in years from the face sheet. Critical for Self-Pay routing (<65 → consult codes; ≥65 → initial hospital care).",
              ),
          }),
        },
      ),
      tool(
        async (payload) => {
          toolCalls.push("finalize_coding");
          captured = payload as CoderProposal;
          return "Proposal captured.";
        },
        {
          name: "finalize_coding",
          description:
            "Submit the FINAL structured proposal. Call this ONCE when you've gathered enough evidence.",
          schema: finalSchema,
        },
      ),
    ];

    const agent = createReactAgent({
      llm: this.modelService.getCoderModel(input.modelVariant ?? "sonnet"),
      tools,
      // Function form so we can prepend our structured SystemMessage
      // (with cache_control blocks) instead of letting langgraph
      // convert a plain string — otherwise caching is lost.
      prompt: (state: { messages: BaseMessage[] }) => [
        systemMessage,
        ...state.messages,
      ],
    });

    this.logger.log(`CoderAgent run — ${input.noteText.length} chars of note`);

    let rawText = "";
    try {
      // "updates" mode emits one event per node completion, not per
      // token chunk. That maps cleanly to the reasoning timeline
      // the UI renders (one "think" block + a set of tool calls per
      // step). Token-level streaming isn't needed here — we poll
      // Face sheet (when present) is appended to the clinical note
      // under a labeled divider. Both are already redacted — the
      // caller concatenated them before calling redact() so token
      // numbering stays consistent across the two blocks, which is
      // important since the same patient name usually appears in
      // both places.
      const userMessage =
        input.faceSheetText && input.faceSheetText.length > 0
          ? `# CLINICAL NOTE\n\n${input.noteText}\n\n---\n\n# FACE SHEET\n\n${input.faceSheetText}`
          : input.noteText;

      // for progress, we don't live-stream into the UI.
      const stream = await agent.stream(
        { messages: [new HumanMessage(userMessage)] },
        {
          streamMode: "updates",
          // Typical run: ~1 search_cpt + N search_icd10 + 3×N tool
          // calls per CPT (fee, mue, lcds) + finalize. Easily 30–40
          // steps for a multi-procedure encounter.
          recursionLimit: 60,
        },
      );
      for await (const update of stream as AsyncIterable<
        Record<string, { messages?: BaseMessage[] }>
      >) {
        for (const [nodeName, nodeOutput] of Object.entries(update)) {
          const messages = nodeOutput?.messages ?? [];

          if (nodeName === "agent") {
            for (const msg of messages) {
              const mAny = msg as BaseMessage & {
                tool_calls?: Array<{
                  id?: string;
                  name?: string;
                  args?: Record<string, unknown>;
                }>;
              };
              const text = extractText(mAny.content).trim();
              if (text.length > 0) {
                rawText += `${text}\n`;
                emit({
                  ts: Date.now() - runStart,
                  type: "think",
                  text,
                });
              }
              for (const tc of mAny.tool_calls ?? []) {
                if (!tc.name) continue;
                emit({
                  ts: Date.now() - runStart,
                  type: "tool_call",
                  tool: tc.name,
                  args: tc.args ?? {},
                  callId: tc.id,
                });
              }
            }
          } else if (nodeName === "tools") {
            for (const msg of messages) {
              const mAny = msg as BaseMessage & {
                name?: string;
                tool_call_id?: string;
              };
              if (!mAny.name) continue;
              emit({
                ts: Date.now() - runStart,
                type: "tool_result",
                tool: mAny.name,
                summary: summarizeToolResult(mAny.name, mAny.content),
                callId: mAny.tool_call_id,
              });
            }
          }
        }
      }
    } catch (e: unknown) {
      this.logger.error(
        `CoderAgent error: ${(e as Error).message}`,
        (e as Error).stack,
      );
      throw e;
    }

    this.logger.log(
      `CoderAgent done — ${toolCalls.length} tool calls (${new Set(toolCalls).size} distinct), proposal=${captured ? "yes" : "NO"}`,
    );

    return { proposal: captured, rawText: rawText.trim(), toolCalls };
  }
}
