/**
 * Smoke-test for the vector engine. Takes a clinical-note snippet
 * and returns top-K CPTs, ICD-10s, and LCD text chunks ranked by
 * cosine similarity against the Gemini embedding of the snippet.
 *
 *   npx ts-node -r dotenv/config src/coverage/scripts/search-probe.ts \
 *       --q "80yo DM II with neuropathic ulcer right foot, debrided 7 mycotic nails"
 */

import { GoogleGenAI } from "@google/genai";
import { Client } from "pg";

const MODEL = "gemini-embedding-001";
const DIM = 768;

function parseArgs(argv: string[]) {
	const out: Record<string, string> = {};
	for (let i = 2; i < argv.length; i += 2) {
		const k = argv[i]?.replace(/^--/, "");
		const v = argv[i + 1];
		if (k && v) out[k] = v;
	}
	return out as { q: string; k?: string };
}

function toVectorLiteral(vec: number[]): string {
	return "[" + vec.map((v) => v.toFixed(6)).join(",") + "]";
}

async function main() {
	const args = parseArgs(process.argv);
	if (!args.q) {
		console.error(`Usage: search-probe.ts --q "<clinical snippet>" [--k 10]`);
		process.exit(1);
	}
	const k = Number(args.k || 8);

	const ai = new GoogleGenAI({ apiKey: process.env.SERVER_GEMINI_API_KEY });
	const res = await ai.models.embedContent({
		model: MODEL,
		contents: args.q,
		// RETRIEVAL_QUERY is the intentional asymmetric partner of
		// RETRIEVAL_DOCUMENT used at ingest — the two live in the
		// same space but are optimized for this directional lookup.
		config: { outputDimensionality: DIM, taskType: "RETRIEVAL_QUERY" },
	});
	const vec = res.embeddings?.[0]?.values;
	if (!vec) throw new Error("empty embedding from Gemini");
	const lit = toVectorLiteral(vec);

	const client = new Client({ connectionString: process.env.SERVER_DATABASE_URL });
	await client.connect();

	try {
		console.log(`\nQuery: "${args.q}"\n`);

		console.log("=== Top CPTs ===");
		const cpts = await client.query(
			`SELECT code, description, 1 - (embedding <=> $1::vector) AS sim
			 FROM cpt_codes
			 WHERE embedding IS NOT NULL
			 ORDER BY embedding <=> $1::vector
			 LIMIT $2`,
			[lit, k],
		);
		console.table(
			cpts.rows.map((r) => ({
				code: r.code,
				sim: Number(r.sim).toFixed(3),
				description: String(r.description).slice(0, 80),
			})),
		);

		console.log("\n=== Top ICD-10 ===");
		const icds = await client.query(
			`SELECT code, "longDescription" AS desc, "isBillable",
			        1 - (embedding <=> $1::vector) AS sim
			 FROM icd10_codes
			 WHERE embedding IS NOT NULL
			 ORDER BY embedding <=> $1::vector
			 LIMIT $2`,
			[lit, k],
		);
		console.table(
			icds.rows.map((r) => ({
				code: r.code,
				sim: Number(r.sim).toFixed(3),
				billable: r.isBillable,
				description: String(r.desc).slice(0, 80),
			})),
		);

		console.log("\n=== Top LCD/Article chunks ===");
		const chunks = await client.query(
			`SELECT c.section, c."chunkIndex",
			        COALESCE(l."lcdId", a."articleId") AS doc_id,
			        CASE WHEN c."lcdId" IS NOT NULL THEN 'LCD' ELSE 'ART' END AS kind,
			        COALESCE(l.title, a.title) AS title,
			        1 - (c.embedding <=> $1::vector) AS sim,
			        c.text
			 FROM lcd_text_chunks c
			 LEFT JOIN lcds         l ON l.id = c."lcdId"
			 LEFT JOIN lcd_articles a ON a.id = c."articleId"
			 WHERE c.embedding IS NOT NULL
			 ORDER BY c.embedding <=> $1::vector
			 LIMIT $2`,
			[lit, k],
		);
		for (const r of chunks.rows) {
			console.log(
				`[${r.kind} ${r.doc_id}] sim=${Number(r.sim).toFixed(3)} · ${r.section}#${r.chunkIndex} — ${String(r.title).slice(0, 70)}`,
			);
			console.log(`   ${String(r.text).slice(0, 180)}…`);
		}
	} finally {
		await client.end();
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
