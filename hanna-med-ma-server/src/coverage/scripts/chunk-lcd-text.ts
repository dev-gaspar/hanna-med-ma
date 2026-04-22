/**
 * Splits the long free-text sections of LCDs and Articles into
 * ~500-token chunks and writes them to lcd_text_chunks. The embedder
 * picks up from there.
 *
 *   npx ts-node -r dotenv/config src/coverage/scripts/chunk-lcd-text.ts
 *
 * Why chunk: embedding a 40k-token LCD as one vector blurs out the
 * specific paragraph that answers "does this code require the MEAT
 * criteria documented?" — you lose the snap-to-evidence affordance.
 * 500 tokens is the sweet spot for clinical prose: one or two
 * coherent paragraphs per vector.
 */

import { Client } from "pg";

const TARGET_CHARS = 2000; // ~500 tokens of English at ~4 chars/token
const MIN_CHARS = 200; // drop trivially short chunks (headers, "N/A")

const LCD_SECTIONS = [
  "indicationPlain",
  "codingGuidelinesPlain",
  "docReqsPlain",
  "utilGuidePlain",
  "summaryOfEvidencePlain",
  "analysisOfEvidencePlain",
  "diagnosesSupportPlain",
  "bibliographyPlain",
] as const;

const ARTICLE_SECTIONS = ["descriptionPlain", "otherCommentsPlain"] as const;

// Split by sentence boundaries first so we don't cut mid-thought,
// then greedily pack sentences into ~TARGET_CHARS chunks.
function chunkText(raw: string): string[] {
  const text = raw.trim();
  if (!text) return [];
  // A naive but robust sentence splitter — clinical prose is
  // mostly English declaratives with occasional abbreviations.
  const sentences = text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((s) => s.trim())
    .filter(Boolean);

  const out: string[] = [];
  let buf = "";
  for (const s of sentences) {
    // If a single sentence is longer than TARGET_CHARS, hard-split it.
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

async function main() {
  const databaseUrl = process.env.SERVER_DATABASE_URL;
  if (!databaseUrl) throw new Error("SERVER_DATABASE_URL not set");

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    // Fresh rebuild so repeat runs don't duplicate chunks.
    await client.query(`TRUNCATE "lcd_text_chunks" RESTART IDENTITY CASCADE`);

    let totalChunks = 0;

    // ─── LCDs ────────────────────────────────────────────────────────
    const lcdCols = LCD_SECTIONS.map((s) => `"${s}"`).join(",");
    const lcdRes = await client.query(`SELECT id, ${lcdCols} FROM lcds`);
    console.log(`Chunking ${lcdRes.rows.length} LCDs…`);
    const lcdPayloads: unknown[][] = [];
    for (const row of lcdRes.rows) {
      for (const section of LCD_SECTIONS) {
        const txt = row[section] as string | null;
        if (!txt) continue;
        const chunks = chunkText(txt);
        chunks.forEach((chunk, idx) => {
          lcdPayloads.push([row.id, null, section, idx, chunk]);
        });
      }
    }

    // ─── Articles ────────────────────────────────────────────────────
    const articleCols = ARTICLE_SECTIONS.map((s) => `"${s}"`).join(",");
    const aRes = await client.query(
      `SELECT id, ${articleCols} FROM lcd_articles`,
    );
    console.log(`Chunking ${aRes.rows.length} Articles…`);
    const articlePayloads: unknown[][] = [];
    for (const row of aRes.rows) {
      for (const section of ARTICLE_SECTIONS) {
        const txt = row[section] as string | null;
        if (!txt) continue;
        const chunks = chunkText(txt);
        chunks.forEach((chunk, idx) => {
          articlePayloads.push([null, row.id, section, idx, chunk]);
        });
      }
    }

    const all = [...lcdPayloads, ...articlePayloads];
    console.log(
      `LCDs → ${lcdPayloads.length} chunks, Articles → ${articlePayloads.length} chunks, total ${all.length}`,
    );

    // Bulk insert in chunks of 500 rows.
    const now = new Date();
    const CHUNK = 500;
    for (let i = 0; i < all.length; i += CHUNK) {
      const slice = all.slice(i, i + CHUNK);
      const placeholders: string[] = [];
      const values: unknown[] = [];
      slice.forEach((row, j) => {
        const b = j * 7;
        placeholders.push(
          `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7})`,
        );
        values.push(...(row as unknown[]), now, now);
      });
      const res = await client.query(
        `INSERT INTO "lcd_text_chunks"
				   ("lcdId","articleId","section","chunkIndex","text","createdAt","updatedAt")
				 VALUES ${placeholders.join(",")}`,
        values,
      );
      totalChunks += res.rowCount ?? 0;
    }

    console.log(`\nlcd_text_chunks: ${totalChunks} rows inserted.`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
