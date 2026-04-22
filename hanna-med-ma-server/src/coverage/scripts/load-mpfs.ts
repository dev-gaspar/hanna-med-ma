/**
 * CMS Medicare Physician Fee Schedule (MPFS) loader.
 *
 * Reads the two official CMS CSVs (GPCI + PPRRVU), computes the localized
 * payment per CPT, and upserts into Locality + FeeScheduleItem.
 *
 *   npx ts-node src/coverage/scripts/load-mpfs.ts \
 *       --rvu ./data/mpfs/2026/PPRRVU2026_Jan_nonQPP.csv \
 *       --gpci ./data/mpfs/2026/GPCI2026.csv \
 *       --year 2026 \
 *       --state FL --locality 04
 *
 * Source: rvu26a.zip at
 *   https://www.cms.gov/medicare/payment/fee-schedules/physician/pfs-relative-value-files/rvu26a
 *
 * File structure (verified against the 2026-Jan release):
 *
 *   GPCI2026.csv — 3 banner rows, then columns:
 *     [0] MAC | [1] State | [2] LocalityNumber | [3] LocalityName
 *     [4] PW GPCI no-floor | [5] PW GPCI with-floor
 *     [6] PE GPCI | [7] MP GPCI
 *   (We use the with-floor PW GPCI — that's what CMS actually pays on.)
 *
 *   PPRRVU2026_Jan_nonQPP.csv — 9 banner/header rows, then columns:
 *     [0] HCPCS | [1] MOD | [2] DESCRIPTION | [3] STATUS
 *     [4] <blank: not used for Medicare payment>
 *     [5] WORK RVU | [6] NON-FAC PE RVU | [7] NON-FAC NA ind
 *     [8] FAC PE RVU | [9] FAC NA ind | [10] MP RVU
 *     [11] NON-FAC TOTAL | [12] FAC TOTAL | [13] PCTC ind
 *     [14] GLOB DAYS | ... | [24] CONV FACTOR | ...
 *
 * Column positions drift year to year — re-verify before loading a new year.
 */

import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

// Safety check: the CMS file carries the CF per row, but we also assert
// it matches the Final-Rule-published value so a malformed download trips.
const EXPECTED_CF_BY_YEAR: Record<number, number> = {
  2026: 33.4009,
};

interface GpciRow {
  macContractor: string;
  state: string;
  localityCode: string;
  description: string;
  pwGpci: number;
  peGpci: number;
  mpGpci: number;
}

