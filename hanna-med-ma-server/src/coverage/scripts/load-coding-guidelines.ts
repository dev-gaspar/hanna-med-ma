/**
 * Ingests the ICD-10-CM Official Guidelines for Coding and Reporting
 * into coding_guidelines. Used by search_coding_guidelines at query
 * time so the AI Coder can ground specificity decisions in the
 * authoritative text, not just the system prompt.
 *
 *   npx ts-node -r dotenv/config src/coverage/scripts/load-coding-guidelines.ts \
 *       --file ./data/icd10/guidelines/fy2026-icd10cm-guidelines.pdf \
 *       --year 2026
 *
 * Source: cms.gov/files/document/fy-2026-icd-10-cm-coding-guidelines.pdf
 *
 * Chunking strategy
 *   - Parse the full PDF into plain text via pdf-parse.
 *   - Split on section boundaries ("Section I.", "Section II.", etc. at
 *     the top level; then "I.A.", "I.B.4.a.3" style leaves).
 *   - Pack each section into ~500-token chunks, same as LCDs.
 *   - Every chunk keeps its section label so the agent can cite it.
 *
 * Embedding is done later by embed-coding-guidelines.ts (reuses the
 * same Gemini batcher as embed-all.ts).
 */

import { Client } from "pg";
import * as fs from "fs";
import * as path from "path";

type PDFParseCtor = new (opts: { data: Buffer }) => {
  getText: () => Promise<{ text: string }>;
};

async function extractPdfText(filePath: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("pdf-parse");
  const PDFParse: PDFParseCtor = mod.PDFParse ?? mod.default ?? mod;
  const buf = fs.readFileSync(filePath);
  const parser = new PDFParse({ data: buf });
  const res = await parser.getText();
  return (res.text || "").trim();
}

// Per-section PDF cleanup: collapse single mid-sentence newlines into
// spaces, keep paragraph breaks.
function cleanChunk(raw: string): string {
  return raw
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/(?<=\S)\n(?=\S)/g, " ")
    .trim();
}

// Match the section label anywhere (not just line-start) because the
// raw extracted text frequently puts the label mid-line after a prior
// sentence's terminating punctuation. Recognises:
//   - "Section I.", "Section II.", ... (top-level)
//   - "I.A.", "I.C.4.", "I.C.4.a.", "I.C.4.a.3." (leaves)
const SECTION_RE =
  /(Section\s+[IVX]{1,4}\.|\b[IVX]{1,4}\.[A-Z]\.(?:\d+\.)?(?:[a-z]+\.)?(?:\d+\.)?)/g;

function splitIntoSections(
  raw: string,
): Array<{ section: string; heading: string; body: string }> {
  // Find all section markers with their positions.
  const markers: Array<{ start: number; label: string }> = [];
  for (const m of raw.matchAll(SECTION_RE)) {
    if (m.index === undefined) continue;
    markers.push({ start: m.index, label: m[0].replace(/\s+/g, "") });
  }
  if (markers.length === 0) return [];

  // Dedupe consecutive identical labels.
  const deduped: typeof markers = [];
  for (const m of markers) {
    if (!deduped.length || deduped[deduped.length - 1].label !== m.label) {
      deduped.push(m);
    }
  }

  const out: Array<{ section: string; heading: string; body: string }> = [];
  for (let i = 0; i < deduped.length; i++) {
    const { start, label } = deduped[i];
    const end = i + 1 < deduped.length ? deduped[i + 1].start : raw.length;
    // Skip over the marker itself for the body.
    const after = raw.slice(start + label.length, end).trim();
    // The first line (up to \n or ~120 chars) is the heading.
    const lineBreak = after.indexOf("\n");
    const headingEnd = lineBreak > 0 ? Math.min(lineBreak, 200) : 200;
    const heading = after.slice(0, headingEnd).trim();
    const body = cleanChunk(after.slice(headingEnd));
    if (body.length < 100) continue;
    out.push({ section: label, heading, body });
  }
  return out;
}

// Pack each section into ~2000-char (~500-token) chunks.
const TARGET_CHARS = 2000;
const MIN_CHARS = 200;
function chunkBody(body: string): string[] {
  const out: string[] = [];
  const sentences = body
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((s) => s.trim())
    .filter(Boolean);
  let buf = "";
  for (const s of sentences) {
    if (s.length > TARGET_CHARS) {
      if (buf) {
        out.push(buf);
        buf = "";
      }
      for (let i = 0; i < s.length; i += TARGET_CHARS) {
        out.push(s.slice(i, i + TARGET_CHARS));
      }
      continue;
    }
    if (buf.length + s.length + 1 > TARGET_CHARS) {
      out.push(buf);
      buf = s;
    } else {
      buf = buf ? `${buf} ${s}` : s;
    }
  }
  if (buf) out.push(buf);
  return out.filter((c) => c.length >= MIN_CHARS);
}

function parseArgs(argv: string[]) {
  const out: Record<string, string> = {};
  for (let i = 2; i < argv.length; i += 2) {
    const k = argv[i]?.replace(/^--/, "");
    const v = argv[i + 1];
    if (k && v) out[k] = v;
  }
  return out as { file: string; year: string };
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.file || !args.year) {
    console.error(
      "Usage: load-coding-guidelines.ts --file <pdf> --year <2026>",
    );
    process.exit(1);
  }

  const databaseUrl = process.env.SERVER_DATABASE_URL;
  if (!databaseUrl) throw new Error("SERVER_DATABASE_URL not set");

  const rawText = await extractPdfText(path.resolve(args.file));
  console.log(`Extracted ${rawText.length} chars from ${args.file}`);

  const sections = splitIntoSections(rawText);
  console.log(`Split into ${sections.length} sections`);

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    // Rerunnable: wipe this year and bulk insert.
    const del = await client.query(
      `DELETE FROM coding_guidelines WHERE "sourceYear" = $1`,
      [Number(args.year)],
    );
    console.log(`Cleared ${del.rowCount ?? 0} prior rows for ${args.year}`);

    let total = 0;
    const now = new Date();
    const CHUNK = 500;
    const payloads: Array<
      [number, string, string, number, string, Date, Date]
    > = [];
    for (const s of sections) {
      const chunks = chunkBody(s.body);
      chunks.forEach((c, idx) => {
        payloads.push([
          Number(args.year),
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

    for (let i = 0; i < payloads.length; i += CHUNK) {
      const slice = payloads.slice(i, i + CHUNK);
      const placeholders: string[] = [];
      const values: unknown[] = [];
      slice.forEach((row, j) => {
        const b = j * 7;
        placeholders.push(
          `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7})`,
        );
        values.push(...row);
      });
      const res = await client.query(
        `INSERT INTO coding_guidelines
				   ("sourceYear","section","heading","chunkIndex","text","createdAt","updatedAt")
				 VALUES ${placeholders.join(",")}`,
        values,
      );
      total += res.rowCount ?? 0;
    }
    console.log(
      `\ncoding_guidelines: ${total} chunks inserted for ${args.year}.`,
    );
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
