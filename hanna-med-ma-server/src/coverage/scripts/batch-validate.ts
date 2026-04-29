/**
 * Batch validator for the AI Coder — runs every encounter in Hajira's
 * Baptist Testing Files CSV against the agent and compares the output
 * against her ground-truth CPTs + ICD-10 codes.
 *
 *   npx ts-node -r dotenv/config -T src/coverage/scripts/batch-validate.ts \
 *     --csv="./Baptist Hospital Testing Files.csv" \
 *     --pdf-dir="./test-data/hajira-pdfs" \
 *     --limit=5 --concurrency=2
 *
 * Flags:
 *   --csv         path to the CSV with ground-truth CPT/ICD (default: repo root)
 *   --pdf-dir     folder containing the PDF notes + facesheets/ + manifest.json
 *                 (default: ../test-data/hajira-pdfs relative to repo root)
 *   --limit N     only run N encounters starting from --offset
 *   --offset N    skip the first N encounters (for iterative batches)
 *   --idxs=A,B,C  spot-check mode: run only the listed 1-based indices
 *                 (overrides --limit / --offset)
 *   --concurrency N workers in parallel (default 2)
 *   --model       "haiku" (fast, higher rate limits) or "sonnet" (default, prod-quality)
 *   --specialty   specialty name (default "Podiatry")
 *   --practice    practice name to load convention delta + scope payer rules
 *                 (default "Hanna Med Podiatry & Vascular")
 *   --out-dir     where to write the 3 output files (default ./out)
 *   --tag S       suffix for output filenames (default: "<offset+1>-<offset+limit>")
 *
 * Outputs under --out-dir:
 *   batch-validate-results.json   — raw per-encounter results (big)
 *   batch-validate-report.md      — human-readable summary + detail
 *   batch-validate-metrics.csv    — one row per encounter, tabular
 *
 * The validator mirrors the production Run-Coder-AI flow:
 *   1. Load the full provider-note PDF (via manifest.json lookup) and
 *      feed the extracted text to the agent — NOT the CSV's abbreviated
 *      Clinical Notes / Assessment plan columns. Only encounters whose
 *      manifest entry points at an existing PDF get run.
 *   2. Load the companion face sheet, extract the insurance block, and
 *      pass the parsed payer category to the agent via CoderInput.insurance.
 *   3. The CSV is used ONLY for the ground-truth comparison (expected
 *      CPTs / ICD-10 codes that Hajira assigned).
 *
 * Pre-req: each encounter idx the caller targets must have a note file
 * (and ideally a face sheet) in the manifest. Encounters with a missing
 * PDF are skipped with an informative error in the report — the CSV
 * text is no longer used as a fallback.
 */
import * as fs from "fs";
import * as path from "path";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../../app.module";
import {
  CoderAgent,
  CoderProposal,
  CoderInput,
  CoderResult,
} from "../../ai/agents/coder.agent";
import { RedactionService } from "../../redaction/redaction.service";
import { PrismaService } from "../../core/prisma.service";
import { extractPdfText } from "./_pdf-chunker";

// ─── Retry policy (Cycle 9 reliability) ──────────────────────────────
//
// Two distinct failure modes get distinct backoff schedules:
//
//   1. BILLING — Anthropic API returned an error indicating the account
//      is out of credits or the billing limit was hit. The fix is
//      external (recharge the account); the script should sleep
//      INDEFINITELY with visible "please recharge" notices so the user
//      can act on it. Schedule: 5m, 10m, 20m, 30m, then 30m forever.
//
//   2. TRANSIENT — rate-limit (429), network blip, model overload,
//      timeout, etc. These usually clear themselves; we cap retries
//      at 5 with exponential backoff so a single problematic encounter
//      doesn't tar-pit the whole batch. Schedule: 30s, 60s, 2m, 4m, 8m.
//
// Anything that doesn't match either pattern bubbles up as an error
// for that one encounter and the batch keeps going.
const BILLING_BACKOFF_MS = [
  5 * 60_000, // 5 min
  10 * 60_000, // 10 min
  20 * 60_000, // 20 min
];
const BILLING_FOREVER_MS = 30 * 60_000; // every retry past the schedule
const TRANSIENT_BACKOFF_MS = [
  30_000, // 30 s
  60_000, // 1 min
  120_000, // 2 min
  240_000, // 4 min
  480_000, // 8 min
];

// Heuristic: does an error look like Anthropic's "out of credits" /
// "billing limit hit" surface? Anthropic returns 400/401/402 with a
// message containing one of these substrings; we match defensively.
function isBillingError(err: unknown): boolean {
  const msg = (err as Error)?.message?.toLowerCase() ?? "";
  if (!msg) return false;
  return (
    msg.includes("credit balance is too low") ||
    msg.includes("credit balance") ||
    msg.includes("insufficient_quota") ||
    msg.includes("billing") ||
    msg.includes("payment required") ||
    msg.includes("plan_features") ||
    msg.includes("invalid_api_key") === false &&
      (msg.includes("402") || msg.includes("payment"))
  );
}

// Transient = anything we want to retry that isn't billing. Includes
// rate limits, timeouts, overloaded errors, network blips, and
// upstream 5xx. Defensive: if unsure, treat as transient (a few extra
// retries are cheap; missing a recoverable error means losing the
// encounter).
function isTransientError(err: unknown): boolean {
  const msg = (err as Error)?.message?.toLowerCase() ?? "";
  if (!msg) return true;
  return (
    msg.includes("rate") ||
    msg.includes("429") ||
    msg.includes("overloaded") ||
    msg.includes("timeout") ||
    msg.includes("etimedout") ||
    msg.includes("econnreset") ||
    msg.includes("socket hang up") ||
    msg.includes("network") ||
    msg.includes("503") ||
    msg.includes("502") ||
    msg.includes("504") ||
    msg.includes("internal_server_error") ||
    msg.includes("temporarily unavailable")
  );
}

