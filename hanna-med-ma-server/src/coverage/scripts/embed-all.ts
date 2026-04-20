/**
 * Embeds every row that's missing an embedding across:
 *   cpt_codes · icd10_codes · lcd_text_chunks
 *
 * Uses Google Gemini text-embedding-004 at 768 dimensions
 * (RETRIEVAL_DOCUMENT task — documents get different embeddings
 * than queries, which materially improves recall at query time).
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

const MODEL = "text-embedding-004";
const DIM = 768;
const BATCH_SIZE = 100; // embedContent accepts up to 100 inputs
const PACE_MS = 250; // ~240 req/min — well under any quota
const MAX_RETRIES = 5;

type Target = {
	table: string;
	idCol: string;
	// SQL expression used to build the text that goes into the embedding.
	// We COALESCE the short + long descriptions so the vector captures
	// both the billable-spec wording and the richer clinical phrasing.
	textExpr: string;
	key: "cpt" | "icd10" | "lcd";
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
];

function parseArgs(argv: string[]) {
	const out: Record<string, string> = {};
	for (const a of argv.slice(2)) {
		const m = a.match(/^--([^=]+)(?:=(.*))?$/);
		if (m) out[m[1]] = m[2] ?? "true";
	}
	return out as { only?: string; limit?: string };
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

async function processTarget(
	client: Client,
	ai: GoogleGenAI,
	t: Target,
	limit: number | null,
) {
	const total = await client.query(
		`SELECT COUNT(*)::int AS n FROM "${t.table}" WHERE embedding IS NULL`,
	);
	const pending = total.rows[0].n as number;
	if (pending === 0) {
		console.log(`${t.table}: already up to date.`);
		return;
	}
	console.log(`\n${t.table}: ${pending} rows to embed.`);

	let done = 0;
	while (true) {
		const batch = await client.query(
			`SELECT "${t.idCol}" AS id, ${t.textExpr} AS text
			 FROM "${t.table}"
			 WHERE embedding IS NULL
			 ORDER BY "${t.idCol}"
			 LIMIT ${BATCH_SIZE}`,
		);
		if (batch.rows.length === 0) break;

		const texts = batch.rows.map((r) =>
			String(r.text || "").slice(0, 8000),
		);
		const vectors = await embedBatch(ai, texts);

		// Write back one UPDATE per row — a single round-trip per
		// batch would need a VALUES table which is more fragile.
		for (let i = 0; i < batch.rows.length; i++) {
			const id = batch.rows[i].id;
			await client.query(
				`UPDATE "${t.table}" SET embedding = $1::vector, "updatedAt" = NOW() WHERE "${t.idCol}" = $2`,
				[toVectorLiteral(vectors[i]), id],
			);
		}

		done += batch.rows.length;
		process.stdout.write(`\r  ${done}/${pending}   `);
		if (limit !== null && done >= limit) break;
		await sleep(PACE_MS);
	}
	process.stdout.write("\n");
}

async function main() {
	const args = parseArgs(process.argv);
	if (!process.env.SERVER_GEMINI_API_KEY) {
		throw new Error("SERVER_GEMINI_API_KEY not set");
	}
	const databaseUrl = process.env.SERVER_DATABASE_URL;
	if (!databaseUrl) throw new Error("SERVER_DATABASE_URL not set");

	const ai = new GoogleGenAI({ apiKey: process.env.SERVER_GEMINI_API_KEY });
	const client = new Client({ connectionString: databaseUrl });
	await client.connect();

	const targets = args.only
		? TARGETS.filter((t) => t.key === args.only)
		: TARGETS;
	const limit = args.limit ? Number(args.limit) : null;

	try {
		for (const t of targets) {
			await processTarget(client, ai, t, limit);
		}
		console.log("\nDone.");
	} finally {
		await client.end();
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
