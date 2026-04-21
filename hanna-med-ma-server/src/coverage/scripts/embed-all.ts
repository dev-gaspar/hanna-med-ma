/**
 * Embeds every row that's missing an embedding across:
 *   cpt_codes · icd10_codes · lcd_text_chunks
 *
 * Uses Google Gemini gemini-embedding-001 truncated to 768 dimensions
 * (RETRIEVAL_DOCUMENT task — documents get different embeddings
 * than queries, which materially improves recall at query time).
 * gemini-embedding-001 is the successor to the now-retired
 * text-embedding-004; native dim is 3072 but we truncate to 768 so
 * pgvector's HNSW (2000-dim cap) can index it.
 *
 *   npx ts-node -r dotenv/config src/coverage/scripts/embed-all.ts
 *   npx ts-node -r dotenv/config src/coverage/scripts/embed-all.ts --only=icd10
 *
 * Re-runnable. Rows whose `embedding IS NULL` are picked up; if a
 * source text is edited and the row is nulled again, the next run
 * re-embeds just those rows.
 *
 * Rate limits we respect by default:
 *   - 100 texts per embedContent call (Gemini API limit)
 *   - ~60 calls/minute paced client-side (plenty of headroom even
 *     on the free tier's 1500 RPM)
 *   - Exponential-ish backoff on 429/5xx.
 */

import { GoogleGenAI } from "@google/genai";
import { Client } from "pg";

const MODEL = "gemini-embedding-001";
const DIM = 768;
const BATCH_SIZE = 100; // embedContent accepts up to 100 inputs
const CONCURRENCY_DEFAULT = 4; // Tier 1: 3000 RPM — 4 workers is safe
const PACE_MS = 100; // small inter-batch buffer per worker
const MAX_RETRIES = 5;

type Target = {
	table: string;
	idCol: string;
	// SQL expression used to build the text that goes into the embedding.
	// We COALESCE the short + long descriptions so the vector captures
	// both the billable-spec wording and the richer clinical phrasing.
	textExpr: string;
	key: "cpt" | "icd10" | "lcd" | "guideline";
};

const TARGETS: Target[] = [
	{
		key: "cpt",
		table: "cpt_codes",
		idCol: "id",
		textExpr: `CONCAT(code, ': ', COALESCE("longDescription", description))`,
	},
	{
		key: "icd10",
		table: "icd10_codes",
		idCol: "id",
		textExpr: `CONCAT(code, ': ', "longDescription")`,
	},
	{
		key: "lcd",
		table: "lcd_text_chunks",
		idCol: "id",
		textExpr: `text`,
	},
	{
		key: "guideline",
		table: "coding_guidelines",
		idCol: "id",
		// Prepend the section label so the embedding captures context
		// ("I.C.4.a.2" by itself means nothing; the heading + body matters).
		textExpr: `CONCAT(section, ' ', COALESCE(heading, ''), ': ', text)`,
	},
];

function parseArgs(argv: string[]) {
	const out: Record<string, string> = {};
	for (const a of argv.slice(2)) {
		const m = a.match(/^--([^=]+)(?:=(.*))?$/);
		if (m) out[m[1]] = m[2] ?? "true";
	}
	return out as { only?: string; limit?: string; concurrency?: string };
}

function sleep(ms: number) {
	return new Promise<void>((r) => setTimeout(r, ms));
}

async function embedBatch(
	ai: GoogleGenAI,
	texts: string[],
): Promise<number[][]> {
	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		try {
			const res = await ai.models.embedContent({
				model: MODEL,
				contents: texts,
				config: {
					outputDimensionality: DIM,
					taskType: "RETRIEVAL_DOCUMENT",
				},
			});
			const out = (res.embeddings || []).map((e) => e.values || []);
			if (out.length !== texts.length) {
				throw new Error(
					`Embedding count mismatch: got ${out.length} for ${texts.length} inputs`,
				);
			}
			return out;
		} catch (e: unknown) {
			const err = e as { message?: string; status?: number };
			const msg = err.message || String(e);
			const transient =
				err.status === 429 ||
				err.status === 503 ||
				/rate|quota|timeout|deadline|unavailable/i.test(msg);
			if (!transient || attempt === MAX_RETRIES) throw e;
			const backoff = 500 * Math.pow(2, attempt);
			console.warn(
				`  retry ${attempt + 1}/${MAX_RETRIES} after ${backoff}ms (${msg.slice(0, 80)})`,
			);
			await sleep(backoff);
		}
	}
	throw new Error("unreachable");
}

