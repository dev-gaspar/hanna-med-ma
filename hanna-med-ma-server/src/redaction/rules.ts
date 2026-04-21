// PHI redaction rules. Order matters — earlier patterns consume
// substrings first (SSN before generic digit runs; MRN before
// generic IDs). Ported from hannamed-scribe (Adony's work) with no
// material changes — the rule set was already well-tuned for the
// clinical note PHI we see.

export type RedactionRule = {
	type: string; // token type, e.g. "MRN", "PHONE"
	pattern: RegExp; // global regex
};

export const RULES: RedactionRule[] = [
	{ type: "SSN", pattern: /\b\d{3}-\d{2}-\d{4}\b/g },
	{
		type: "PHONE",
		pattern:
			/\+?1?[\s\-.(]?\(?\d{3}\)?[\s\-.)]?\d{3}[\s\-.]?\d{4}\b/g,
	},
	{
		type: "EMAIL",
		pattern: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g,
	},
	{ type: "MRN", pattern: /\bMRN[:\s#]*[A-Z0-9\-]{4,}\b/gi },
	{
		type: "DOB",
		pattern: /\b(?:DOB|D\.O\.B\.?)[:\s]*\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/gi,
	},
	{ type: "DATE", pattern: /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g },
	{
		type: "ADDRESS",
		pattern:
			/\b\d+\s+[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?\s+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Ln|Lane|Dr|Drive|Ct|Court|Way|Pl|Place)\b\.?/g,
	},
	{ type: "ZIP", pattern: /\b\d{5}(?:-\d{4})?\b/g },
	{
		type: "NAME",
		pattern:
			/\b(?:Patient|Pt|Mr|Mrs|Ms|Dr)\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/g,
	},
];
