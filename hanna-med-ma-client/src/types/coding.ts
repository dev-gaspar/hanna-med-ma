/**
 * Client-side mirrors of the CoderAgent's zod schema (server/src/ai/
 * agents/coder.agent.ts). Keep these in sync with the server — a zod
 * schema change there is a contract break the UI needs to handle.
 */

export interface CptProposal {
	code: string;
	modifiers: string[];
	units: number;
	pos?: string;
	evidenceSpan: string;
	rationale: string;
}

export interface Icd10Proposal {
	code: string;
	evidenceSpan: string;
	rationale: string;
}

export interface NcciIssue {
	column1: string;
	column2: string;
	action: "collapsed" | "modifier-added" | "kept-both";
	note: string;
}

export interface MueIssue {
	cpt: string;
	requestedUnits: number;
	maxUnits: number;
	action: "reduced" | "split" | "kept";
	note: string;
}

export interface LcdCitation {
	lcdId: string;
	lcdTitle: string;
	articleId?: string;
	relevantExcerpt: string;
}

export interface DocumentationGap {
	forCode: string;
	missingElement: string;
	suggestedLanguage: string;
}

export interface RiskBreakdownRow {
	dimension:
		| "LCD compliance"
		| "NCCI pairs"
		| "MUE"
		| "Specificity"
		| "Documentation completeness";
	verdict: "ok" | "partial" | "fail";
	note?: string;
}

/**
 * MDM scoring (forcing function v1) — three CMS 2023 elements scored
 * independently + the 2-of-3 final level. Required on every proposal;
 * for PROCEDURE-only encounters the agent sets `notApplicableReason`
 * and leaves the level fields at safe defaults.
 */
export interface MdmScoring {
	problems: "MINIMAL" | "LOW" | "MODERATE" | "HIGH";
	problemsRationale: string;
	data: "MINIMAL" | "LIMITED" | "MODERATE" | "EXTENSIVE";
	dataRationale: string;
	risk: "MINIMAL" | "LOW" | "MODERATE" | "HIGH";
	riskRationale: string;
	finalLevel: "STRAIGHTFORWARD" | "LOW" | "MODERATE" | "HIGH";
	twoOfThreeJustification: string;
	notApplicableReason: string | null;
}

/**
 * Surgery-decision evaluation (forcing function v1) — drives modifier
 * -57 selection on the primary E/M.
 */
export interface SurgeryDecision {
	evaluatedThisVisit: boolean;
	evidenceSpan: string | null;
	modifier57Applied: boolean;
	reasoning: string;
}

/**
 * Payer analysis (forcing function v2) — verbatim copy of the
 * `lookup_payer_rule` tool result. Drives E/M family selection on
 * CONSULT encounters.
 */
export interface PayerAnalysis {
	payerNameOnFaceSheet: string | null;
	patientAge: number | null;
	category:
		| "ALWAYS_INITIAL_HOSPITAL"
		| "ALWAYS_CONSULT"
		| "DEPENDS_HUMAN_REVIEW";
	eligibleFamily: "99221-99223" | "99253-99255" | "DEPENDS";
	matchType:
		| "PRACTICE_EXACT"
		| "PRACTICE_CONTAINS"
		| "PRACTICE_PATTERN"
		| "GLOBAL_EXACT"
		| "GLOBAL_CONTAINS"
		| "GLOBAL_PATTERN"
		| "FALLBACK_DEPENDS";
	ruleId: number | null;
	source: string | null;
	notApplicableReason: string | null;
}

/**
 * Limb-threat assessment (forcing function v3) — required evaluation
 * for foot/leg/limb pathology where loss of limb is on the
 * differential. Practice convention may use this to cap MDM Element 1
 * (problems) at MODERATE when evidence is suspected/pending.
 */
export interface LimbThreatAssessment {
	applicable: boolean;
	evidenceLevel: "NONE" | "SUSPECTED_PENDING" | "CONFIRMED";
	surgicalDecisionStatus:
		| "NOT_APPLICABLE"
		| "DELIBERATING"
		| "DECIDED_AND_SCHEDULED";
	evidenceSpan: string | null;
	decisionEvidenceSpan: string | null;
	rationale: string;
}

