/**
 * NCCI PTP (Procedure-to-Procedure) edits loader.
 *
 * Streams every tab-delimited TXT inside the CMS quarterly release
 * into ncci_edits via Postgres COPY FROM STDIN — the only way to
 * land ~5M rows against a remote DB in anything under an hour.
 *
 *   npx ts-node -r dotenv/config src/coverage/scripts/load-ncci.ts \
 *       --dir ./data/ncci/2026q2 \
 *       --quarter 2026Q2
 *
 * Source: cms.gov /medicare/coding-billing/national-correct-coding-initiative-ncci-edits/medicare-ncci-procedure-procedure-ptp-edits
 *
 * Each ZIP (f1..f4 for practitioner and hospital) ships a .TXT with:
 *   1 line: CPT copyright banner
 *   1 line: "Column1/Column2 Edits"
 *   3 lines: wrapped column headers
 *   1 line: modifier indicator legend
 *   N lines: tab-delimited data rows
 *
 * Data columns (tab-delimited, YYYYMMDD dates, `*` sentinels):
 *   [0] Column 1 CPT
 *   [1] Column 2 CPT
 *   [2] "*" if in existence prior to 1996 (else empty)
 *   [3] Effective Date  (YYYYMMDD)
 *   [4] Deletion Date   (YYYYMMDD or "*" = not deleted)
 *   [5] Modifier Indicator ("0" | "1" | "9")
 *   [6] PTP Edit Rationale
 */

import { Client } from "pg";
import { from as copyFrom } from "pg-copy-streams";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

function parseArgs(argv: string[]) {
  const out: Record<string, string> = {};
  for (let i = 2; i < argv.length; i += 2) {
    const k = argv[i]?.replace(/^--/, "");
    const v = argv[i + 1];
    if (k && v) out[k] = v;
  }
  return out as { dir: string; quarter: string };
}

// Parse YYYYMMDD to ISO date. "*" (no-deletion sentinel) and blanks → null.
function parseYyyymmdd(s: string): string | null {
  const t = s.trim();
  if (!t || t === "*") return null;
  if (!/^\d{8}$/.test(t)) return null;
  return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
}

// COPY FROM STDIN uses tabs as delimiters and \N for null by default,
// so we escape tabs, newlines, backslashes in field values.
function copyEscape(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\t/g, "\\t")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
}

async function streamFile(
  client: Client,
  filePath: string,
  editType: "PRACTITIONER" | "HOSPITAL",
  quarter: string,
): Promise<number> {
  // Kick off COPY on the DB side, then pipe one line at a time.
  const stream = client.query(
    copyFrom(
      `COPY ncci_edits ("column1Cpt","column2Cpt","priorTo1996","effectiveDate","deletionDate","modifierIndicator","rationale","editType","quarter","createdAt")
			 FROM STDIN WITH (FORMAT text, DELIMITER E'\\t', NULL '\\N')`,
    ),
  );

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  });

  const now = new Date().toISOString();
  let rows = 0;

  // A buffer keeps backpressure sane: write in 256 KiB chunks.
  let buf = "";
  const FLUSH_AT = 256 * 1024;
  const flush = async () => {
    if (!buf) return;
    if (!stream.write(buf)) {
      await new Promise<void>((r) => stream.once("drain", () => r()));
    }
    buf = "";
  };

  for await (const rawLine of rl) {
    const cols = rawLine.split("\t");
    if (cols.length < 7) continue;
    const col1 = cols[0]?.trim();
    const col2 = cols[1]?.trim();
    if (!/^[A-Z0-9]{5}$/.test(col1 || "")) continue;
    if (!/^[A-Z0-9]{5}$/.test(col2 || "")) continue;

    const priorTo1996 = (cols[2] || "").trim() === "*";
    const effDate = parseYyyymmdd(cols[3] || "");
    const delDate = parseYyyymmdd(cols[4] || "");
    const modInd = (cols[5] || "").trim();
    const rationale = (cols[6] || "").trim();

    if (!effDate || !/^[019]$/.test(modInd)) continue;

    const fields = [
      col1,
      col2,
      priorTo1996 ? "t" : "f",
      effDate,
      delDate || "\\N",
      modInd,
      rationale ? copyEscape(rationale) : "\\N",
      editType,
      quarter,
      now,
    ];
    buf += fields.join("\t") + "\n";
    rows++;

    if (buf.length >= FLUSH_AT) await flush();
    if (rows % 250000 === 0) process.stdout.write(`\r    ${rows} rows`);
  }
  await flush();

  await new Promise<void>((resolve, reject) => {
    stream.on("finish", () => resolve());
    stream.on("error", (e) => reject(e));
    stream.end();
  });
  process.stdout.write(`\r    ${rows} rows (done).\n`);
  return rows;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.dir || !args.quarter) {
    console.error(
      "Usage: ts-node load-ncci.ts --dir <root with practitioner/ and hospital/> --quarter 2026Q2",
    );
    process.exit(1);
  }

  const databaseUrl = process.env.SERVER_DATABASE_URL;
  if (!databaseUrl) throw new Error("SERVER_DATABASE_URL not set");
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    // Rerunnable: wipe this quarter first so PKs don't clash.
    const { rowCount } = await client.query(
      `DELETE FROM ncci_edits WHERE quarter = $1`,
      [args.quarter],
    );
    console.log(`Cleared ${rowCount ?? 0} rows for quarter ${args.quarter}.`);

    let total = 0;
    for (const kind of ["practitioner", "hospital"] as const) {
      const subdir = path.join(args.dir, kind);
      if (!fs.existsSync(subdir)) {
        console.warn(`Skipping — not found: ${subdir}`);
        continue;
      }
      const files = fs
        .readdirSync(subdir)
        .filter((f) => /\.txt$/i.test(f))
        .map((f) => path.join(subdir, f))
        .sort();
      console.log(`\n→ ${kind} (${files.length} files)`);
      for (const f of files) {
        console.log(`  ${path.basename(f)}`);
        total += await streamFile(
          client,
          f,
          kind === "practitioner" ? "PRACTITIONER" : "HOSPITAL",
          args.quarter,
        );
      }
    }
    console.log(`\nTotal NCCI edits loaded: ${total}`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
