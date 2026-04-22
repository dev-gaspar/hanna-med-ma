/**
 * Batch validator for the AI Coder — runs every encounter in Hajira's
 * Baptist Testing Files CSV against the agent and compares the output
 * against her ground-truth CPTs + ICD-10 codes.
 *
 *   npx ts-node -r dotenv/config -T src/coverage/scripts/batch-validate.ts \
 *     --csv="./Baptist Hospital Testing Files.csv" \
 *     --limit=5 --concurrency=2
 *
 * Flags:
 *   --csv         path to the CSV (default: repo root)
 *   --limit N     only run N encounters starting from --offset
 *   --offset N    skip the first N encounters (for iterative batches)
 *   --concurrency N workers in parallel (default 2)
 *   --model       "haiku" (fast, higher rate limits) or "sonnet" (default, prod-quality)
 *   --specialty   specialty name (default "Podiatry")
 *   --out-dir     where to write the 3 output files (default ./out)
 *   --tag S       suffix for output filenames (default: "<offset+1>-<offset+limit>")
 *
 * Outputs under --out-dir:
 *   batch-validate-results.json   — raw per-encounter results (big)
 *   batch-validate-report.md      — human-readable summary + detail
 *   batch-validate-metrics.csv    — one row per encounter, tabular
 *
 * This script bypasses the CodingService / S3 / PDF path entirely —
 * the note text comes straight from the CSV's Clinical Notes +
 * Assessment plan columns (the same text Hajira read when she coded).
 * That keeps the comparison apples-to-apples and lets us validate
 * historical encounters that never hit our RPA pipeline.
 */
import * as fs from "fs";
import * as path from "path";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../../app.module";
import { CoderAgent, CoderProposal } from "../../ai/agents/coder.agent";
import { RedactionService } from "../../redaction/redaction.service";
import { PrismaService } from "../../core/prisma.service";

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
  lines.push(
    "idx,doctor,patient,dos,type,expected_primary_cpt,actual_primary_cpt,primary_match,cpt_jaccard,icd_jaccard,icd_precision,icd_recall,risk_score,risk_band,runtime_s,tool_calls,error",
  );
  for (const r of results) {
    const e = r.expected;
    const c = r.comparison;
    const p = r.proposal;
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
    limit?: string;
    offset?: string;
    concurrency?: string;
    model?: string;
    specialty?: string;
    "out-dir"?: string;
    tag?: string;
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const csvPath = path.resolve(
    args.csv ||
      path.join(__dirname, "../../../../Baptist Hospital Testing Files.csv"),
  );
  const limit = args.limit ? Number(args.limit) : null;
  const offset = args.offset ? Number(args.offset) : 0;
  const concurrency = Number(args.concurrency || 2);
  const modelVariant: "sonnet" | "haiku" =
    args.model === "haiku" ? "haiku" : "sonnet";
  const specialtyName = args.specialty || "Podiatry";
  const outDir = path.resolve(args["out-dir"] || "./out");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  console.log(`Reading CSV: ${csvPath}`);
  if (!fs.existsSync(csvPath)) {
    console.error(`CSV not found: ${csvPath}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(csvPath, "utf8");
  const rows = parseCsv(raw);
  console.log(`Parsed ${rows.length} CSV rows (including header).`);

  const all = groupEncounters(rows);
  const encounters = limit
    ? all.slice(offset, offset + limit)
    : all.slice(offset);
  const startIdx = offset + 1;
  const endIdx = offset + encounters.length;
  const tag =
    args.tag ||
    `${String(startIdx).padStart(2, "0")}-${String(endIdx).padStart(2, "0")}`;
  console.log(
    `Grouped into ${all.length} encounters. Running #${startIdx}–${endIdx} (${encounters.length}) with concurrency=${concurrency}, model=${modelVariant}. Tag=${tag}.`,
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

  const t0 = Date.now();
  const results = await withConcurrency<ExpectedEncounter, EncounterResult>(
    encounters,
    concurrency,
    async (enc, i) => {
      const label = `[${i + 1}/${encounters.length}] ${enc.patientName}`;
      // For PROCEDURE encounters Hajira's "Clinical Notes" column
      // is often just a one-line procedure description; her
      // "Assesment plan" column has the actual operative detail.
      // Flip the order so the agent sees the longer block first.
      const isProcedure =
        enc.typeOfEncounter.trim().toLowerCase() === "procedure";
      const rawText = (
        isProcedure
          ? [enc.assessmentPlan, "", enc.clinicalNotes]
          : [enc.clinicalNotes, "", enc.assessmentPlan]
      )
        .filter(Boolean)
        .join("\n");
      if (rawText.trim().length < 20) {
        console.log(`${label} — SKIP (empty note)`);
        return {
          expected: enc,
          proposal: null,
          runDurationMs: 0,
          toolCalls: 0,
          error: "Empty clinical notes + assessment",
        };
      }
      const { redacted, tokens } = redaction.redact(rawText);
      console.log(`${label} — starting`);
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
      try {
        const res = await coder.run({
          noteText: redacted,
          locality: "04",
          contractorNumber: "09102",
          specialty: specialty
            ? {
                name: specialty.name,
                systemPrompt: specialty.systemPrompt,
              }
            : { name: specialtyName, systemPrompt: "" },
          pos: "21",
          encounterType,
          modelVariant,
          year: new Date().getFullYear(),
        });
        const runDurationMs = Date.now() - runStart;
        if (!res.proposal) {
          console.log(
            `${label} — NO PROPOSAL (${(runDurationMs / 1000).toFixed(1)}s)`,
          );
          return {
            expected: enc,
            proposal: null,
            runDurationMs,
            toolCalls: res.toolCalls.length,
            error: "Agent finished without finalize_coding",
          };
        }
        const hydrated = redaction.rehydrateDeep(res.proposal, tokens);
        const comparison = compare(enc, hydrated);
        const mark = comparison.primaryCptExactMatch ? "✓" : "✗";
        console.log(
          `${label} — ${mark} primary CPT ${hydrated.primaryCpt} vs ${enc.cpts[0]?.cpt ?? "?"} · ICD Jaccard ${comparison.icdSet.jaccard.toFixed(2)} · ${(runDurationMs / 1000).toFixed(1)}s`,
        );
        return {
          expected: enc,
          proposal: hydrated,
          runDurationMs,
          toolCalls: res.toolCalls.length,
          comparison,
        };
      } catch (e) {
        const runDurationMs = Date.now() - runStart;
        console.error(`${label} — THREW: ${(e as Error).message}`);
        return {
          expected: enc,
          proposal: null,
          runDurationMs,
          toolCalls: 0,
          error: (e as Error).message,
        };
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

  await app.close();
}

// Only auto-run when invoked directly, not when imported by dry-parse.
if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
