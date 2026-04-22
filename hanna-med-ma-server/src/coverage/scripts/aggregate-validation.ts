/**
 * Aggregates all `batch-validate-metrics-*.csv` files into a single
 * long-form CSV + per-cycle summary. Meant to be run after every
 * validation cycle so we have chart-ready data at any point.
 *
 *   npx ts-node -r dotenv/config -T src/coverage/scripts/aggregate-validation.ts
 *
 * Outputs (under the same --out-dir, default ./out):
 *   validation-all-encounters.csv    one row per encounter across every cycle
 *   validation-per-cycle-summary.csv one row per cycle (for line/bar charts)
 *   validation-overview.md           human-readable rollup
 */
import * as fs from "fs";
import * as path from "path";

interface MetricRow {
  idx: string;
  doctor: string;
  patient: string;
  dos: string;
  type: string;
  expected_primary_cpt: string;
  actual_primary_cpt: string;
  primary_match: string;
  cpt_jaccard: string;
  icd_jaccard: string;
  icd_precision: string;
  icd_recall: string;
  risk_score: string;
  risk_band: string;
  runtime_s: string;
  tool_calls: string;
  error: string;
  // Added by the aggregator:
  cycle_tag: string;
  cycle_order: string;
}

function parseCsvRow(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQ = false;
        }
      } else cur += ch;
      continue;
    }
    if (ch === '"') {
      inQ = true;
      continue;
    }
    if (ch === ",") {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function readMetricsCsv(
  filePath: string,
  tag: string,
  order: number,
): MetricRow[] {
  const text = fs.readFileSync(filePath, "utf8");
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const header = parseCsvRow(lines[0]);
  const rows: MetricRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvRow(lines[i]);
    const row: Record<string, string> = {};
    header.forEach((h, j) => {
      row[h] = cells[j] ?? "";
    });
    row.cycle_tag = tag;
    row.cycle_order = String(order);
    rows.push(row as unknown as MetricRow);
  }
  return rows;
}

