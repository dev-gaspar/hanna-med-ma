/**
 * CMS Medicare Physician Fee Schedule (MPFS) loader — Florida Locality 04.
 *
 * This script is a SKELETON. It encodes the math and the write path so that
 * once we have the raw CMS files on disk, populating the database is just
 * a matter of pointing the loader at them:
 *
 *   npx ts-node src/coverage/scripts/load-mpfs.ts \
 *       --rvu ./data/mpfs/2026/PPRRVU26_JAN.csv \
 *       --gpci ./data/mpfs/2026/GPCI2026.csv \
 *       --year 2026 \
 *       --state FL --locality 04
 *
 * File sources (download manually from cms.gov):
 *   RVU file (PPRRVU*):   https://www.cms.gov/medicare/payment/fee-schedules/physician/pfs-relative-value-files
 *   GPCI file:            same page, "GPCIs" zip for the given year
 *   Conversion factor:    CMS publishes this annually; hard-code per year below.
 *
 * The CMS column names drift year to year; the `parseRvuRow` / `parseGpciRow`
 * helpers are the only places that need adjusting per release.
 */

import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

// 2026 Medicare Physician Fee Schedule conversion factor.
// Update annually from the CMS Final Rule publication.
// Placeholder — swap in the real 2026 CF once the Final Rule lands.
const CONVERSION_FACTOR_BY_YEAR: Record<number, number> = {
	2026: 32.3465, // TODO: confirm against CMS Final Rule 2026
};

interface GpciRow {
	state: string;
	localityCode: string; // "04"
	description: string; // "Miami, FL"
	macContractor: string | null;
	workGpci: number;
	peGpci: number;
	mpGpci: number;
}

interface RvuRow {
	cpt: string;
	modifier: string | null;
	description: string | null;
	workRvu: number;
	peRvu: number; // non-facility
	peFacilityRvu: number | null;
	mpRvu: number;
	globalDays: string | null;
	statusCode: string | null;
}

function parseArgs(argv: string[]) {
	const out: Record<string, string> = {};
	for (let i = 2; i < argv.length; i += 2) {
		const k = argv[i]?.replace(/^--/, "");
		const v = argv[i + 1];
		if (k && v) out[k] = v;
	}
	return out as {
		rvu: string;
		gpci: string;
		year: string;
		state: string;
		locality: string;
	};
}

function splitCsvLine(line: string): string[] {
	// Minimal CSV splitter — good enough for CMS files (no embedded newlines,
	// occasional quoted commas). Swap for `csv-parse` if we hit edge cases.
	const out: string[] = [];
	let cur = "";
	let inQuotes = false;
	for (const ch of line) {
		if (ch === '"') {
			inQuotes = !inQuotes;
			continue;
		}
		if (ch === "," && !inQuotes) {
			out.push(cur.trim());
			cur = "";
			continue;
		}
		cur += ch;
	}
	out.push(cur.trim());
	return out;
}

function loadCsv(filePath: string): string[][] {
	const raw = fs.readFileSync(filePath, "utf8");
	return raw
		.split(/\r?\n/)
		.filter((l) => l.trim().length > 0)
		.map(splitCsvLine);
}

// CMS releases GPCI files with columns roughly:
// MAC | LocalityNumber | LocalityName | State | PW GPCI | PE GPCI | MP GPCI
// Column positions move year to year — confirm the header row before loading.
function parseGpciRow(cols: string[]): GpciRow | null {
	if (cols.length < 7) return null;
	const localityCode = cols[1]?.padStart(2, "0");
	if (!/^\d{2}$/.test(localityCode || "")) return null;
	return {
		macContractor: cols[0] || null,
		localityCode: localityCode!,
		description: cols[2] || "",
		state: cols[3] || "",
		workGpci: Number(cols[4]),
		peGpci: Number(cols[5]),
		mpGpci: Number(cols[6]),
	};
}

// CMS PPRRVU release columns vary; typical lead columns:
// HCPCS | Modifier | Description | Status | Work RVU | Non-Fac PE RVU | Fac PE RVU | MP RVU | ... | Global
function parseRvuRow(cols: string[]): RvuRow | null {
	const cpt = cols[0];
	if (!cpt || !/^[A-Z0-9]{5}$/.test(cpt)) return null;
	return {
		cpt,
		modifier: cols[1] && cols[1].length > 0 ? cols[1] : null,
		description: cols[2] || null,
		statusCode: cols[3] || null,
		workRvu: Number(cols[4]) || 0,
		peRvu: Number(cols[5]) || 0,
		peFacilityRvu: cols[6] !== "" ? Number(cols[6]) : null,
		mpRvu: Number(cols[7]) || 0,
		globalDays: cols[16] || null, // position varies — verify against the header row
	};
}

