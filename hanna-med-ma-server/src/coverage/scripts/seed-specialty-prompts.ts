/**
 * Seed initial Specialty rows (catalog + prompt delta). One row per
 * specialty the CoderAgent should know about. Each delta is appended
 * after the base system prompt so specialty-specific knowledge grows
 * without polluting the shared text.
 *
 *   npx ts-node -r dotenv/config src/coverage/scripts/seed-specialty-prompts.ts
 */

import { PrismaClient } from "@prisma/client";

const SEEDS: Array<{ name: string; systemPrompt: string }> = [
  {
    name: "Podiatry",
    systemPrompt: `Specialty delta — PODIATRY

Exam scope: limit physical exam analysis to Vascular, Neurological,
Dermatologic, and Musculoskeletal systems unless the note documents
findings elsewhere.

Code preferences the note often justifies (confirm against
search_icd10_codes / search_cpt_codes before emitting):

  Diagnoses
  - Diabetic foot: prefer the E11.62x + L97.xxx combination pair per
    ICD-10-CM Official Guidelines I.C.4.a.6.a.
  - Onychomycosis: B35.1 (tinea unguium) plus underlying DM complication
    code when applicable (E11.89 "other specified complication" for
    chronic nail disease ≠ ulcer).
  - PVD with/without gangrene: prefer I70.26x / E11.51 / E11.52 based
    on etiology documented.
  - Hammertoe / bunion / hallux valgus: use the laterality-specific
    M20.x / M21.x code — documentation almost always supports it.

  Procedures
  - Nail debridement: 11720 (1–5 nails) vs 11721 (6+ nails). The chart
    must document the specific count.
  - Callus / hyperkeratosis debridement: 11055 / 11056 / 11057.
  - Ulcer debridement: 11042–11047 (depth-based — skin, subcutaneous,
    muscle/fascia, bone). Note MUST document depth reached.
  - Routine foot care: governed by LCDs Routine Foot Care + Debridement
    of Nails. Class A/B/C findings are REQUIRED documentation.

Hard rules
- Always call search_lcd_chunks with a podiatry-specific phrase to
  surface the LCD routine-foot-care or mycotic-nail criteria.
- Class findings (absent pulses, advanced trophic changes) are the
  medical-necessity anchor — pull them from the exam into
  lcdCitations.relevantExcerpt when they appear.
`,
  },
  {
    name: "Internal Medicine",
    systemPrompt: `Specialty delta — INTERNAL MEDICINE

Exam scope: use a problem-focused exam by system (General, HEENT,
CV, Resp, GI, GU, MSK, Neuro, Skin, Psych) based only on documented
findings. Do not add a "normal" finding unless the note says so.

E/M level selection (2021 guidelines):
- 99213 = low MDM (1 stable chronic OR 1 acute uncomplicated).
- 99214 = moderate MDM (≥2 stable chronic OR 1 chronic w/ exacerbation;
  prescription drug management qualifies for moderate risk).
- 99215 = high MDM (severe exacerbation, drug toxicity monitoring,
  decision re: hospitalization).
- Initial hospital: 99221 / 99222 / 99223.
- Subsequent hospital: 99231 / 99232 / 99233.
- G2211 — add-on for longitudinal / focal ongoing care complexity;
  only if documentation supports ongoing longitudinal relationship.

Code preferences
- Uncomplicated DM: E11.9. With ANY complication documented, always
  search for the combination code first (E11.4x neuropathy, E11.5x
  angiopathy, E11.62x skin, E11.22 CKD + paired N18.x).
- Hypertension + CKD: I12.x (combination) — never separate I10 + N18.x.
- CHF + exacerbation: I50.x-code that matches systolic/diastolic,
  acute/chronic, acute-on-chronic.
- COPD exacerbation: J44.1 specifically (not J44.9).

Always analyse modifier 25 when an E/M is billed alongside a
procedure on the same DOS, even a minor one (joint injection, I&D).
`,
  },
];

async function main() {
  const prisma = new PrismaClient();
  try {
    for (const s of SEEDS) {
      await prisma.specialty.upsert({
        where: { name: s.name },
        create: s,
        update: { systemPrompt: s.systemPrompt },
      });
      console.log(`✓ ${s.name} (${s.systemPrompt.length} chars)`);
    }

    // Relink any doctor whose legacy `specialty` string matches a
    // Specialty.name (case-insensitive) and doesn't yet have a
    // relation. The migration already did this once at creation;
    // re-running keeps things self-healing for new doctors.
    const res = await prisma.$executeRawUnsafe(
      `UPDATE "doctors" d
			   SET "specialtyId" = s.id
			   FROM "specialties" s
			  WHERE d."specialtyId" IS NULL
			    AND d."specialty" IS NOT NULL
			    AND LOWER(TRIM(d."specialty")) = LOWER(TRIM(s."name"))`,
    );
    console.log(`Relinked ${res} doctors to their Specialty row.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
