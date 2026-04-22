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

export interface CoderProposal {
	primaryCpt: string;
	cptProposals: CptProposal[];
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
	type: "CONSULT" | "PROGRESS";
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