function fmtMin(ms: number): string {
  return `${Math.round(ms / 60_000)}m`;
}

function fmtClock(ms: number): string {
  const d = new Date(Date.now() + ms);
  return d.toTimeString().slice(0, 8);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Wrap `coder.run()` with the two-tier retry policy described above.
 * Emits highly visible log lines on every pause/resume so the operator
 * (and any monitor watching the log) can react in real time.
 *
 * `label` is the per-encounter prefix used in normal logs ("[12/49]
 * Patient Name") so retry events stay grouped with their encounter.
 */
async function runCoderWithRetry(
  coder: CoderAgent,
  input: CoderInput,
  label: string,
): Promise<CoderResult> {
  let billingAttempt = 0;
  let transientAttempt = 0;
  while (true) {
    try {
      return await coder.run(input);
    } catch (err) {
      if (isBillingError(err)) {
        const wait =
          billingAttempt < BILLING_BACKOFF_MS.length
            ? BILLING_BACKOFF_MS[billingAttempt]
            : BILLING_FOREVER_MS;
        console.error(
          `\n⏸️  ${label} — CREDIT EXHAUSTED (attempt ${billingAttempt + 1})\n` +
            `    error: ${(err as Error).message}\n` +
            `    sleeping ${fmtMin(wait)} — please notify Dr Peter to recharge\n` +
            `    will retry around ${fmtClock(wait)}\n`,
        );
        billingAttempt++;
        await sleep(wait);
        console.log(`▶️  ${label} — RESUMING after credit pause\n`);
        continue;
      }
      if (isTransientError(err)) {
        if (transientAttempt >= TRANSIENT_BACKOFF_MS.length) {
          console.error(
            `${label} — transient retries exhausted (${transientAttempt} attempts), giving up on this encounter`,
          );
          throw err;
        }
        const wait = TRANSIENT_BACKOFF_MS[transientAttempt];
        console.warn(
          `${label} — transient error (attempt ${transientAttempt + 1}/${TRANSIENT_BACKOFF_MS.length}): ${(err as Error).message.slice(0, 120)} — retry in ${Math.round(wait / 1000)}s`,
        );
        transientAttempt++;
        await sleep(wait);
        continue;
      }
      // Unknown error class — bubble up so the per-encounter handler
      // records it as a hard failure. Better to lose one encounter
      // than to silently retry and mask a real bug.
      throw err;
    }
  }
}

// Same divider CodingService uses to splice together note + face
// sheet for a single redact() call. Must stay in sync with the one
// in coding.service.ts — callers split on this after redaction to
// recover the two labeled halves. ASCII-only so it can't match any
// redaction rule.
const NOTE_FACESHEET_DIVIDER = "\n\n===HANNA_FS_BOUNDARY_c9f2===\n\n";

// ─── CSV parsing ──────────────────────────────────────────────────────

/**
 * Parse CSV with support for multi-line quoted fields + escaped
 * quotes (`""` inside a quoted field → single `"`). Runs over the
 * full file char-by-char, tracking quote state across line
 * boundaries — line-by-line parsers break when a clinical note
 * contains a newline inside quotes.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          // Escaped quote inside a quoted field.
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(cur);
      cur = "";
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      // Handle \r\n
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur);
      cur = "";
      if (row.some((c) => c.trim().length > 0)) rows.push(row);
      row = [];
      continue;
    }
    cur += ch;
  }
  if (cur.length > 0 || row.length > 0) {
    row.push(cur);
    if (row.some((c) => c.trim().length > 0)) rows.push(row);
  }
  return rows.map((r) => r.map((c) => c.trim()));
}

// ─── Normalizers ──────────────────────────────────────────────────────

const ICD10_RE = /^[A-Z]\d{1,2}(?:\.[A-Z0-9]{1,4})?$/i;
const CPT_RE = /^\d{4,5}[A-Z]?$/;

/** Normalize a single ICD-10 token. Returns null if it doesn't look like an ICD. */
function normalizeIcd(raw: string): string | null {
  let t = raw.trim();
  // Strip trailing punctuation the CSV sometimes has (e.g., "Z47.89.")
  t = t.replace(/[,.\s]+$/, "");
  if (!t) return null;
  t = t.toUpperCase();
  return ICD10_RE.test(t) ? t : null;
}

/**
 * Extract { cpt, modifiers } from a CPT column segment. Handles
 * multiple shapes:
 *   "99222"                        → { cpt: 99222, modifiers: [] }
 *   "99221-57"                     → { cpt: 99221, modifiers: ["57"] }
 *   "99254-57-"                    → { cpt: 99254, modifiers: ["57"] }
 *   "27822-LT-S82.852A"            → { cpt: 27822, modifiers: ["LT"] }  (ICD goes to ICD set)
 *   "28820-T2-M86.172"             → { cpt: 28820, modifiers: ["T2"] }
 */
function parseCptSegment(
  segment: string,
): { cpt: string; modifiers: string[]; embeddedIcds: string[] } | null {
  const parts = segment
    .split("-")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length === 0) return null;
  const cpt = parts[0].toUpperCase();
  if (!CPT_RE.test(cpt)) return null;
  const modifiers: string[] = [];
  const embeddedIcds: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i];
    const maybeIcd = normalizeIcd(p);
    if (maybeIcd) {
      embeddedIcds.push(maybeIcd);
      continue;
    }
    // Modifier: 2 alphanumeric chars, or T-codes like T1-T9/TA, or XE/XP/XS/XU
    if (/^([A-Z]{1,2}\d?|\d{2})$/i.test(p)) {
      modifiers.push(p.toUpperCase());
    }
  }
  return { cpt, modifiers, embeddedIcds };
}