// pgvector accepts a text literal like '[0.1,0.2,...]'. We build it
// once per row and pass through query parameters so very long arrays
// don't bloat the prepared-statement cache.
function toVectorLiteral(vec: number[]): string {
	return "[" + vec.map((v) => v.toFixed(6)).join(",") + "]";
}

// Workers pull batches of IDs from a shared queue. Each has its own
// Postgres connection so UPDATEs from different workers don't block
// each other on a single shared client.
async function processTarget(
	databaseUrl: string,
	ai: GoogleGenAI,
	t: Target,
	limit: number | null,
	concurrency: number,
) {
	const probe = new Client({ connectionString: databaseUrl });
	await probe.connect();
	try {
		// Snapshot pending IDs once so workers never step on each other
		// (WHERE embedding IS NULL would race if they both read before
		// anyone wrote).
		const pending = await probe.query(
			`SELECT "${t.idCol}" AS id
			 FROM "${t.table}"
			 WHERE embedding IS NULL
			 ORDER BY "${t.idCol}"
			 ${limit !== null ? `LIMIT ${limit}` : ""}`,
		);
		const ids: number[] = pending.rows.map((r) => r.id);
		if (ids.length === 0) {
			console.log(`${t.table}: already up to date.`);
			return;
		}
		console.log(`\n${t.table}: ${ids.length} rows to embed (×${concurrency} workers).`);

		let cursor = 0;
		let done = 0;
		const nextBatch = (): number[] | null => {
			if (cursor >= ids.length) return null;
			const b = ids.slice(cursor, cursor + BATCH_SIZE);
			cursor += b.length;
			return b;
		};

		async function worker() {
			const client = new Client({ connectionString: databaseUrl });
			await client.connect();
			try {
				while (true) {
					const batchIds = nextBatch();
					if (!batchIds) return;

					// Re-fetch text here so workers always hit their own
					// connection. ids → text round-trip is cheap.
					const rows = await client.query(
						`SELECT "${t.idCol}" AS id, ${t.textExpr} AS text
						 FROM "${t.table}"
						 WHERE "${t.idCol}" = ANY($1)
						 ORDER BY "${t.idCol}"`,
						[batchIds],
					);
					const texts = rows.rows.map((r) =>
						String(r.text || "").slice(0, 8000),
					);
					const vectors = await embedBatch(ai, texts);

					const placeholders: string[] = [];
					const values: unknown[] = [];
					rows.rows.forEach((row, i) => {
						const b = i * 2;
						placeholders.push(`($${b + 1}::int, $${b + 2}::vector)`);
						values.push(row.id, toVectorLiteral(vectors[i]));
					});
					await client.query(
						`UPDATE "${t.table}" AS tt
						 SET embedding = v.emb, "updatedAt" = NOW()
						 FROM (VALUES ${placeholders.join(",")}) AS v(id, emb)
						 WHERE tt."${t.idCol}" = v.id`,
						values,
					);

					done += rows.rows.length;
					process.stdout.write(`\r  ${done}/${ids.length}   `);
					await sleep(PACE_MS);
				}
			} finally {
				await client.end();
			}
		}

		await Promise.all(
			Array.from({ length: concurrency }, () => worker()),
		);
		process.stdout.write("\n");
	} finally {
		await probe.end();
	}
}

async function main() {
	const args = parseArgs(process.argv);
	if (!process.env.SERVER_GEMINI_API_KEY) {
		throw new Error("SERVER_GEMINI_API_KEY not set");
	}
	const databaseUrl = process.env.SERVER_DATABASE_URL;
	if (!databaseUrl) throw new Error("SERVER_DATABASE_URL not set");

	const ai = new GoogleGenAI({ apiKey: process.env.SERVER_GEMINI_API_KEY });
	const targets = args.only
		? TARGETS.filter((t) => t.key === args.only)
		: TARGETS;
	const limit = args.limit ? Number(args.limit) : null;
	const concurrency = Number(args.concurrency || CONCURRENCY_DEFAULT);

	for (const t of targets) {
		await processTarget(databaseUrl, ai, t, limit, concurrency);
	}
	console.log("\nDone.");
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
