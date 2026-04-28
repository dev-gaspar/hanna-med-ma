/**
 * Ingests a chapter of the CMS Medicare Claims Processing Manual
 * (Pub 100-04) into policy_rules. Each chapter PDF is a separate
 * ingest run; run this once per chapter you want in the RAG.
 *
 *   npx ts-node -r dotenv/config src/coverage/scripts/load-cms-manual.ts \
 *       --file ./data/cms/clm104c12.pdf \
 *       --chapter 12 \
 *       --version "Rev. 12345 (2024-09-26)" \
 *       --source-url "https://www.cms.gov/regulations-and-guidance/guidance/manuals/downloads/clm104c12.pdf"
 *
 * Why this matters
 *   Ch.12 is where the "no consult codes" rule lives (§30.6.10:
 *   Consultations), along with the initial-hospital-care mapping
 *   (99221-99223), modifier AI usage, teaching physician rules,
 *   and a lot of other billing decisions the per-code tables can't
 *   answer. Ch.13 covers radiology, Ch.23 the fee schedule —
 *   ingest as needed.
 *
 * Chunking strategy
 *   - Extract PDF → plain text (pdf-parse).
 *   - Find decimal section numbers that look like chapter subsection
 *     anchors: "30", "30.6", "30.6.10". CMS Manual uses the pattern
 *     "<num>[ - Title]" at heading position, so we match runs of
 *     digits-with-dots that are preceded by a linebreak (heading
 *     position) rather than appearing mid-sentence.
 *   - Each section gets split into ~500-token chunks.
 *   - Citation template: "CMS Claims Processing Manual Ch.{chapter} §{section}".
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

// "30", "30.6", "30.6.10" — up to 4 dotted levels. Require at least
// one dot to avoid picking up every line that starts with a number
// (CMS pages start with "10 - General" so we also accept 1-level
// integers IF they're followed by " - " and a capital letter).
//
// Matches at line-start (after \n) to skip numbers that appear
// mid-prose. Using non-capturing groups so matchAll yields a stable
// full match.
const CMS_SECTION_RE =
  /(?:(?<=\n)|^)\s*(\d+(?:\.\d+){0,4})\s*[-–—]\s*(?=[A-Z])/gm;

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
      "Usage: load-cms-manual.ts --file <pdf> --chapter <num> [--version <rev>] [--source-url <url>]",
    );
    process.exit(1);
  }

  const databaseUrl = process.env.SERVER_DATABASE_URL;
  if (!databaseUrl) throw new Error("SERVER_DATABASE_URL not set");

  const rawText = await extractPdfText(path.resolve(args.file));
  console.log(`Extracted ${rawText.length} chars from ${args.file}`);

  const markers = findSectionMarkers(rawText, CMS_SECTION_RE, (m) => {
    // Pull just the decimal number out — "30.6.10 - " → "30.6.10".
    const match = m.match(/\d+(?:\.\d+){0,4}/);
    return match ? match[0] : m.replace(/\s+/g, "");
  });
  const sections = splitBySectionMarkers(rawText, markers);
  console.log(
    `Found ${markers.length} markers, ${sections.length} sections with content`,
  );

  const chapterStr = `Chapter ${args.chapter}`;
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    // Rerunnable — wipe any prior run for this kind + chapter.
    const del = await client.query(
      `DELETE FROM policy_rules WHERE kind = 'CMS_CLAIMS_MANUAL' AND chapter = $1`,
      [chapterStr],
    );
    console.log(`Cleared ${del.rowCount ?? 0} prior rows for ${chapterStr}`);

    const now = new Date();
    const payloads: Array<
      [
        string, // kind (enum passed as text via ::PolicyDocKind cast)
        string, // citation
        string | null, // sourceUrl
        string | null, // sourceVersion
        string, // chapter
        string, // section
        string, // heading
        number, // chunkIndex
        string, // text
        Date,
        Date,
      ]
    > = [];

    for (const s of sections) {
      const chunks = chunkBody(s.body);
      chunks.forEach((c, idx) => {
        const citation = `CMS Claims Processing Manual Ch.${args.chapter} §${s.section}`;
        payloads.push([
          "CMS_CLAIMS_MANUAL",
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