/** Parse an entire CPT column (may contain multiple segments separated by commas). */
function parseCptColumn(col: string): {
  cpts: Array<{ cpt: string; modifiers: string[] }>;
  embeddedIcds: string[];
} {
  const cpts: Array<{ cpt: string; modifiers: string[] }> = [];
  const embeddedIcds: string[] = [];
  for (const seg of col
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)) {
    const parsed = parseCptSegment(seg);
    if (!parsed) continue;
    cpts.push({ cpt: parsed.cpt, modifiers: parsed.modifiers });
    embeddedIcds.push(...parsed.embeddedIcds);
  }
  return { cpts, embeddedIcds };
}

/**
 * Parse an ICD column. Hajira's CSV uses two shapes in the same
 * column:
 *   - plain list: "E11.621,L97.511,i10,"
 *   - CPT–modifier–ICD linked segments for procedure rows:
 *     "28820-T2-M86.172," (CPT + modifier + ICD-pointer)
 * For each comma-separated segment we try both: a plain normalize,
 * and a split on "-" where any sub-token that normalizes to an ICD
 * is captured. This way procedure rows still yield their linked
 * ICDs without needing a separate pass.
 */
function parseIcdColumn(col: string): string[] {
  const out = new Set<string>();
  for (const raw of col.split(",")) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const direct = normalizeIcd(trimmed);
    if (direct) {
      out.add(direct);
      continue;
    }
    // CPT-mod-ICD linked format — split on "-" and fish out
    // any token that parses as an ICD.
    for (const part of trimmed.split("-")) {
      const maybeIcd = normalizeIcd(part);
      if (maybeIcd) out.add(maybeIcd);
    }
  }
  return [...out];
}

// ─── Encounter grouping ──────────────────────────────────────────────

interface ExpectedEncounter {
  idx: number; // 1-based, for report linking
  doctor: string;
  patientName: string;
  facility: string;
  accountNumber: string;
  dos: string;
  typeOfEncounter: string;
  clinicalNotes: string;
  assessmentPlan: string;
  cpts: Array<{ cpt: string; modifiers: string[] }>;
  icd10: string[];
}

/**
 * Group continuation rows into single encounters. A continuation row
 * is recognized by an empty Dr Name + Patient — it carries additional
 * CPT/ICD entries for the prior encounter (common for multi-procedure
 * surgeries like Corzo's trimalleolar fracture: 27822 + 27829 + 27695
 * + 76000 across 4 rows).
 */
export function groupEncounters(rows: string[][]): ExpectedEncounter[] {
  if (rows.length === 0) return [];
  const header = rows[0];
  // Header column map (fuzzy-trim because the sample has leading/trailing spaces).
  const idx = (name: string) =>
    header.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase());
  const col = {
    doctor: idx("Dr Name"),
    patient: idx("Patient name"),
    facility: idx("Facility"),
    account: idx("Account  Number"), // two spaces in the header
    dos: idx("DOS"),
    notes: idx("Clinical Notes"),
    cpt: idx("CPT code"),
    icd: idx("ICD-Diagnosis  code"),
    type: idx("Type of Encounter"),
    plan: idx("Assesment plan"),
  };
  // Fallback on one-space for the doubled-space labels in case Hajira cleans later.
  if (col.account === -1) col.account = idx("Account Number");
  if (col.icd === -1) col.icd = idx("ICD-Diagnosis code");

  const encounters: ExpectedEncounter[] = [];
  let current: ExpectedEncounter | null = null;

  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const doctor = cells[col.doctor] ?? "";
    const patient = cells[col.patient] ?? "";
    const cptCol = cells[col.cpt] ?? "";
    const icdCol = cells[col.icd] ?? "";
    const isContinuation = !doctor && !patient && (cptCol || icdCol);

    if (isContinuation) {
      if (!current) continue;
      const { cpts, embeddedIcds } = parseCptColumn(cptCol);
      current.cpts.push(...cpts);
      const newIcds = new Set([
        ...current.icd10,
        ...parseIcdColumn(icdCol),
        ...embeddedIcds,
      ]);
      current.icd10 = [...newIcds];
      continue;
    }

    // New encounter.
    if (!doctor && !patient && !cptCol && !icdCol) continue; // blank row
    const { cpts, embeddedIcds } = parseCptColumn(cptCol);
    const icdFromCol = parseIcdColumn(icdCol);
    const allIcds = [...new Set([...icdFromCol, ...embeddedIcds])];
    current = {
      idx: encounters.length + 1,
      doctor: doctor.trim(),
      patientName: patient.trim(),
      facility: (cells[col.facility] ?? "").trim(),
      accountNumber: (cells[col.account] ?? "").trim(),
      dos: (cells[col.dos] ?? "").trim(),
      typeOfEncounter: (cells[col.type] ?? "").trim(),
      clinicalNotes: cells[col.notes] ?? "",
      assessmentPlan: cells[col.plan] ?? "",
      cpts,
      icd10: allIcds,
    };
    encounters.push(current);
  }

  return encounters;
}

// ─── Comparison metrics ──────────────────────────────────────────────

interface ComparisonResult {
  primaryCptExactMatch: boolean;
  cptSet: { expected: string[]; actual: string[]; jaccard: number };
  icdSet: {
    expected: string[];
    actual: string[];
    jaccard: number;
    precision: number;
    recall: number;
    matched: string[];
    missedByAgent: string[]; // in expected but not actual
    extraByAgent: string[]; // in actual but not expected
  };
}

function jaccard(a: Set<string>, b: Set<string>): number {
  const inter = new Set([...a].filter((x) => b.has(x)));
  const union = new Set([...a, ...b]);
  return union.size === 0 ? 1 : inter.size / union.size;
}

