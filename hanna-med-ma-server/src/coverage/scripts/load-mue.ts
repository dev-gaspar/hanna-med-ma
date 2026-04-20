/**
 * MUE (Medically Unlikely Edits) loader — all three CMS tables:
 * Practitioner / Outpatient Hospital / DME Supplier.
 *
 *   npx ts-node -r dotenv/config src/coverage/scripts/load-mue.ts \
 *       --dir ./data/mue/2026q2 \
 *       --effective 2026-04-01
 *
 * Each CSV has a multi-line copyright header followed by a two-line
 * column header ("HCPCS/\nCPT Code"). We skip everything until we hit
 * a row whose first cell is a 5-char alphanumeric HCPCS code.
 *
 * Columns:
 *   [0] HCPCS/CPT Code
 *   [1] Services MUE Values     (int)
 *   [2] MUE Adjudication Indicator — "<n> <description>" where n ∈ {1,2,3}
 *   [3] MUE Rationale
 */

import { Client } from "pg";
import * as fs from "fs";
import * as path from "path";

const FILES: {
	file: RegExp;
	serviceType: "PRACTITIONER" | "OUTPATIENT" | "DME";
}[] = [
	{ file: /practitioner/i, serviceType: "PRACTITIONER" },
	{ file: /outpatient/i, serviceType: "OUTPATIENT" },
	{ file: /dme/i, serviceType: "DME" },
];

function parseArgs(argv: string[]) {
	const out: Record<string, string> = {};
	for (let i = 2; i < argv.length; i += 2) {
		const k = argv[i]?.replace(/^--/, "");
		const v = argv[i + 1];
		if (k && v) out[k] = v;
	}
	return out as { dir: string; effective: string };
}

function splitCsvLine(line: string): string[] {
	const out: string[] = [];
	let cur = "";
	let inQuotes = false;
	for (const ch of line) {
		if (ch === '"') {
			inQuotes = !inQuotes;
			continue;
		}
		if (ch === "," && !inQuotes) {
			out.push(cur);
			cur = "";
			continue;
		}
		cur += ch;
	}
	out.push(cur);
	return out.map((s) => s.trim());
}

// Some copyright paragraphs use real newlines inside quoted fields —
// rejoin quoted runs so each logical CSV record is one string.
function joinCsvRecords(raw: string): string[] {
	const lines = raw.split(/\r?\n/);
	const out: string[] = [];
	let cur = "";
	let inQ = false;
	for (const ln of lines) {
		for (const ch of ln) if (ch === '"') inQ = !inQ;
		cur = cur ? cur + "\n" + ln : ln;
		if (!inQ) {
			if (cur.trim().length > 0) out.push(cur);
			cur = "";
		}
	}
	if (cur.trim().length > 0) out.push(cur);
	return out;
}

async function loadFile(
	client: Client,
	filePath: string,
	serviceType: "PRACTITIONER" | "OUTPATIENT" | "DME",
	effective: string,
): Promise<number> {
	const raw = fs.readFileSync(filePath, "utf8");
	const records = joinCsvRecords(raw);

	const parsed: {
		cpt: string;
		mueValue: number;
		adjudicationIndicator: string;
		mai: string;
		rationale: string | null;
	}[] = [];

	for (const rec of records) {
		const cols = splitCsvLine(rec);
		const cpt = cols[0];
		if (!cpt || !/^[A-Z0-9]{5}$/.test(cpt)) continue;
		const mueValue = Number(cols[1]);
		if (!Number.isFinite(mueValue)) continue;
		const adjIndicator = cols[2] || "";
		const mai = (adjIndicator.trim().match(/^(\d)/)?.[1]) || "";
		parsed.push({
			cpt,
			mueValue,
			adjudicationIndicator: adjIndicator,
			mai,
			rationale: cols[3] || null,
		});
	}

	// Rerunnable: wipe this service-type + effective-date slice first.
	await client.query(
		`DELETE FROM mue_limits WHERE "serviceType" = $1 AND "effectiveDate" = $2`,
		[serviceType, effective],
	);

	const CHUNK = 500;
	let inserted = 0;
	for (let i = 0; i < parsed.length; i += CHUNK) {
		const slice = parsed.slice(i, i + CHUNK);
		const placeholders: string[] = [];
		const values: unknown[] = [];
		slice.forEach((r, j) => {
			const b = j * 7;
			placeholders.push(
				`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7})`,
			);
			values.push(
				r.cpt,
				r.mueValue,
				r.adjudicationIndicator,
				r.mai,
				r.rationale,
				serviceType,
				effective,
			);
		});
		const res = await client.query(
			`INSERT INTO "mue_limits"
			 ("cpt","mueValue","adjudicationIndicator","mai","rationale","serviceType","effectiveDate")
			 VALUES ${placeholders.join(",")}
			 ON CONFLICT ("cpt","serviceType","effectiveDate") DO NOTHING`,
			values,
		);
		inserted += res.rowCount ?? 0;
	}
	console.log(
		`  ${serviceType}: parsed ${parsed.length}, inserted ${inserted} (${path.basename(filePath)})`,
	);
	return inserted;
}

async function main() {
	const args = parseArgs(process.argv);
	if (!args.dir || !args.effective) {
		console.error(
			"Usage: ts-node load-mue.ts --dir <mue dir> --effective YYYY-MM-DD",
		);
		process.exit(1);
	}
	const databaseUrl = process.env.SERVER_DATABASE_URL;
	if (!databaseUrl) throw new Error("SERVER_DATABASE_URL not set");

	const client = new Client({ connectionString: databaseUrl });
	await client.connect();

	try {
		let total = 0;
		for (const f of fs.readdirSync(args.dir)) {
			if (!/\.csv$/i.test(f)) continue;
			const match = FILES.find((x) => x.file.test(f));
			if (!match) continue;
			total += await loadFile(
				client,
				path.join(args.dir, f),
				match.serviceType,
				args.effective,
			);
		}
		console.log(`\nMUE total inserted: ${total}`);
	} finally {
		await client.end();
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
