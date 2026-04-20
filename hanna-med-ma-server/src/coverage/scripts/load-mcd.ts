/**
 * MCD (Medicare Coverage Database) loader — LCDs, Articles, and the
 * contractor/CPT/ICD-10 joins. Reads the weekly CSV exports from
 * https://www.cms.gov/medicare-coverage-database/
 *
 *   npx ts-node -r dotenv/config src/coverage/scripts/load-mcd.ts \
 *       --lcd-dir ./data/mcd/lcd/csv \
 *       --article-dir ./data/mcd/article/csv
 *
 * Load order matters: LCDs and Articles first (parents), then joins
 * (contractors, lcd↔article links, CPT/ICD crosswalks).
 */

import { Client } from "pg";
import * as fs from "fs";
import * as path from "path";

function parseArgs(argv: string[]) {
	const out: Record<string, string> = {};
	for (let i = 2; i < argv.length; i += 2) {
		const k = argv[i]?.replace(/^--/, "");
		const v = argv[i + 1];
		if (k && v) out[k] = v;
	}
	return out as { "lcd-dir": string; "article-dir": string };
}

// CMS CSVs quote fields that contain commas/newlines and use RFC-4180
// double-quote escaping (`""` inside a quoted field). We split the
// whole file in one pass so quoted newlines stay inside a field.
function parseCsv(raw: string): string[][] {
	const rows: string[][] = [];
	let cur: string[] = [];
	let field = "";
	let inQ = false;
	for (let i = 0; i < raw.length; i++) {
		const ch = raw[i];
		if (inQ) {
			if (ch === '"') {
				if (raw[i + 1] === '"') {
					field += '"';
					i++;
				} else {
					inQ = false;
				}
			} else {
				field += ch;
			}
		} else {
			if (ch === '"') {
				inQ = true;
			} else if (ch === ",") {
				cur.push(field);
				field = "";
			} else if (ch === "\n") {
				cur.push(field);
				rows.push(cur);
				cur = [];
				field = "";
			} else if (ch === "\r") {
				// swallow CR
			} else {
				field += ch;
			}
		}
	}
	if (field.length || cur.length) {
		cur.push(field);
		rows.push(cur);
	}
	return rows;
}

function stripHtml(s: string | null | undefined): string | null {
	if (!s) return null;
	const t = s
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&quot;/gi, '"')
		.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
		.replace(/\s+/g, " ")
		.trim();
	return t.length ? t : null;
}

function parseDate(s: string | null | undefined): string | null {
	if (!s) return null;
	const t = s.trim();
	if (!t || t === "1900-01-01 00:00:00" || t.startsWith("0000")) return null;
	// "2025-12-22 15:54:37.413000000" or "YYYY-MM-DD HH:mm:ss"
	const m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
	if (!m) return null;
	return `${m[1]}-${m[2]}-${m[3]}`;
}

function nonEmpty(s: string | null | undefined): string | null {
	if (!s) return null;
	const t = s.trim();
	return t.length ? t : null;
}

// Load one CSV, read headers + rows into a list of objects keyed by header.
function loadCsvAsObjects(
	filePath: string,
): { headers: string[]; rows: Record<string, string>[] } {
	const raw = fs.readFileSync(filePath, "utf8");
	const grid = parseCsv(raw);
	if (grid.length === 0) return { headers: [], rows: [] };
	const headers = grid[0].map((h) => h.trim());
	const rows: Record<string, string>[] = [];
	for (let i = 1; i < grid.length; i++) {
		const cols = grid[i];
		if (cols.length === 1 && cols[0] === "") continue;
		const obj: Record<string, string> = {};
		for (let j = 0; j < headers.length; j++) obj[headers[j]] = cols[j] ?? "";
		rows.push(obj);
	}
	return { headers, rows };
}