function compare(
  expected: ExpectedEncounter,
  proposal: CoderProposal,
): ComparisonResult {
  // Primary CPT = first CPT in the expected list (the "CPT code" column's leading value).
  const expectedPrimary = expected.cpts[0]?.cpt ?? "";
  const actualPrimary = proposal.primaryCpt;
  const primaryCptExactMatch =
    expectedPrimary !== "" && expectedPrimary === actualPrimary;

  const expectedCptSet = new Set(expected.cpts.map((c) => c.cpt));
  const actualCptSet = new Set(proposal.cptProposals.map((c) => c.code));
  const cptJaccard = jaccard(expectedCptSet, actualCptSet);

  const expectedIcdSet = new Set(expected.icd10);
  const actualIcdSet = new Set(proposal.icd10Proposals.map((i) => i.code));
  const matched = [...expectedIcdSet].filter((x) => actualIcdSet.has(x));
  const missedByAgent = [...expectedIcdSet].filter((x) => !actualIcdSet.has(x));
  const extraByAgent = [...actualIcdSet].filter((x) => !expectedIcdSet.has(x));
  const precision =
    actualIcdSet.size === 0 ? 0 : matched.length / actualIcdSet.size;
  const recall =
    expectedIcdSet.size === 0 ? 1 : matched.length / expectedIcdSet.size;

  return {
    primaryCptExactMatch,
    cptSet: {
      expected: [...expectedCptSet],
      actual: [...actualCptSet],
      jaccard: cptJaccard,
    },
    icdSet: {
      expected: [...expectedIcdSet],
      actual: [...actualIcdSet],
      jaccard: jaccard(expectedIcdSet, actualIcdSet),
      precision,
      recall,
      matched,
      missedByAgent,
      extraByAgent,
    },
  };
}

// ─── Concurrency helper ──────────────────────────────────────────────

