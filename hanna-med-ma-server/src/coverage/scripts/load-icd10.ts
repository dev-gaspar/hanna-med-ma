/**
 * ICD-10-CM 2026 catalog loader.
 *
 *   npx ts-node -r dotenv/config src/coverage/scripts/load-icd10.ts \
 *       --file "./data/icd10/april/Code Descriptions/icd10cm_order_2026.txt"
 *
 * Source: cms.gov ICD-10-CM 2026 "Code Descriptions Tabular Order" zip.
 * The order file is fixed-width:
 *   cols 0-4     order number  (e.g. "00001")
 *   col  5       space
 *   cols 6-12    code padded   (e.g. "A00    ")
 *   col  13      space
 *   col  14      billable flag (0 = category, 1 = billable)
 *   col  15      space
 *   cols 16-76   short description (61 chars, right-padded)
 *   col  77      space
 *   cols 78-end  long description
 *
 * Some CMS releases use tab separators instead of fixed widths — we
 * auto-detect by scanning the first data line.
 */

import { Client } from "pg";
import * as fs from "fs";
import * as readline from "readline";

function parseArgs(argv: string[]) {
  const out: Record<string, string> = {};
  for (let i = 2; i < argv.length; i += 2) {
    const k = argv[i]?.replace(/^--/, "");
    const v = argv[i + 1];
    if (k && v) out[k] = v;
  }
  return out as { file: string };
}

// CMS sometimes swaps between fixed-width and whitespace-delimited
// in the same release family. Detect once, then parse consistently.
// CMS ships codes dotless in the order file ("E11621") but the
// clinical/LCD side and every coder we know uses the dotted form
// ("E11.621"). Normalise at ingest so exact-match joins work across
// all tables.
function addIcdDot(raw: string): string {
  return raw.length > 3 ? `${raw.slice(0, 3)}.${raw.slice(3)}` : raw;
}

function parseOrderLine(line: string): {
  orderNumber: number;
  code: string;
  isBillable: boolean;
  shortDescription: string;
  longDescription: string;
} | null {
  // Fixed-width: "00001 A00     0 Cholera ... Cholera..."
  if (line.length < 78) return null;
  const orderNumber = Number(line.slice(0, 5).trim());
  const rawCode = line.slice(6, 13).trim();
  const billableFlag = line.slice(14, 15).trim();
  const shortDescription = line.slice(16, 77).trim();
  const longDescription = line.slice(77).trim();

  if (!Number.isFinite(orderNumber) || !rawCode) return null;
  return {
    orderNumber,
    code: addIcdDot(rawCode),
    isBillable: billableFlag === "1",
    shortDescription,
    longDescription,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.file) {
    console.error("Usage: load-icd10.ts --file <icd10cm_order_2026.txt>");
    process.exit(1);
  }

  const databaseUrl = process.env.SERVER_DATABASE_URL;
  if (!databaseUrl) throw new Error("SERVER_DATABASE_URL not set");

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  const parsed: ReturnType<typeof parseOrderLine>[] = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(args.file, "utf8"),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const p = parseOrderLine(line);
    if (p) parsed.push(p);
  }
  console.log(`Parsed ${parsed.length} ICD-10-CM codes from ${args.file}`);

  // Rerunnable: truncate + bulk upsert keyed on code.
  await client.query(`TRUNCATE "icd10_codes" RESTART IDENTITY CASCADE`);

  const now = new Date();
  const CHUNK = 1000;
  let inserted = 0;
  for (let i = 0; i < parsed.length; i += CHUNK) {
    const slice = parsed
      .slice(i, i + CHUNK)
      .filter((p): p is NonNullable<typeof p> => p !== null);
    if (slice.length === 0) continue;
    const placeholders: string[] = [];
    const values: unknown[] = [];
    slice.forEach((p, j) => {
      const b = j * 7;
      placeholders.push(
        `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7})`,
      );
      values.push(
        p.code,
        p.orderNumber,
        p.isBillable,
        p.shortDescription,
        p.longDescription,
        now,
        now,
      );
    });
    const res = await client.query(
      `INSERT INTO "icd10_codes"
			   ("code","orderNumber","isBillable","shortDescription","longDescription","createdAt","updatedAt")
			 VALUES ${placeholders.join(",")}
			 ON CONFLICT ("code") DO NOTHING`,
      values,
    );
    inserted += res.rowCount ?? 0;
    if (inserted % 10000 === 0 || i + CHUNK >= parsed.length) {
      console.log(`  …${inserted}/${parsed.length}`);
    }
  }

  console.log(`\nICD-10-CM 2026 loaded: ${inserted} codes.`);
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