async function bulkInsert(
	client: Client,
	table: string,
	columns: string[],
	rows: unknown[][],
	onConflict: string,
	chunkSize = 500,
): Promise<number> {
	let inserted = 0;
	for (let i = 0; i < rows.length; i += chunkSize) {
		const slice = rows.slice(i, i + chunkSize);
		if (slice.length === 0) continue;
		const colList = columns.map((c) => `"${c}"`).join(",");
		const placeholders: string[] = [];
		const values: unknown[] = [];
		slice.forEach((row, idx) => {
			const b = idx * columns.length;
			placeholders.push(
				"(" + columns.map((_, j) => `$${b + j + 1}`).join(",") + ")",
			);
			values.push(...row);
		});
		const sql = `INSERT INTO "${table}" (${colList}) VALUES ${placeholders.join(",")} ${onConflict}`;
		const res = await client.query(sql, values);
		inserted += res.rowCount ?? 0;
	}
	return inserted;
}

async function main() {
	const args = parseArgs(process.argv);
	if (!args["lcd-dir"] || !args["article-dir"]) {
		console.error(
			"Usage: ts-node load-mcd.ts --lcd-dir <dir> --article-dir <dir>",
		);
		process.exit(1);
	}

	const databaseUrl = process.env.SERVER_DATABASE_URL;
	if (!databaseUrl) throw new Error("SERVER_DATABASE_URL not set");
	const client = new Client({ connectionString: databaseUrl });
	await client.connect();

	try {
		// ─── 0. Contractor lookup (contractor_id → contractorNumber/Name) ───
		// The LCD and Article ZIPs both ship a contractor.csv — identical data;
		// use whichever is present.
		const contractorCsv = fs.existsSync(
			path.join(args["lcd-dir"], "contractor.csv"),
		)
			? path.join(args["lcd-dir"], "contractor.csv")
			: path.join(args["article-dir"], "contractor.csv");
		const contractors = loadCsvAsObjects(contractorCsv).rows;
		const contractorById = new Map<
			string,
			{ number: string | null; name: string | null }
		>();
		for (const c of contractors) {
			contractorById.set(c.contractor_id, {
				number: nonEmpty(c.contractor_number),
				name: nonEmpty(c.contractor_bus_name),
			});
		}
		console.log(
			`Loaded ${contractorById.size} MACs (sample First Coast: ${JSON.stringify(contractorById.get("370"))})`,
		);

		// ─── 1. LCDs ────────────────────────────────────────────────────────
		const lcdRows = loadCsvAsObjects(path.join(args["lcd-dir"], "lcd.csv")).rows;
		console.log(`\nParsed ${lcdRows.length} LCD rows`);

		// Wipe regulatory-engine LCD tables and rebuild from scratch.
		await client.query(`DELETE FROM lcd_article_icd10s`);
		await client.query(`DELETE FROM lcd_article_cpts`);
		await client.query(`DELETE FROM lcd_article_links`);
		await client.query(`DELETE FROM lcd_article_contractors`);
		await client.query(`DELETE FROM lcd_articles`);
		await client.query(`DELETE FROM lcd_contractors`);
		await client.query(`DELETE FROM lcds`);

		const now = new Date();
		const lcdValues = lcdRows.map((r) => [
			r.lcd_id,
			Number(r.lcd_version) || 0,
			r.title || "(untitled)",
			nonEmpty(r.display_id),
			nonEmpty(r.status),
			parseDate(r.orig_det_eff_date),
			parseDate(r.rev_eff_date),
			parseDate(r.last_updated),
			parseDate(r.mcd_publish_date),
			nonEmpty(r.indication),
			stripHtml(r.indication),
			nonEmpty(r.coding_guidelines),
			stripHtml(r.coding_guidelines),
			nonEmpty(r.doc_reqs),
			stripHtml(r.doc_reqs),
			nonEmpty(r.util_guide),
			stripHtml(r.util_guide),
			nonEmpty(r.summary_of_evidence),
			stripHtml(r.summary_of_evidence),
			nonEmpty(r.analysis_of_evidence),
			stripHtml(r.analysis_of_evidence),
			nonEmpty(r.diagnoses_support),
			stripHtml(r.diagnoses_support),
			nonEmpty(r.bibliography),
			stripHtml(r.bibliography),
			nonEmpty(r.keywords),
			now,
		]);

		const lcdColumns = [
			"lcdId",
			"version",
			"title",
			"displayId",
			"status",
			"origEffectiveDate",
			"revEffectiveDate",
			"lastUpdated",
			"mcdPublishDate",
			"indication",
			"indicationPlain",
			"codingGuidelines",
			"codingGuidelinesPlain",
			"docReqs",
			"docReqsPlain",
			"utilGuide",
			"utilGuidePlain",
			"summaryOfEvidence",
			"summaryOfEvidencePlain",
			"analysisOfEvidence",
			"analysisOfEvidencePlain",
			"diagnosesSupport",
			"diagnosesSupportPlain",
			"bibliography",
			"bibliographyPlain",
			"keywords",
			"updatedAt",
		];

		const lcdInserted = await bulkInsert(
			client,
			"lcds",
			lcdColumns,
			lcdValues,
			`ON CONFLICT ("lcdId","version") DO NOTHING`,
			100,
		);
		console.log(`lcds: ${lcdInserted} inserted`);

		// Build lookup (lcdId, version) → db id for joins.
		const lcdIdMap = new Map<string, number>();
		const lcdRes = await client.query(`SELECT id, "lcdId", version FROM lcds`);
		for (const row of lcdRes.rows)
			lcdIdMap.set(`${row.lcdId}|${row.version}`, row.id);

		// ─── 2. LCD Contractors ──────────────────────────────────────────────
		const lcdContractorRows = loadCsvAsObjects(
			path.join(args["lcd-dir"], "lcd_x_contractor.csv"),
		).rows;
		const lcdContractorValues: unknown[][] = [];
		for (const r of lcdContractorRows) {
			const dbId = lcdIdMap.get(`${r.lcd_id}|${r.lcd_version}`);
			if (!dbId) continue;
			const c = contractorById.get(r.contractor_id);
			if (!c) continue;
			lcdContractorValues.push([
				dbId,
				c.number || r.contractor_id,
				c.name,
				null, // jurisdiction — TODO: resolve via contractor_jurisdiction.csv if needed
			]);
		}
		const lcdCInserted = await bulkInsert(
			client,
			"lcd_contractors",
			["lcdId", "contractorNumber", "contractorName", "jurisdiction"],
			lcdContractorValues,
			`ON CONFLICT ("lcdId","contractorNumber") DO NOTHING`,
		);
		console.log(`lcd_contractors: ${lcdCInserted} inserted`);

		// ─── 3. Articles ─────────────────────────────────────────────────────
		const articleRows = loadCsvAsObjects(
			path.join(args["article-dir"], "article.csv"),
		).rows;
		console.log(`\nParsed ${articleRows.length} Article rows`);

		const articleValues = articleRows.map((r) => [
			r.article_id,
			Number(r.article_version) || 0,
			r.title || "(untitled)",
			nonEmpty(r.article_type),
			nonEmpty(r.display_id),
			nonEmpty(r.status),
			parseDate(r.article_eff_date),
			parseDate(r.article_rev_end_date),
			parseDate(r.last_updated),
			nonEmpty(r.description),
			stripHtml(r.description),
			nonEmpty(r.other_comments),
			stripHtml(r.other_comments),
			now,
		]);
		const aInserted = await bulkInsert(
			client,
			"lcd_articles",
			[
				"articleId",
				"version",
				"title",
				"articleType",
				"displayId",
				"status",
				"origEffectiveDate",
				"revEffectiveDate",
				"lastUpdated",
				"description",
				"descriptionPlain",
				"otherComments",
				"otherCommentsPlain",
				"updatedAt",
			],
			articleValues,
			`ON CONFLICT ("articleId","version") DO NOTHING`,
			100,
		);
		console.log(`lcd_articles: ${aInserted} inserted`);

		// Article (articleId, version) → db id lookup.
		const articleIdMap = new Map<string, number>();
		const aRes = await client.query(
			`SELECT id, "articleId", version FROM lcd_articles`,
		);
		for (const row of aRes.rows)
			articleIdMap.set(`${row.articleId}|${row.version}`, row.id);

		// ─── 4. Article Contractors ──────────────────────────────────────────
		const aContractorRows = loadCsvAsObjects(
			path.join(args["article-dir"], "article_x_contractor.csv"),
		).rows;
		const aContractorValues: unknown[][] = [];
		for (const r of aContractorRows) {
			const dbId = articleIdMap.get(`${r.article_id}|${r.article_version}`);
			if (!dbId) continue;
			const c = contractorById.get(r.contractor_id);
			if (!c) continue;
			aContractorValues.push([
				dbId,
				c.number || r.contractor_id,
				c.name,
				null,
			]);
		}
		const aContractorInserted = await bulkInsert(
			client,
			"lcd_article_contractors",
			["articleId", "contractorNumber", "contractorName", "jurisdiction"],
			aContractorValues,
			`ON CONFLICT ("articleId","contractorNumber") DO NOTHING`,
		);
		console.log(`lcd_article_contractors: ${aContractorInserted} inserted`);

		// ─── 5. LCD ↔ Article links (from lcd_related_documents) ─────────────
		const relatedRows = loadCsvAsObjects(
			path.join(args["lcd-dir"], "lcd_related_documents.csv"),
		).rows;
		const linkValues: unknown[][] = [];
		for (const r of relatedRows) {
			if (!r.r_article_id) continue;
			const lcdDbId = lcdIdMap.get(`${r.lcd_id}|${r.lcd_version}`);
			const articleDbId = articleIdMap.get(
				`${r.r_article_id}|${r.r_article_version}`,
			);
			if (!lcdDbId || !articleDbId) continue;
			linkValues.push([lcdDbId, articleDbId]);
		}
		const linkInserted = await bulkInsert(
			client,
			"lcd_article_links",
			["lcdId", "articleId"],
			linkValues,
			`ON CONFLICT ("lcdId","articleId") DO NOTHING`,
		);
		console.log(`lcd_article_links: ${linkInserted} inserted`);

		// ─── 6. Article → HCPCS/CPT codes ────────────────────────────────────
		const hcpcRows = loadCsvAsObjects(
			path.join(args["article-dir"], "article_x_hcpc_code.csv"),
		).rows;
		const hcpcValues: unknown[][] = [];
		for (const r of hcpcRows) {
			const dbId = articleIdMap.get(`${r.article_id}|${r.article_version}`);
			if (!dbId) continue;
			const cpt = nonEmpty(r.hcpc_code_id);
			if (!cpt) continue;
			hcpcValues.push([
				dbId,
				cpt,
				nonEmpty(r.long_description) || nonEmpty(r.short_description),
				nonEmpty(r.hcpc_code_group)
					? Number(r.hcpc_code_group) || null
					: null,
			]);
		}
		const hcpcInserted = await bulkInsert(
			client,
			"lcd_article_cpts",
			["articleId", "cpt", "description", "sequence"],
			hcpcValues,
			``, // no dedupe — multiple rows per (article, cpt) are legal (different ranges)
		);
		console.log(`lcd_article_cpts: ${hcpcInserted} inserted`);

		// ─── 7. Article → ICD-10 (covered + noncovered) ──────────────────────
		for (const [file, coverage] of [
			["article_x_icd10_covered.csv", "COVERED"],
			["article_x_icd10_noncovered.csv", "NONCOVERED"],
		] as const) {
			const full = path.join(args["article-dir"], file);
			if (!fs.existsSync(full)) continue;
			const rows = loadCsvAsObjects(full).rows;
			const values: unknown[][] = [];
			for (const r of rows) {
				const dbId = articleIdMap.get(
					`${r.article_id}|${r.article_version}`,
				);
				if (!dbId) continue;
				const icd = nonEmpty(r.icd10_code_id);
				if (!icd) continue;
				values.push([dbId, icd, coverage, nonEmpty(r.description)]);
			}
			const ins = await bulkInsert(
				client,
				"lcd_article_icd10s",
				["articleId", "icd10", "coverage", "description"],
				values,
				``,
				1000,
			);
			console.log(`lcd_article_icd10s (${coverage}): ${ins} inserted`);
		}

		console.log("\nMCD load complete.");
	} finally {
		await client.end();
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