async function withConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      try {
        results[i] = await fn(items[i], i);
      } catch (err) {
        console.error(`  encounter ${i + 1} threw:`, (err as Error).message);
        results[i] = null as unknown as R;
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

// ─── Report writers ──────────────────────────────────────────────────

interface EncounterResult {
  expected: ExpectedEncounter;
  proposal: CoderProposal | null;
  runDurationMs: number;
  toolCalls: number;
  error?: string;
  comparison?: ComparisonResult;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function writeMarkdownReport(results: EncounterResult[], outPath: string) {
  const lines: string[] = [];
  lines.push(`# AI Coder — Batch Validation Report`);
  lines.push("");
  lines.push(`**Encounters**: ${results.length}`);
  const ok = results.filter((r) => r.proposal !== null);
  const failed = results.filter((r) => r.proposal === null);
  lines.push(`**Ran successfully**: ${ok.length}`);
  lines.push(`**Failed / no proposal**: ${failed.length}`);

  // Aggregate metrics over the ok set.
  if (ok.length > 0) {
    const primaryMatches = ok.filter(
      (r) => r.comparison?.primaryCptExactMatch,
    ).length;
    const avgCptJaccard =
      ok.reduce((a, r) => a + (r.comparison?.cptSet.jaccard ?? 0), 0) /
      ok.length;
    const avgIcdJaccard =
      ok.reduce((a, r) => a + (r.comparison?.icdSet.jaccard ?? 0), 0) /
      ok.length;
    const avgIcdPrecision =
      ok.reduce((a, r) => a + (r.comparison?.icdSet.precision ?? 0), 0) /
      ok.length;
    const avgIcdRecall =
      ok.reduce((a, r) => a + (r.comparison?.icdSet.recall ?? 0), 0) /
      ok.length;
    const avgRunMs = ok.reduce((a, r) => a + r.runDurationMs, 0) / ok.length;

    lines.push("");
    lines.push("## Summary metrics");
    lines.push("");
    lines.push("| Metric | Value |");
    lines.push("|---|---|");
    lines.push(
      `| **Primary CPT exact match** | **${primaryMatches}/${ok.length}** (${((primaryMatches / ok.length) * 100).toFixed(1)}%) |`,
    );
    lines.push(`| CPT set Jaccard (avg) | ${avgCptJaccard.toFixed(3)} |`);
    lines.push(`| ICD set Jaccard (avg) | ${avgIcdJaccard.toFixed(3)} |`);
    lines.push(`| ICD precision (avg) | ${avgIcdPrecision.toFixed(3)} |`);
    lines.push(`| ICD recall (avg) | ${avgIcdRecall.toFixed(3)} |`);
    lines.push(`| Avg runtime | ${(avgRunMs / 1000).toFixed(1)}s |`);

    // Per-doctor breakdown.
    const byDoctor = new Map<string, EncounterResult[]>();
    for (const r of ok) {
      const k = r.expected.doctor || "(unknown)";
      if (!byDoctor.has(k)) byDoctor.set(k, []);
      byDoctor.get(k)!.push(r);
    }
    lines.push("");
    lines.push("## By doctor");
    lines.push("");
    lines.push(
      "| Doctor | Encounters | Primary CPT match | CPT Jaccard | ICD Jaccard |",
    );
    lines.push("|---|---|---|---|---|");
    for (const [doctor, rs] of byDoctor) {
      const m = rs.filter((r) => r.comparison?.primaryCptExactMatch).length;
      const cj =
        rs.reduce((a, r) => a + (r.comparison?.cptSet.jaccard ?? 0), 0) /
        rs.length;
      const ij =
        rs.reduce((a, r) => a + (r.comparison?.icdSet.jaccard ?? 0), 0) /
        rs.length;
      lines.push(
        `| ${doctor} | ${rs.length} | ${m}/${rs.length} (${((m / rs.length) * 100).toFixed(0)}%) | ${cj.toFixed(3)} | ${ij.toFixed(3)} |`,
      );
    }
  }

  lines.push("");
  lines.push("## Per-encounter detail");
  lines.push("");
  for (const r of results) {
    const e = r.expected;
    lines.push(`### #${e.idx} — ${e.patientName} · ${e.dos}`);
    lines.push("");
    lines.push(
      `**Doctor**: ${e.doctor} · **Type**: ${e.typeOfEncounter} · **Account**: \`${e.accountNumber}\``,
    );
    lines.push("");
    if (r.error || !r.proposal) {
      lines.push(`> ERROR: ${r.error ?? "no proposal"}`);
      lines.push("");
      continue;
    }
    const c = r.comparison!;
    const markPrimary = c.primaryCptExactMatch ? "✓" : "✗";
    lines.push(`**Primary CPT**: ${markPrimary}`);
    lines.push(`- Expected: \`${e.cpts[0]?.cpt ?? "(none)"}\``);
    lines.push(`- Actual: \`${r.proposal.primaryCpt}\``);
    lines.push("");
    lines.push(`**CPT set** (Jaccard ${c.cptSet.jaccard.toFixed(3)}):`);
    lines.push(
      `- Expected: ${c.cptSet.expected.map((x) => `\`${x}\``).join(", ") || "(none)"}`,
    );
    lines.push(
      `- Actual: ${c.cptSet.actual.map((x) => `\`${x}\``).join(", ") || "(none)"}`,
    );
    lines.push("");
    lines.push(
      `**ICD set** (Jaccard ${c.icdSet.jaccard.toFixed(3)}, precision ${c.icdSet.precision.toFixed(3)}, recall ${c.icdSet.recall.toFixed(3)}):`,
    );
    lines.push(
      `- Matched (${c.icdSet.matched.length}): ${c.icdSet.matched.map((x) => `\`${x}\``).join(", ") || "(none)"}`,
    );
    lines.push(
      `- Missed by agent (${c.icdSet.missedByAgent.length}): ${c.icdSet.missedByAgent.map((x) => `\`${x}\``).join(", ") || "(none)"}`,
    );
    lines.push(
      `- Extra by agent (${c.icdSet.extraByAgent.length}): ${c.icdSet.extraByAgent.map((x) => `\`${x}\``).join(", ") || "(none)"}`,
    );
    lines.push("");
    if (r.proposal.auditRiskScore != null) {
      lines.push(
        `**Audit-risk**: ${r.proposal.auditRiskScore} (${r.proposal.riskBand}) · **Runtime**: ${(r.runDurationMs / 1000).toFixed(1)}s · **Tool calls**: ${r.toolCalls}`,
      );
      lines.push("");
    }
  }
  fs.writeFileSync(outPath, lines.join("\n"), "utf8");
}

function writeMetricsCsv(results: EncounterResult[], outPath: string) {
  const lines: string[] = [];
  // Columns added in Cycle 9 — surface the forcing-function outputs so
  // a metrics-spreadsheet sweep can spot patterns (e.g. "every miss
  // happens on DEPENDS_HUMAN_REVIEW payers") without opening the
  // raw JSON. Keeping the original columns first preserves backwards
  // compatibility with prior cycle CSVs in `out/`.
  lines.push(
    [
      "idx",
      "doctor",
      "patient",
      "dos",
      "type",
      "expected_primary_cpt",
      "actual_primary_cpt",
      "primary_match",
      "cpt_jaccard",
      "icd_jaccard",
      "icd_precision",
      "icd_recall",
      "risk_score",
      "risk_band",
      "runtime_s",
      "tool_calls",
      // ─ payerAnalysis (forcing function v2) ─
      "payer_face_sheet",
      "patient_age",
      "payer_category",
      "payer_eligible_family",
      "payer_match_type",
      "payer_rule_id",
      // ─ limbThreatAssessment (forcing function v3) ─
      "limb_applicable",
      "limb_evidence_level",
      "limb_surgical_decision_status",
      // ─ mdm 2-of-3 ─
      "mdm_problems",
      "mdm_data",
      "mdm_risk",
      "mdm_final_level",
      // ─ surgeryDecision (-57) ─
      "surgery_evaluated_this_visit",
      "surgery_modifier57_applied",
      "error",
    ].join(","),
  );
  const csvCell = (v: unknown): string => {
    if (v == null) return "";
    const s = typeof v === "string" ? v : String(v);
    return `"${s.replace(/"/g, '""')}"`;
  };
  for (const r of results) {
    const e = r.expected;
    const c = r.comparison;
    const p = r.proposal;
    const pa = p?.payerAnalysis;
    const lt = p?.limbThreatAssessment;
    const mdm = p?.mdm;
    const sd = p?.surgeryDecision;
    const cells = [
      String(e.idx),
      `"${e.doctor.replace(/"/g, '""')}"`,
      `"${e.patientName.replace(/"/g, '""')}"`,
      e.dos,
      e.typeOfEncounter,
      e.cpts[0]?.cpt ?? "",
      p?.primaryCpt ?? "",
      c?.primaryCptExactMatch ? "1" : "0",
      c?.cptSet.jaccard.toFixed(3) ?? "",
      c?.icdSet.jaccard.toFixed(3) ?? "",
      c?.icdSet.precision.toFixed(3) ?? "",
      c?.icdSet.recall.toFixed(3) ?? "",
      p?.auditRiskScore != null ? String(p.auditRiskScore) : "",
      p?.riskBand ?? "",
      (r.runDurationMs / 1000).toFixed(1),
      String(r.toolCalls),
      // payerAnalysis
      csvCell(pa?.payerNameOnFaceSheet),
      pa?.patientAge != null ? String(pa.patientAge) : "",
      pa?.category ?? "",
      pa?.eligibleFamily ?? "",
      pa?.matchType ?? "",
      pa?.ruleId != null ? String(pa.ruleId) : "",
      // limbThreatAssessment
      lt ? (lt.applicable ? "1" : "0") : "",
      lt?.evidenceLevel ?? "",
      lt?.surgicalDecisionStatus ?? "",
      // mdm
      mdm?.problems ?? "",
      mdm?.data ?? "",
      mdm?.risk ?? "",
      mdm?.finalLevel ?? "",
      // surgeryDecision
      sd ? (sd.evaluatedThisVisit ? "1" : "0") : "",
      sd ? (sd.modifier57Applied ? "1" : "0") : "",
      `"${(r.error ?? "").replace(/"/g, '""')}"`,
    ];
    lines.push(cells.join(","));
  }
  fs.writeFileSync(outPath, lines.join("\n"), "utf8");
}

