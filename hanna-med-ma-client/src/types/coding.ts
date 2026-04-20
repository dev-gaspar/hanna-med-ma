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
	| "DRAFT"
	| "UNDER_REVIEW"
	| "APPROVED"
	| "TRANSFERRED_TO_CARETRACKER"
	| "DENIED";

export interface EncounterCoding {
	id: number;
	encounterId: number;
	status: CodingStatus;
	basedOnNoteVersion: "DRAFT" | "SIGNED";
	proposal: CoderProposal;
	primaryCpt?: string | null;
	auditRiskScore?: number | null;
	riskBand?: "LOW" | "REVIEW" | "RISK" | null;
	toolCallCount?: number | null;
	runDurationMs?: number | null;
	approvedByDoctorId?: number | null;
	approvedAt?: string | null;
	createdAt: string;
	updatedAt: string;
}
