// PHI redaction rules. Order matters — earlier patterns consume
// substrings first (SSN before generic digit runs; the hospital-
// specific ID labels before the generic MRN pattern). Every rule
// is labeled — we intentionally do not redact bare number runs to
// avoid eating vitals, lab values, and drug dosages.

export type RedactionRule = {
  type: string; // token type, e.g. "MRN", "PHONE"
  pattern: RegExp; // global regex
};

export const RULES: RedactionRule[] = [
  { type: "SSN", pattern: /\b\d{3}-\d{2}-\d{4}\b/g },
  {
    type: "PHONE",
    pattern: /\+?1?[\s\-.(]?\(?\d{3}\)?[\s\-.)]?\d{3}[\s\-.]?\d{4}\b/g,
  },
  {
    type: "EMAIL",
    pattern: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g,
  },
  // Baptist (Cerner) Financial Identification Number.
  // e.g. `FIN: 946100841`, `FIN 946100841`, `FIN#946100841`.
  { type: "FIN", pattern: /\bFIN[:\s#]*\d{6,12}\b/gi },
  // Baptist (Cerner) Medical Record Number. Matches `CMRN:` but
  // not the bare `MRN:` — the MRN rule below handles that case.
  { type: "CMRN", pattern: /\bCMRN[:\s#]*\d{6,12}\b/gi },
  // Generic labeled chart/account identifier — catches labels we
  // don't have a dedicated rule for (Chart ID, Account #, Patient
  // ID, Pt ID). Requires a label so we don't over-eat plain text.
  {
    type: "CHART_ID",
    pattern:
      /\b(?:Chart\s*(?:ID|#|No\.?)?|Account\s*(?:#|No\.?)|Patient\s*ID|Pt\s*ID)[:\s#]*[A-Z0-9][A-Z0-9\-_]{3,}\b/gi,
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