// ─── Main ────────────────────────────────────────────────────────────

function parseArgs(argv: string[]) {
  const out: Record<string, string> = {};
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) out[m[1]] = m[2] ?? "true";
  }
  return out as {
    csv?: string;
    "pdf-dir"?: string;
    limit?: string;
    offset?: string;
    idxs?: string;
    concurrency?: string;
    model?: string;
    specialty?: string;
    practice?: string;
    "out-dir"?: string;
    tag?: string;
  };
}

// ─── Manifest lookup ──────────────────────────────────────────────
//
// The manifest describes which PDF in --pdf-dir corresponds to which
// encounterIdx. It's written by hand (see test-data/hajira-pdfs/
// manifest.json). We index by encounterIdx and keep only the primary
// variant — alt exports like Zevallos's second PowerChart dump are
// skipped for the default run.

interface ManifestFile {
  file: string;
  encounterIdx: number;
  facesheet?: string;
  variant?: "primary" | "alt";
}
interface Manifest {
  files: ManifestFile[];
}

function loadManifest(pdfDir: string): Map<number, ManifestFile> {
  const mp = path.join(pdfDir, "manifest.json");
  if (!fs.existsSync(mp)) {
    throw new Error(
      `manifest.json not found at ${mp}. Point --pdf-dir at the folder that holds manifest.json + the PDFs.`,
    );
  }
  const raw = fs.readFileSync(mp, "utf8");
  const manifest = JSON.parse(raw) as Manifest;
  const byIdx = new Map<number, ManifestFile>();
  for (const f of manifest.files) {
    if (f.variant === "alt") continue;
    byIdx.set(f.encounterIdx, f);
  }
  return byIdx;
}