function num(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function avg(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function esc(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function main() {
  const outDir = path.resolve(process.argv[2] || "./out");
  if (!fs.existsSync(outDir)) {
    console.error(`Out dir does not exist: ${outDir}`);
    process.exit(1);
  }

  const files = fs
    .readdirSync(outDir)
    .filter(
      (f) => f.startsWith("batch-validate-metrics-") && f.endsWith(".csv"),
    )
    .sort(); // lexicographic sort = numerical since tags are zero-padded

  if (files.length === 0) {
    console.log(
      "No metrics CSVs found — run `batch-validate` for at least one cycle first.",
    );
    return;
  }

  console.log(`Found ${files.length} cycle metrics files:`);
  for (const f of files) console.log(`  ${f}`);

  const allRows: MetricRow[] = [];
  const perCycle: Array<{
    tag: string;
    order: number;
    total: number;
    ran: number;
    primaryMatches: number;
    cptJaccard: number;
    icdJaccard: number;
    icdPrecision: number;
    icdRecall: number;
    avgRuntimeS: number;
  }> = [];

  files.forEach((f, idx) => {
    const tag = f.replace("batch-validate-metrics-", "").replace(".csv", "");
    const rows = readMetricsCsv(path.join(outDir, f), tag, idx + 1);
    allRows.push(...rows);

    const ran = rows.filter((r) => !r.error);
    perCycle.push({
      tag,
      order: idx + 1,
      total: rows.length,
      ran: ran.length,
      primaryMatches: ran.filter((r) => r.primary_match === "1").length,
      cptJaccard: avg(ran.map((r) => num(r.cpt_jaccard))),
      icdJaccard: avg(ran.map((r) => num(r.icd_jaccard))),
      icdPrecision: avg(ran.map((r) => num(r.icd_precision))),
      icdRecall: avg(ran.map((r) => num(r.icd_recall))),
      avgRuntimeS: avg(rows.map((r) => num(r.runtime_s))),
    });
  });

  // 1. Long-form: all encounters, one per row, with cycle tag.
  const allHeader = [
    "cycle_tag",
    "cycle_order",
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
    "error",
  ];
  const allCsvLines = [allHeader.join(",")];
  for (const r of allRows) {
    allCsvLines.push(
      allHeader
        .map((h) => esc((r as unknown as Record<string, string>)[h] ?? ""))
        .join(","),
    );
  }
  fs.writeFileSync(
    path.join(outDir, "validation-all-encounters.csv"),
    allCsvLines.join("\n"),
    "utf8",
  );

  // 2. Per-cycle summary — chart-ready.
  const cycleHeader = [
    "cycle_tag",
    "cycle_order",
    "total",
    "ran",
    "primary_matches",
    "primary_match_rate",
    "cpt_jaccard_avg",
    "icd_jaccard_avg",
    "icd_precision_avg",
    "icd_recall_avg",
    "avg_runtime_s",
  ];
  const cycleLines = [cycleHeader.join(",")];
  for (const c of perCycle) {
    cycleLines.push(
      [
        c.tag,
        String(c.order),
        String(c.total),
        String(c.ran),
        String(c.primaryMatches),
        (c.ran > 0 ? c.primaryMatches / c.ran : 0).toFixed(3),
        c.cptJaccard.toFixed(3),
        c.icdJaccard.toFixed(3),
        c.icdPrecision.toFixed(3),
        c.icdRecall.toFixed(3),
        c.avgRuntimeS.toFixed(1),
      ].join(","),
    );
  }
  fs.writeFileSync(
    path.join(outDir, "validation-per-cycle-summary.csv"),
    cycleLines.join("\n"),
    "utf8",
  );

  // 3. Markdown overview.
  const md: string[] = [];
  md.push(`# Validation — cumulative overview`);
  md.push("");
  md.push(`**Cycles ran**: ${perCycle.length}`);
  md.push(`**Total encounters scored**: ${allRows.length}`);
  md.push(
    `**Overall primary CPT match**: ${allRows.filter((r) => r.primary_match === "1").length}/${allRows.filter((r) => !r.error).length}`,
  );
  md.push("");
  md.push("## Per-cycle trajectory");
  md.push("");
  md.push(
    "| Cycle | Encounters | Ran | Primary CPT | CPT Jaccard | ICD Jaccard | ICD Precision | ICD Recall | Avg runtime |",
  );
  md.push("|---|---|---|---|---|---|---|---|---|");
  for (const c of perCycle) {
    const rate = c.ran > 0 ? (c.primaryMatches / c.ran) * 100 : 0;
    md.push(
      `| ${c.tag} | ${c.total} | ${c.ran} | ${c.primaryMatches}/${c.ran} (${rate.toFixed(0)}%) | ${c.cptJaccard.toFixed(3)} | ${c.icdJaccard.toFixed(3)} | ${c.icdPrecision.toFixed(3)} | ${c.icdRecall.toFixed(3)} | ${c.avgRuntimeS.toFixed(1)}s |`,
    );
  }
  md.push("");
  md.push("## Data files");
  md.push("");
  md.push(
    `- \`validation-all-encounters.csv\` — long-form, one row per encounter per cycle. For pivot tables, per-doctor breakdowns, individual-case drilldowns.`,
  );
  md.push(
    `- \`validation-per-cycle-summary.csv\` — one row per cycle. For line charts showing trajectory.`,
  );
  md.push(
    `- \`batch-validate-report-<tag>.md\` — per-cycle prose report with per-encounter detail.`,
  );
  fs.writeFileSync(
    path.join(outDir, "validation-overview.md"),
    md.join("\n"),
    "utf8",
  );

  console.log(`\nWrote:`);
  console.log(`  ${path.join(outDir, "validation-all-encounters.csv")}`);
  console.log(`  ${path.join(outDir, "validation-per-cycle-summary.csv")}`);
  console.log(`  ${path.join(outDir, "validation-overview.md")}`);
  console.log(`\nCurrent state:`);
  const ranAll = allRows.filter((r) => !r.error);
  const matchAll = ranAll.filter((r) => r.primary_match === "1");
  console.log(
    `  Cycles: ${perCycle.length}  ·  Encounters ran: ${ranAll.length}  ·  Primary CPT match: ${matchAll.length}/${ranAll.length} (${ranAll.length > 0 ? ((matchAll.length / ranAll.length) * 100).toFixed(1) : "0"}%)`,
  );
}

main();
