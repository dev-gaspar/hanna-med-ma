/**
 * Dry-run of the CSV parser + encounter grouping — no agent call,
 * no DB, no Claude. Sanity-check that the CSV reads correctly before
 * we spend Anthropic tokens.
 *
 *   npx ts-node -r dotenv/config -T src/coverage/scripts/dry-parse-csv.ts
 */
import * as fs from "fs";
import * as path from "path";

// Re-export the parsing functions from batch-validate so we test the
// same code. Using a dynamic require so we don't circular-import.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mod = require("./batch-validate") as {
  parseCsv: (t: string) => string[][];
  groupEncounters: (rows: string[][]) => unknown[];
};

// Re-import the non-exported helpers by re-requiring through a local
// wrapper — but `batch-validate.ts` doesn't export them. Instead,
// inline duplicate the two top-level helpers here since they're
// small, so this dry-run script has zero dependency on batch-validate
// internals.

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
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

async function main() {
  const csvPath = path.resolve(
    process.argv[2] ||
      path.join(__dirname, "../../../../Baptist Hospital Testing Files.csv"),
  );
  console.log(`Reading: ${csvPath}`);
  const raw = fs.readFileSync(csvPath, "utf8");
  const rows = parseCsv(raw);
  console.log(`\nTotal CSV rows: ${rows.length}`);

  const header = rows[0];
  console.log(`\nHeader columns: ${header.length}`);
  for (let i = 0; i < header.length; i++) {
    console.log(`  ${i}: "${header[i]}"`);
  }

  // Rudimentary diagnosis: how many rows appear to be continuation rows?
  let continuations = 0;
  let newEncounters = 0;
  for (let r = 1; r < rows.length; r++) {
    const doctor = rows[r][0] ?? "";
    const patient = rows[r][1] ?? "";
    if (!doctor && !patient) continuations++;
    else newEncounters++;
  }
  console.log(
    `\nRows: ${newEncounters} new encounter + ${continuations} continuation (multi-CPT procedures).`,
  );

  console.log(`\n=== Groups (using batch-validate.groupEncounters) ===`);
  const grouped = mod.groupEncounters(rows);
  console.log(`Grouped encounters: ${grouped.length}\n`);
  for (const e of grouped as Array<{
    idx: number;
    doctor: string;
    patientName: string;
    dos: string;
    typeOfEncounter: string;
    cpts: Array<{ cpt: string; modifiers: string[] }>;
    icd10: string[];
  }>) {
    const cptSummary = e.cpts
      .map((c) =>
        c.modifiers.length ? `${c.cpt}-${c.modifiers.join("-")}` : c.cpt,
      )
      .join(", ");
    console.log(
      `#${String(e.idx).padStart(2)} ${e.dos}  ${e.typeOfEncounter.padEnd(9)}  ${e.patientName.padEnd(30)} — CPT: ${cptSummary}  (ICDs: ${e.icd10.length})`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