async function main() {
  const args = parseArgs(process.argv);
  const csvPath = path.resolve(
    args.csv ||
      path.join(__dirname, "../../../../Baptist Hospital Testing Files.csv"),
  );
  const pdfDir = path.resolve(
    args["pdf-dir"] ||
      path.join(__dirname, "../../../../test-data/hajira-pdfs"),
  );
  const limit = args.limit ? Number(args.limit) : null;
  const offset = args.offset ? Number(args.offset) : 0;
  const concurrency = Number(args.concurrency || 2);
  const modelVariant: "sonnet" | "haiku" =
    args.model === "haiku" ? "haiku" : "sonnet";
  const specialtyName = args.specialty || "Podiatry";
  const practiceName = args.practice || "Hanna Med Podiatry & Vascular";
  const outDir = path.resolve(args["out-dir"] || "./out");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  console.log(`Reading CSV:      ${csvPath}`);
  console.log(`Reading PDF dir:  ${pdfDir}`);
  if (!fs.existsSync(csvPath)) {
    console.error(`CSV not found: ${csvPath}`);
    process.exit(1);
  }
  if (!fs.existsSync(pdfDir)) {
    console.error(`PDF dir not found: ${pdfDir}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(csvPath, "utf8");
  const rows = parseCsv(raw);
  console.log(`Parsed ${rows.length} CSV rows (including header).`);

  const manifestByIdx = loadManifest(pdfDir);
  console.log(`Manifest: ${manifestByIdx.size} encounters with PDFs.`);

  const all = groupEncounters(rows);
  // Spot-check mode: --idxs=1,22,31 runs only those 1-based indices
  // and overrides --limit / --offset. Useful for re-running a small
  // set of calibration cases without spinning up 3 separate Nest
  // bootstraps.
  const idxList = args.idxs
    ? args.idxs
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n >= 1)
    : null;
  const encounters = idxList
    ? idxList
        .map((idx) => all[idx - 1])
        .filter((e): e is ExpectedEncounter => Boolean(e))
    : limit
      ? all.slice(offset, offset + limit)
      : all.slice(offset);
  const startIdx = idxList ? Math.min(...idxList) : offset + 1;
  const endIdx = idxList ? Math.max(...idxList) : offset + encounters.length;
  const tag =
    args.tag ||
    (idxList
      ? `idxs-${idxList.map((n) => String(n).padStart(2, "0")).join("_")}`
      : `${String(startIdx).padStart(2, "0")}-${String(endIdx).padStart(2, "0")}`);
  const runSpec = idxList
    ? `idxs=[${idxList.join(",")}] (${encounters.length})`
    : `#${startIdx}–${endIdx} (${encounters.length})`;
  console.log(
    `Grouped into ${all.length} encounters. Running ${runSpec} with concurrency=${concurrency}, model=${modelVariant}. Tag=${tag}.`,
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn"],
  });
  const coder = app.get(CoderAgent);
  const redaction = app.get(RedactionService);
  const prisma = app.get(PrismaService);

  // Pre-load the Podiatry specialty delta once.
  const specialty = await prisma.specialty.findFirst({
    where: { name: specialtyName },
    select: { name: true, systemPrompt: true },
  });
  if (!specialty) {
    console.warn(
      `Specialty "${specialtyName}" not found in DB — will run with name-only (no delta).`,
    );
  }

  // Pre-load the practice convention delta + practiceId once. The
  // agent uses the convention delta as the third cache_control block
  // and the practiceId to scope `lookup_payer_rule` to this group's
  // payer matrix. Missing practice = warn and run global-only.
  const practice = await prisma.practice.findFirst({
    where: { name: practiceName },
    select: {
      id: true,
      name: true,
      systemPrompt: true,
      medicareLocality: true,
      medicareContractorNumber: true,
    },
  });
  if (!practice) {
    console.warn(
      `Practice "${practiceName}" not found in DB — running with no practice convention delta and global-only payer rules.`,
    );
  } else {
    console.log(
      `Practice loaded: id=${practice.id} "${practice.name}" (${practice.systemPrompt.length} chars convention delta)`,
    );
  }

  const t0 = Date.now();
  // Live progress aggregator. Each encounter callback updates these
  // when it returns; every 10 completions we print a summary line so
  // the operator can eyeball progress without grep-piping the full log.
  const progress = {
    done: 0,
    matches: 0,
    misses: 0,
    errors: 0,
    skipped: 0,
  };
  const totalEncounters = encounters.length;
  const PROGRESS_EVERY = 10;
  const printProgress = () => {
    const pct = ((progress.done / totalEncounters) * 100).toFixed(1);
    const elapsedMs = Date.now() - t0;
    const elapsedMin = (elapsedMs / 60_000).toFixed(1);
    const ratePerEnc = progress.done > 0 ? elapsedMs / progress.done : 0;
    const remaining = totalEncounters - progress.done;
    const etaMin = ((remaining * ratePerEnc) / 60_000).toFixed(1);
    const matchRate =
      progress.matches + progress.misses > 0
        ? (
            (progress.matches / (progress.matches + progress.misses)) *
            100
          ).toFixed(1)
        : "—";
    console.log(
      `\n📊 PROGRESS: ${progress.done}/${totalEncounters} (${pct}%) · ` +
        `match ${progress.matches}/${progress.matches + progress.misses} (${matchRate}%) · ` +
        `errors ${progress.errors} · skipped ${progress.skipped} · ` +
        `elapsed ${elapsedMin}m · eta ${etaMin}m\n`,
    );
  };

  const results = await withConcurrency<ExpectedEncounter, EncounterResult>(
    encounters,
    concurrency,
    async (enc, i) => {
      const label = `[${i + 1}/${encounters.length}] ${enc.patientName}`;

      // Mirror production flow: note text + insurance come from PDFs,
      // not from the CSV. Encounters without a PDF in the manifest
      // are skipped here — we don't want to silently fall back to the
      // CSV text and contaminate the comparison.
      // Helper to bump the shared progress counter and emit a summary
      // line every PROGRESS_EVERY completions. Idempotent per encounter
      // — call once before returning.
      const finish = (
        result: EncounterResult,
        bucket: "match" | "miss" | "error" | "skip",
      ): EncounterResult => {
        progress.done++;
        if (bucket === "match") progress.matches++;
        else if (bucket === "miss") progress.misses++;
        else if (bucket === "error") progress.errors++;
        else progress.skipped++;
        if (
          progress.done % PROGRESS_EVERY === 0 ||
          progress.done === totalEncounters
        ) {
          printProgress();
        }
        return result;
      };

      const manifestEntry = manifestByIdx.get(enc.idx);
      if (!manifestEntry) {
        console.log(`${label} — SKIP (no PDF in manifest for idx ${enc.idx})`);
        return finish(
          {
            expected: enc,
            proposal: null,
            runDurationMs: 0,
            toolCalls: 0,
            error: `No PDF for encounter #${enc.idx} in manifest`,
          },
          "skip",
        );
      }

      const notePath = path.join(pdfDir, manifestEntry.file);
      if (!fs.existsSync(notePath)) {
        console.log(`${label} — SKIP (note PDF missing at ${notePath})`);
        return finish(
          {
            expected: enc,
            proposal: null,
            runDurationMs: 0,
            toolCalls: 0,
            error: `Note PDF file missing: ${manifestEntry.file}`,
          },
          "skip",
        );
      }

      let rawNoteText: string;
      try {
        rawNoteText = await extractPdfText(notePath);
      } catch (err) {
        console.error(
          `${label} — PDF extract failed: ${(err as Error).message}`,
        );
        return finish(
          {
            expected: enc,
            proposal: null,
            runDurationMs: 0,
            toolCalls: 0,
            error: `PDF extract failed: ${(err as Error).message}`,
          },
          "error",
        );
      }
      if (!rawNoteText || rawNoteText.trim().length < 50) {
        console.log(
          `${label} — SKIP (note PDF produced ${rawNoteText.length} chars)`,
        );
        return finish(
          {
            expected: enc,
            proposal: null,
            runDurationMs: 0,
            toolCalls: 0,
            error: "Note PDF produced empty text",
          },
          "skip",
        );
      }

      // Face sheet (optional): same flow as the clinical note — we
      // extract raw text and let the agent read it. No upstream
      // regex, no structured parsing. Any failure drops the face
      // sheet silently; the prompt handles the "no face sheet" case.
      let rawFaceSheetText = "";
      if (manifestEntry.facesheet) {
        const fsPath = path.join(pdfDir, manifestEntry.facesheet);
        if (fs.existsSync(fsPath)) {
          try {
            rawFaceSheetText = await extractPdfText(fsPath);
            if (rawFaceSheetText.length < 50) {
              console.warn(
                `${label} — face sheet produced ${rawFaceSheetText.length} chars, treating as missing`,
              );
              rawFaceSheetText = "";
            }
          } catch (err) {
            console.warn(
              `${label} — face sheet extract failed: ${(err as Error).message}`,
            );
          }
        }
      }

      // Concatenate note + face sheet BEFORE redacting so token
      // counters stay consistent across both (same divider as
      // CodingService). After redact, split back into the two
      // labeled halves the agent receives.
      const combined = rawFaceSheetText
        ? rawNoteText + NOTE_FACESHEET_DIVIDER + rawFaceSheetText
        : rawNoteText;
      const { redacted, tokens } = redaction.redact(combined);
      const [noteRedacted, faceSheetRedacted] = rawFaceSheetText
        ? (redacted.split(NOTE_FACESHEET_DIVIDER) as [string, string])
        : [redacted, ""];
      console.log(
        `${label} — starting · note ${rawNoteText.length}c · facesheet ${rawFaceSheetText.length}c`,
      );
      const runStart = Date.now();
      // Normalize Hajira's "Type of Encounter" column to the agent's enum:
      // "Consult" → CONSULT (initial specialty visit, 99221-99223),
      // "Procedure" → PROCEDURE (surgical CPT is primary),
      // anything else → undefined (let the agent infer).
      const et = enc.typeOfEncounter.trim().toLowerCase();
      const encounterType: "CONSULT" | "PROCEDURE" | "PROGRESS" | undefined =
        et === "consult"
          ? "CONSULT"
          : et === "procedure"
            ? "PROCEDURE"
            : et === "progress" || et === "follow-up"
              ? "PROGRESS"
              : undefined;
      // Batch is a calibration tool — pull locality/contractor from
      // the practice row when one is selected, refuse to run when
      // it's missing. Same no-fallback rule as the production path.
      if (!practice) {
        throw new Error(
          `--practice "${practiceName}" did not resolve to a Practice row; cannot run batch without a configured Medicare locality/contractor.`,
        );
      }
      try {
        const res = await runCoderWithRetry(
          coder,
          {
            noteText: noteRedacted,
            faceSheetText: faceSheetRedacted || undefined,
            locality: practice.medicareLocality,
            contractorNumber: practice.medicareContractorNumber,
            specialty: specialty
              ? {
                  name: specialty.name,
                  systemPrompt: specialty.systemPrompt,
                }
              : { name: specialtyName, systemPrompt: "" },
            practice: {
              name: practice.name,
              systemPrompt: practice.systemPrompt,
            },
            practiceId: practice.id,
            // Every batch encounter is hospital-inpatient consults
            // by construction (the seed locks them to BAPTIST). We
            // pass POS=21 explicitly here, not as a fallback —
            // changing the test set requires changing this line.
            pos: "21",
            encounterType,
            modelVariant,
            year: new Date().getFullYear(),
          },
          label,
        );
        const runDurationMs = Date.now() - runStart;
        if (!res.proposal) {
          console.log(
            `${label} — NO PROPOSAL (${(runDurationMs / 1000).toFixed(1)}s)`,
          );
          return finish(
            {
              expected: enc,
              proposal: null,
              runDurationMs,
              toolCalls: res.toolCalls.length,
              error: "Agent finished without finalize_coding",
            },
            "error",
          );
        }
        const hydrated = redaction.rehydrateDeep(res.proposal, tokens);
        const comparison = compare(enc, hydrated);
        const mark = comparison.primaryCptExactMatch ? "✓" : "✗";
        console.log(
          `${label} — ${mark} primary CPT ${hydrated.primaryCpt} vs ${enc.cpts[0]?.cpt ?? "?"} · ICD Jaccard ${comparison.icdSet.jaccard.toFixed(2)} · ${(runDurationMs / 1000).toFixed(1)}s`,
        );
        return finish(
          {
            expected: enc,
            proposal: hydrated,
            runDurationMs,
            toolCalls: res.toolCalls.length,
            comparison,
          },
          comparison.primaryCptExactMatch ? "match" : "miss",
        );
      } catch (e) {
        const runDurationMs = Date.now() - runStart;
        console.error(`${label} — THREW: ${(e as Error).message}`);
        return finish(
          {
            expected: enc,
            proposal: null,
            runDurationMs,
            toolCalls: 0,
            error: (e as Error).message,
          },
          "error",
        );
      }
    },
  );
  const totalMs = Date.now() - t0;
  console.log(
    `\nAll done in ${(totalMs / 1000 / 60).toFixed(1)} min (wall). Writing reports to ${outDir}/…`,
  );

  fs.writeFileSync(
    path.join(outDir, `batch-validate-results-${tag}.json`),
    JSON.stringify(results, null, 2),
    "utf8",
  );
  writeMarkdownReport(
    results,
    path.join(outDir, `batch-validate-report-${tag}.md`),
  );
  writeMetricsCsv(
    results,
    path.join(outDir, `batch-validate-metrics-${tag}.csv`),
  );

  // Quick summary to stdout.
  const ok = results.filter((r) => r.proposal !== null);
  const primaryMatches = ok.filter(
    (r) => r.comparison?.primaryCptExactMatch,
  ).length;
  console.log(`\n=== SUMMARY ===`);
  console.log(`  Encounters ran: ${ok.length}/${results.length}`);
  console.log(
    `  Primary CPT exact: ${primaryMatches}/${ok.length} (${((primaryMatches / Math.max(1, ok.length)) * 100).toFixed(1)}%)`,
  );
  console.log(`  Output: ${pad(outDir, 40)}`);

  // Nest shutdown can race ioredis disconnect — the actual error
  // ("Connection is closed") fires AFTER all output files are written.
  // Swallow it so the process exits clean and the run isn't marked as
  // failed by the bash background-task harness. Real failures
  // (errored encounters, missed proposals) are already in the JSON/CSV.
  try {
    await app.close();
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    if (!/connection is closed|disconnected/i.test(msg)) {
      console.warn(`app.close() threw (ignored): ${msg}`);
    }
  }
}

// Only auto-run when invoked directly, not when imported by dry-parse.
if (require.main === module) {
  // Quiet ioredis post-shutdown noise. The connection-closed errors fire
  // as unhandled rejections from inside the redis client well after
  // app.close() returns; without this they propagate and exit-1 the
  // process even though all reports have already been written.
  process.on("unhandledRejection", (reason) => {
    const msg = (reason as Error)?.message ?? String(reason);
    if (/connection is closed|disconnected/i.test(msg)) return;
    console.error("Unhandled rejection:", reason);
    process.exit(1);
  });
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
