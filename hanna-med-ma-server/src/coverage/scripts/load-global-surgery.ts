/**
 * Ingests the CMS Global Surgery Booklet (MLN 907166) into
 * policy_rules. This is a short booklet (~20 pages) that defines
 * the 0-, 10-, and 90-day global periods and enumerates exactly
 * what's bundled inside each global (pre-op visit, intra-op,
 * post-op follow-ups, complications).
 *
 *   npx ts-node -r dotenv/config src/coverage/scripts/load-global-surgery.ts \
 *       --file ./data/cms/mln-907166-global-surgery.pdf \
 *       --version "ICN 907166 (2024 revision)" \
 *       --source-url "https://www.cms.gov/outreach-and-education/medicare-learning-network-mln/mlnproducts/downloads/GloballSurgery-ICN907166.pdf"
 *
 * Why we need it
 *   Encounters like Corzo #8 (27822 trimalleolar ORIF, 90-day global)
 *   need pre-op E/M decisions (99222 + -57) vs post-op follow-ups
 *   (bundled). The booklet's prose answers "is this E/M payable given
 *   the surgery window?" better than trying to infer from the MPFS
 *   globalDays column alone.
 *
 * Chunking strategy
 *   MLN booklets use free-form section titles ("What Is Global
 *   Surgery?", "Global Period Types") — no decimal anchors. We
 *   match ALL-CAPS lines OR Title-Case lines preceded by a blank
 *   line, which catches the way MLN formats headings. If a heading
 *   looks like a pure question ("What Is...?"), we keep it.
 *   Citation: "MLN 907166 — {heading}"
 *
 * Re-runnable — wipes prior GLOBAL_SURGERY_BOOKLET rows before inserting.
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

// MLN-style headings: appear on a line of their own, preceded by a
// blank line, short (≤ 80 chars), ending without a period. We match
// Title Case phrases OR ALL-CAPS banners. The lookbehind for \n\n
// ensures we're at section boundary, not mid-sentence.
const GS_SECTION_RE = /\n\n([A-Z][A-Za-z0-9][A-Za-z0-9 ,&/?\-'"]{4,78})(?=\n)/g;

interface ParsedArgs {
  file?: string;
  version?: string;
  "source-url"?: string;
}

async function main() {
  const args = parseArgs(process.argv) as ParsedArgs;
  if (!args.file) {
    console.error(
      "Usage: load-global-surgery.ts --file <pdf> [--version <rev>] [--source-url <url>]",
    );
    process.exit(1);
  }

  const databaseUrl = process.env.SERVER_DATABASE_URL;
  if (!databaseUrl) throw new Error("SERVER_DATABASE_URL not set");

  const rawText = await extractPdfText(path.resolve(args.file));
  console.log(`Extracted ${rawText.length} chars from ${args.file}`);

  // For MLN, the "label" IS the heading (no decimal anchor) — use
  // the heading verbatim as section, trimmed and slug-safe.
  const markers = findSectionMarkers(rawText, GS_SECTION_RE, (m) =>
    m.trim().replace(/\s+/g, " ").slice(0, 120),
  );
  const sections = splitBySectionMarkers(rawText, markers);
  console.log(
    `Found ${markers.length} markers, ${sections.length} sections with content`,
  );

  // MLN is small enough that if heading detection yields < 3
  // sections, we fall back to treating the whole doc as one section
  // so nothing is lost.
  let effectiveSections = sections;
  if (sections.length < 3) {
    console.log(
      "Heading detection produced too few sections — falling back to single-section ingest.",
    );
    effectiveSections = [
      {
        section: "Global Surgery",
        heading: "Global Surgery (full booklet)",
        body: rawText,
        rawMatch: "",
      },
    ];
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const del = await client.query(
      `DELETE FROM policy_rules WHERE kind = 'GLOBAL_SURGERY_BOOKLET'`,
    );
    console.log(`Cleared ${del.rowCount ?? 0} prior rows`);

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

    for (const s of effectiveSections) {
      const chunks = chunkBody(s.body);
      chunks.forEach((c, idx) => {
        const citation = `MLN 907166 — ${s.section}`;
        payloads.push([
          "GLOBAL_SURGERY_BOOKLET",
          citation,
          args["source-url"] ?? null,
          args.version ?? null,
          "Global Surgery Booklet",
          s.section.slice(0, 120),
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
    console.log(
      `\npolicy_rules: ${total} chunks inserted for Global Surgery Booklet.`,
    );
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