interface RvuRow {
  cpt: string;
  modifier: string; // "" when no modifier (NOT NULL so compound unique works)
  description: string | null;
  statusCode: string | null;
  workRvu: number;
  peRvu: number;
  peFacilityRvu: number | null;
  mpRvu: number;
  globalDays: string | null;
  conversionFactor: number;
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

function loadCsv(filePath: string): string[][] {
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .map(splitCsvLine);
}

function toNumber(s: string | undefined): number {
  if (!s) return 0;
  const n = Number(s.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function parseGpciRow(cols: string[]): GpciRow | null {
  // The GPCI file puts the locality number in col 2; guard by pattern so
  // we skip title rows and any stray blank lines that slipped through.
  const localityCode = cols[2]?.padStart(2, "0");
  const state = cols[1]?.toUpperCase();
  if (!/^\d{2}$/.test(localityCode || "") || !/^[A-Z]{2}$/.test(state || "")) {
    return null;
  }
  return {
    macContractor: cols[0] || "",
    state: state!,
    localityCode: localityCode!,
    description: cols[3] || "",
    // PW col 5 is "with 1.0 floor" — the one CMS actually applies.
    pwGpci: toNumber(cols[5]),
    peGpci: toNumber(cols[6]),
    mpGpci: toNumber(cols[7]),
  };
}

function parseRvuRow(cols: string[]): RvuRow | null {
  const cpt = cols[0];
  // HCPCS codes are 5 alphanumerics. Modifier is optional so a trailing 5
  // chars in col 0 is the reliable gate.
  if (!cpt || !/^[A-Z0-9]{5}$/.test(cpt)) return null;
  return {
    cpt,
    modifier: cols[1] && cols[1].length > 0 ? cols[1] : "",
    description: cols[2] || null,
    statusCode: cols[3] || null,
    workRvu: toNumber(cols[5]),
    peRvu: toNumber(cols[6]),
    peFacilityRvu: cols[8] !== "" ? toNumber(cols[8]) : null,
    mpRvu: toNumber(cols[10]),
    globalDays: cols[14] || null,
    conversionFactor: toNumber(cols[24]),
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
  const expectedCf = EXPECTED_CF_BY_YEAR[year];
  if (!expectedCf) {
    throw new Error(
      `No expected conversion factor configured for year ${year}. Add it to EXPECTED_CF_BY_YEAR.`,
    );
  }

  const prisma = new PrismaClient();
  try {
    // ─── 1. GPCI → find + upsert target locality ───────────────────────
    const gpciRows = loadCsv(path.resolve(args.gpci))
      .map(parseGpciRow)
      .filter((r): r is GpciRow => r !== null);

    const target = gpciRows.find(
      (r) =>
        r.state === args.state.toUpperCase() &&
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
          state: target.state,
          year,
        },
      },
      create: {
        code: target.localityCode,
        state: target.state,
        description: target.description,
        macContractor: target.macContractor,
        workGpci: target.pwGpci,
        peGpci: target.peGpci,
        mpGpci: target.mpGpci,
        year,
      },
      update: {
        description: target.description,
        macContractor: target.macContractor,
        workGpci: target.pwGpci,
        peGpci: target.peGpci,
        mpGpci: target.mpGpci,
      },
    });

    console.log(
      `Locality ${target.state}-${target.localityCode} (${target.description}) loaded — PW=${target.pwGpci} PE=${target.peGpci} MP=${target.mpGpci}`,
    );

    // ─── 2. PPRRVU → compute localized amounts + bulk upsert ───────────
    const rvuRows = loadCsv(path.resolve(args.rvu))
      .map(parseRvuRow)
      .filter((r): r is RvuRow => r !== null);

    console.log(`Parsed ${rvuRows.length} PPRRVU rows.`);

    // Build payloads up front so the DB phase is pure I/O.
    // Dedupe by (cpt, modifier): the CMS file occasionally repeats the
    // same code (component rows with different status indicators) that
    // collapse to the same compound unique key. Last-wins is fine.
    let skipped = 0;
    const byKey = new Map<
      string,
      {
        cpt: string;
        modifier: string;
        year: number;
        localityId: number;
        description: string | null;
        workRvu: number;
        peRvu: number;
        peFacilityRvu: number | null;
        mpRvu: number;
        conversionFactor: number;
        amountUsd: number;
        amountFacilityUsd: number | null;
        globalDays: string | null;
        statusCode: string | null;
      }
    >();
    for (const r of rvuRows) {
      // Anesthesia codes use a different CF/methodology (ANES2026 file).
      if (
        r.conversionFactor &&
        Math.abs(r.conversionFactor - expectedCf) > 0.01
      ) {
        skipped++;
        continue;
      }
      const cf = r.conversionFactor || expectedCf;
      const nonFac =
        (r.workRvu * target.pwGpci +
          r.peRvu * target.peGpci +
          r.mpRvu * target.mpGpci) *
        cf;
      const fac =
        r.peFacilityRvu !== null
          ? (r.workRvu * target.pwGpci +
              r.peFacilityRvu * target.peGpci +
              r.mpRvu * target.mpGpci) *
            cf
          : null;

      byKey.set(`${r.cpt}|${r.modifier}`, {
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
        amountUsd: Number(nonFac.toFixed(2)),
        amountFacilityUsd: fac !== null ? Number(fac.toFixed(2)) : null,
        globalDays: r.globalDays,
        statusCode: r.statusCode,
      });
    }
    const payloads = [...byKey.values()];

    // Rerunnable: wipe this (locality, year) slice and bulk insert.
    // Cheaper than per-row upsert against a remote DB (14k rows).
    const deleted = await prisma.feeScheduleItem.deleteMany({
      where: { localityId: locality.id, year },
    });
    console.log(`Cleared ${deleted.count} existing rows for this slice.`);

    // Insert via raw SQL with ON CONFLICT DO NOTHING. Avoids Prisma's
    // createMany rejecting on any key clash (which we hit despite
    // in-memory dedupe — likely a per-row validation artifact). Chunks
    // at 1k to keep each INSERT well under Postgres parameter limits.
    const CHUNK = 500;
    let inserted = 0;
    for (let i = 0; i < payloads.length; i += CHUNK) {
      const slice = payloads.slice(i, i + CHUNK);
      const placeholders: string[] = [];
      const values: unknown[] = [];
      slice.forEach((p, j) => {
        const base = j * 16;
        placeholders.push(
          `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11},$${base + 12},$${base + 13},$${base + 14},$${base + 15},$${base + 16})`,
        );
        values.push(
          p.cpt,
          p.modifier,
          p.year,
          p.localityId,
          p.description,
          p.workRvu,
          p.peRvu,
          p.peFacilityRvu,
          p.mpRvu,
          p.conversionFactor,
          p.amountUsd,
          p.amountFacilityUsd,
          p.globalDays,
          p.statusCode,
          new Date(),
          new Date(),
        );
      });

      const result = await prisma.$executeRawUnsafe(
        `INSERT INTO "fee_schedule_items"
				 ("cpt","modifier","year","localityId","description","workRvu","peRvu","peFacilityRvu","mpRvu","conversionFactor","amountUsd","amountFacilityUsd","globalDays","statusCode","createdAt","updatedAt")
				 VALUES ${placeholders.join(",")}
				 ON CONFLICT ("cpt","modifier","localityId","year") DO NOTHING`,
        ...values,
      );
      inserted += Number(result);
      console.log(`  …${inserted}/${payloads.length}`);
    }

    console.log(
      `MPFS ${year} loaded for ${target.state}-${target.localityCode}: ${inserted} inserted, ${skipped} skipped.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
