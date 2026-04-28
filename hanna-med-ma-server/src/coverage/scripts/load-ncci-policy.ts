/**
 * Ingests a chapter of the CMS NCCI Policy Manual (prose) into
 * policy_rules. The NCCI Policy Manual is the WHY-counterpart to
 * the ncci_edits table: the edits tell you WHICH pairs bundle,
 * the Policy Manual explains WHY and under which clinical scenarios
 * a modifier can bypass the edit.
 *
 *   npx ts-node -r dotenv/config src/coverage/scripts/load-ncci-policy.ts \
 *       --file ./data/cms/ncci-policy-manual-ch1.pdf \
 *       --chapter 1 \
 *       --version "2026 edition" \
 *       --source-url "https://www.cms.gov/medicare/coding-billing/national-correct-coding-initiative-ncci-edits/ncci-policy-manual-medicare-services"
 *
 * Source
 *   The manual is published as one PDF per chapter (Ch.1 general
 *   policy, Ch.2–13 organ-system-specific E/M + surgery, plus a
 *   narrow intro). Ch.1 is the highest-yield for our podiatry /
 *   wound care / vascular cohort.
 *
 * Chunking strategy
 *   NCCI chapters use roman-numeral top sections ("I. General
 *   Correct Coding Policies"), then capital-letter sub-sections
 *   ("A. ", "B. "), often with nested "1.", "2." beneath. We match
 *   any of those at heading position (after a linebreak), keep
 *   whatever label the PDF used, and pack by ~500 tokens.
 *   Citation format: "NCCI Policy Manual Ch.{N} {section}"
 *
 * Re-runnable — wipes prior rows for the same (kind, chapter) before inserting.
 */

import { Client } from "pg";
import * as path from "path";
import {
  extractPdfText,
  chunkBody,
  findSectionMarkers,
  splitBySectionMarkers,
  parseArgs,
} from "./_pdf-chunker";

// Heading patterns at line start:
//   "I.", "II.", "XIII."            (roman-numeral top-level)
//   "A.", "B.", "Z."                (capital-letter subsection)
//   "1.", "12.", "123."             (numeric sub-sub, less useful alone)
// We only capture romans + capitals — numerics cause too many false
// positives ("1." appears in every list).
const NCCI_SECTION_RE = /(?:(?<=\n)|^)\s*([IVX]{1,5}|[A-Z])\.\s+(?=[A-Z])/gm;

interface ParsedArgs {
  file?: string;
  chapter?: string;
  version?: string;
  "source-url"?: string;
}

async function main() {
  const args = parseArgs(process.argv) as ParsedArgs;
  if (!args.file || !args.chapter) {
    console.error(
      "Usage: load-ncci-policy.ts --file <pdf> --chapter <num> [--version <edition>] [--source-url <url>]",
    );
    process.exit(1);
  }

  const databaseUrl = process.env.SERVER_DATABASE_URL;
  if (!databaseUrl) throw new Error("SERVER_DATABASE_URL not set");

  const rawText = await extractPdfText(path.resolve(args.file));
  console.log(`Extracted ${rawText.length} chars from ${args.file}`);

  const markers = findSectionMarkers(rawText, NCCI_SECTION_RE, (m) =>
    m.trim().replace(/\s+/g, "").replace(/\.$/, ""),
  );
  const sections = splitBySectionMarkers(rawText, markers);
  console.log(
    `Found ${markers.length} markers, ${sections.length} sections with content`,
  );

  const chapterStr = `Chapter ${args.chapter}`;
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const del = await client.query(
      `DELETE FROM policy_rules WHERE kind = 'NCCI_POLICY_MANUAL' AND chapter = $1`,
      [chapterStr],
    );
    console.log(`Cleared ${del.rowCount ?? 0} prior rows for ${chapterStr}`);

    const now = new Date();
    const payloads: Array<
      [
        string,
        string,
        string | null,
        string | null,
        string,
        string,
        string,
        number,
        string,
        Date,
        Date,
      ]
    > = [];

    for (const s of sections) {
      const chunks = chunkBody(s.body);
      chunks.forEach((c, idx) => {
        const citation = `NCCI Policy Manual Ch.${args.chapter} ${s.section}`;
        payloads.push([
          "NCCI_POLICY_MANUAL",
          citation,
          args["source-url"] ?? null,
          args.version ?? null,
          chapterStr,
          s.section,
          s.heading.slice(0, 200),
          idx,
          c,
          now,
          now,
        ]);
      });
    }
    console.log(`${payloads.length} chunks ready to insert`);

    const CHUNK = 500;
    let total = 0;
    for (let i = 0; i < payloads.length; i += CHUNK) {
      const slice = payloads.slice(i, i + CHUNK);
      const placeholders: string[] = [];
      const values: unknown[] = [];
      slice.forEach((row, j) => {
        const b = j * 11;
        placeholders.push(
          `($${b + 1}::"PolicyDocKind",$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},$${b + 11})`,
        );
        values.push(...row);
      });
      const res = await client.query(
        `INSERT INTO policy_rules
           ("kind","citation","sourceUrl","sourceVersion","chapter","section","heading","chunkIndex","text","createdAt","updatedAt")
         VALUES ${placeholders.join(",")}`,
        values,
      );
      total += res.rowCount ?? 0;
    }
    console.log(`\npolicy_rules: ${total} chunks inserted for ${chapterStr}.`);
    console.log(
      `Next step: npx ts-node -r dotenv/config src/coverage/scripts/embed-all.ts --only=policy`,
    );
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