export interface CoderProposal {
	primaryCpt: string;
	cptProposals: CptProposal[];
	/** Forcing-function audit-trail blocks. All four are mandatory
	 *  in the current Zod schema, but proposals stored BEFORE the
	 *  forcing-function architecture was deployed don't have them.
	 *  Mark as optional in the TS type so the UI can render legacy
	 *  proposals without crashing on undefined-property reads. */
	mdm?: MdmScoring;
	surgeryDecision?: SurgeryDecision;
	payerAnalysis?: PayerAnalysis;
	/** Specialty-gated forcing function. Filled by limb-related
	 *  specialties (Podiatry, Vascular). Null/undefined when the
	 *  active specialty does not engage with limb-threat
	 *  assessment (Internal Medicine, Cardiology, etc.). */
	limbThreatAssessment?: LimbThreatAssessment | null;
	icd10Proposals: Icd10Proposal[];
	ncciIssues: NcciIssue[];
	mueIssues: MueIssue[];
	lcdCitations: LcdCitation[];
	documentationGaps: DocumentationGap[];
	providerQuestions: string[];
	auditRiskNotes: string[];
	auditRiskScore: number;
	riskBand: "LOW" | "REVIEW" | "RISK";
	riskBreakdown: RiskBreakdownRow[];
	summary: string;
	/** Server-extracted plain-text of the signed note PDF — used for
	 *  evidence-span highlights on the client without re-parsing the PDF. */
	noteText?: string;
}

export type CodingStatus =
	| "IN_PROGRESS"
	| "DRAFT"
	| "UNDER_REVIEW"
	| "APPROVED"
	| "TRANSFERRED_TO_CARETRACKER"
	| "DENIED"
	| "FAILED";

/** Terminal statuses — polling stops once the row reaches one of these. */
export const TERMINAL_CODING_STATUSES: CodingStatus[] = [
	"DRAFT",
	"UNDER_REVIEW",
	"APPROVED",
	"TRANSFERRED_TO_CARETRACKER",
	"DENIED",
	"FAILED",
];

/**
 * Live-reasoning events emitted by the agent during a run. Persisted
 * into `encounter_codings.reasoningLog` and streamed to the UI via
 * polling. `ts` is milliseconds since the run started.
 */
export type ReasoningEvent =
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

/**
 * One row in the doctor's coder inbox. Each row is an encounter with
 * a signed note, paired with its latest coding (or null when the AI
 * Coder has not run yet — a "never run" row).
 */
export interface InboxEntry {
	encounterId: number;
	type: "CONSULT" | "PROGRESS" | "PROCEDURE";
	dateOfService: string;
	deadline?: string | null;
	patient: {
		id: number;
		name: string;
		emrSystem: "JACKSON" | "STEWARD" | "BAPTIST";
		facility: string | null;
	};
	coding: {
		id: number;
		status: CodingStatus;
		primaryCpt: string | null;
		auditRiskScore: number | null;
		riskBand: "LOW" | "REVIEW" | "RISK" | null;
		runDurationMs: number | null;
		toolCallCount: number | null;
		errorMessage: string | null;
		createdAt: string;
		completedAt: string | null;
	} | null;
}

export interface InboxResponse {
	entries: InboxEntry[];
	counts: {
		total: number;
		NEVER_RUN: number;
		IN_PROGRESS: number;
		DRAFT: number;
		APPROVED: number;
		TRANSFERRED_TO_CARETRACKER: number;
		FAILED: number;
		riskHigh: number;
	};
}

export interface EncounterCoding {
	id: number;
	encounterId: number;
	status: CodingStatus;
	basedOnNoteVersion: "DRAFT" | "SIGNED";
	/** Null while IN_PROGRESS / FAILED — only present after a successful finalize. */
	proposal: CoderProposal | null;
	primaryCpt?: string | null;
	auditRiskScore?: number | null;
	riskBand?: "LOW" | "REVIEW" | "RISK" | null;
	toolCallCount?: number | null;
	runDurationMs?: number | null;
	/** Agent's live reasoning timeline — growing array of events. */
	reasoningLog?: ReasoningEvent[] | null;
	/** Populated when status=FAILED. */
	errorMessage?: string | null;
	startedAt?: string | null;
	completedAt?: string | null;
	approvedByDoctorId?: number | null;
	approvedAt?: string | null;
	createdAt: string;
	updatedAt: string;
}
