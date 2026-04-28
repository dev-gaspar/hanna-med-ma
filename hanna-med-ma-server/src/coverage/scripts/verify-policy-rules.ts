/**
 * Quick sanity check: print embedded vs total counts per PolicyDocKind
 * and run a known query ("consult codes discontinued 99221 initial
 * hospital care") to confirm the retrieval surfaces Ch.12 §30.6.10.
 *
 *   npx ts-node -r dotenv/config src/coverage/scripts/verify-policy-rules.ts
 */

import { Client } from "pg";
import { GoogleGenAI } from "@google/genai";

const EMBED_MODEL = "gemini-embedding-001";
const EMBED_DIM = 768;

async function main() {
  const databaseUrl = process.env.SERVER_DATABASE_URL;
  if (!databaseUrl) throw new Error("SERVER_DATABASE_URL not set");
  if (!process.env.SERVER_GEMINI_API_KEY) {
    throw new Error("SERVER_GEMINI_API_KEY not set");
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    console.log("\n=== policy_rules counts per kind ===");
    const counts = await client.query(
      `SELECT kind,
              COUNT(*) FILTER (WHERE embedding IS NOT NULL) AS embedded,
              COUNT(*) AS total,
              COUNT(DISTINCT section) AS distinct_sections
         FROM policy_rules
        GROUP BY kind
        ORDER BY kind`,
    );
    for (const r of counts.rows) {
      console.log(
        `  ${r.kind.padEnd(26)} embedded=${String(r.embedded).padStart(4)}/${String(r.total).padEnd(4)}  sections=${r.distinct_sections}`,
      );
    }

    console.log("\n=== coding_guidelines (ICD-10) ===");
    const gCounts = await client.query(
      `SELECT "sourceYear",
              COUNT(*) FILTER (WHERE embedding IS NOT NULL) AS embedded,
              COUNT(*) AS total
         FROM coding_guidelines
        GROUP BY "sourceYear"
        ORDER BY "sourceYear" DESC`,
    );
    for (const r of gCounts.rows) {
      console.log(`  FY${r.sourceYear} embedded=${r.embedded}/${r.total}`);
    }

    // Probe query: ask the policy corpus the question that motivated
    // this whole RAG expansion. Expected top hit: CMS Claims Processing
    // Manual Ch.12 §30.6.10 Consultations.
    console.log("\n=== Probe query ===");
    const ai = new GoogleGenAI({ apiKey: process.env.SERVER_GEMINI_API_KEY });
    const probe =
      "Medicare discontinued consultation codes 99241-99255; physicians bill initial hospital care 99221-99223 instead";
    const embedRes = await ai.models.embedContent({
      model: EMBED_MODEL,
      contents: probe,
      config: {
        outputDimensionality: EMBED_DIM,
        taskType: "RETRIEVAL_QUERY",
      },
    });
    const vec = embedRes.embeddings?.[0]?.values;
    if (!vec) throw new Error("empty embedding");
    const lit = "[" + vec.map((v) => v.toFixed(6)).join(",") + "]";

    const topHits = await client.query(
      `SELECT kind, citation, chapter, section, heading,
              1 - (embedding <=> $1::vector) AS similarity
         FROM policy_rules
        WHERE embedding IS NOT NULL
        ORDER BY embedding <=> $1::vector
        LIMIT 5`,
      [lit],
    );

    console.log(`Query: "${probe}"`);
    console.log("Top 5 policy_rules hits:");
    topHits.rows.forEach((r, i) => {
      console.log(
        `  ${i + 1}. sim=${Number(r.similarity).toFixed(3)}  ${r.citation}  —  ${(r.heading || "").slice(0, 60)}`,
      );
    });
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