async function main() {
	const args = parseArgs(process.argv);
	if (!args.rvu || !args.gpci || !args.year || !args.state || !args.locality) {
		console.error(
			"Usage: ts-node load-mpfs.ts --rvu <PPRRVU.csv> --gpci <GPCI.csv> --year <2026> --state <FL> --locality <04>",
		);
		process.exit(1);
	}
	const year = Number(args.year);
	const cf = CONVERSION_FACTOR_BY_YEAR[year];
	if (!cf) {
		throw new Error(
			`No conversion factor configured for year ${year}. Add it to CONVERSION_FACTOR_BY_YEAR.`,
		);
	}

	const prisma = new PrismaClient();
	try {
		// 1. GPCI — find and upsert the target locality.
		const gpciRows = loadCsv(path.resolve(args.gpci))
			.slice(1) // drop header
			.map(parseGpciRow)
			.filter((r): r is GpciRow => r !== null);

		const target = gpciRows.find(
			(r) =>
				r.state.toUpperCase() === args.state.toUpperCase() &&
				r.localityCode === args.locality.padStart(2, "0"),
		);
		if (!target) {
			throw new Error(
				`GPCI row not found for state=${args.state} locality=${args.locality}`,
			);
		}

		const locality = await prisma.locality.upsert({
			where: {
				code_state_year: {
					code: target.localityCode,
					state: target.state.toUpperCase(),
					year,
				},
			},
			create: {
				code: target.localityCode,
				state: target.state.toUpperCase(),
				description: target.description,
				macContractor: target.macContractor,
				workGpci: target.workGpci,
				peGpci: target.peGpci,
				mpGpci: target.mpGpci,
				year,
			},
			update: {
				description: target.description,
				macContractor: target.macContractor,
				workGpci: target.workGpci,
				peGpci: target.peGpci,
				mpGpci: target.mpGpci,
			},
		});

		console.log(
			`Locality ${target.state}-${target.localityCode} (${target.description}) loaded.`,
		);

		// 2. RVU — per CPT, compute amount and upsert.
		const rvuRows = loadCsv(path.resolve(args.rvu))
			.slice(1)
			.map(parseRvuRow)
			.filter((r): r is RvuRow => r !== null);

		let inserted = 0;
		let updated = 0;
		for (const r of rvuRows) {
			const amountNonFac =
				(r.workRvu * target.workGpci +
					r.peRvu * target.peGpci +
					r.mpRvu * target.mpGpci) *
				cf;
			const amountFac =
				r.peFacilityRvu !== null
					? (r.workRvu * target.workGpci +
							r.peFacilityRvu * target.peGpci +
							r.mpRvu * target.mpGpci) *
						cf
					: null;

			const existing = await prisma.feeScheduleItem.findUnique({
				where: {
					cpt_modifier_localityId_year: {
						cpt: r.cpt,
						modifier: r.modifier,
						localityId: locality.id,
						year,
					},
				},
			});

			await prisma.feeScheduleItem.upsert({
				where: {
					cpt_modifier_localityId_year: {
						cpt: r.cpt,
						modifier: r.modifier,
						localityId: locality.id,
						year,
					},
				},
				create: {
					cpt: r.cpt,
					modifier: r.modifier,
					year,
					localityId: locality.id,
					description: r.description,
					workRvu: r.workRvu,
					peRvu: r.peRvu,
					peFacilityRvu: r.peFacilityRvu,
					mpRvu: r.mpRvu,
					conversionFactor: cf,
					amountUsd: Number(amountNonFac.toFixed(2)),
					amountFacilityUsd:
						amountFac !== null ? Number(amountFac.toFixed(2)) : null,
					globalDays: r.globalDays,
					statusCode: r.statusCode,
				},
				update: {
					description: r.description,
					workRvu: r.workRvu,
					peRvu: r.peRvu,
					peFacilityRvu: r.peFacilityRvu,
					mpRvu: r.mpRvu,
					conversionFactor: cf,
					amountUsd: Number(amountNonFac.toFixed(2)),
					amountFacilityUsd:
						amountFac !== null ? Number(amountFac.toFixed(2)) : null,
					globalDays: r.globalDays,
					statusCode: r.statusCode,
				},
			});
			if (existing) updated++;
			else inserted++;
		}

		console.log(
			`MPFS ${year} loaded for ${target.state}-${target.localityCode}: ${inserted} inserted, ${updated} updated.`,
		);
	} finally {
		await prisma.$disconnect();
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
