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

# Diagnoses

Code preferences the note often justifies (confirm against
search_icd10_codes before emitting):

- Diabetic foot ulcer: emit the E11.62x + L97.xxx COMBINATION pair
  per ICD-10-CM Official Guidelines I.C.4.a.6.a — etiology code
  first (E11.621 "with foot ulcer", E11.622 "with other skin
  ulcer"), location/depth code second (L97.5xx forefoot, L97.4xx
  heel/midfoot, etc., with the depth-axis 0/1/2/3/4/5 from the
  note).
- Onychomycosis: B35.1 (tinea unguium) plus underlying DM
  complication code when applicable (E11.89 "other specified
  complication" for chronic nail disease ≠ ulcer).
- PVD with / without gangrene: prefer I70.26x (atherosclerosis
  of native arteries with gangrene), E11.51 (DM with PAD), E11.52
  (DM with PAD with gangrene) — pick by the etiology
  documented.
- Hammertoe / bunion / hallux valgus: use the laterality-specific
  M20.x / M21.x — documentation almost always supports laterality.
- Cellulitis vs post-op infection ≥4w out: when the timing and
  documentation support it, lead with the cellulitis ICD (L03.xxx)
  rather than T81.49XA "infection following a procedure". The
  cellulitis is what's being managed; the post-op linkage is
  context. (Practice convention may further specify §II.G
  override behavior — read the practice block.)

# Procedures

CPT selection rules anchored in the surgical description:

- Nail debridement: 11720 (1–5 nails) vs 11721 (6+ nails). The
  chart MUST document the specific count.
- Callus / hyperkeratosis debridement: 11055 / 11056 / 11057 —
  pick by lesion count (1 / 2-4 / 4+).
- Ulcer / wound debridement: 11042–11047 are depth-based (skin,
  subcutaneous, muscle/fascia, bone). The note MUST explicitly
  document the depth reached. If the depth is not stated, fall
  back to the E/M alone and add a documentationGap requesting
  the depth.
- Open ankle ORIF — bimalleolar / trimalleolar selection:
  * **27822** — Open treatment of trimalleolar ankle fracture,
    medial AND lateral malleolus, **WITHOUT fixation of the
    posterior lip**.
  * **27823** — Same as 27822 BUT **WITH fixation of the
    posterior lip**. Trigger: any operative description naming
    posterior-malleolar / posterior-lip plates, screws, or
    explicit ORIF of the posterior fragment. If the posterior
    fragment is mentioned but only "buttressed by syndesmotic
    repair" without dedicated fixation, stay at 27822.
  * The pre-op radiographic finding alone (trimalleolar
    fracture documented on X-ray) is NOT sufficient for 27823 —
    the OR must show actual fixation of the posterior fragment.
- Syndesmotic / ankle ligament repair:
  * **27695** — Repair, primary, disrupted ligament, **single
    ligament**. Default when only the lateral or only the
    deltoid is repaired.
  * **27696** — Repair, primary, disrupted ligament, **both
    collateral ligaments**. Trigger: explicit documentation of
    BOTH lateral collateral AND deltoid (medial collateral)
    ligament repair in the same encounter.
- TightRope / suture-button syndesmotic stabilization:
  * **27829** — Open treatment of distal tibiofibular joint
    (syndesmosis) disruption with internal **fixation**. Trigger:
    any hardware (TightRope device, syndesmotic screw, suture
    button construct) used to hold the syndesmosis. The
    presence of hardware drives this code.
  * **27860** — Manipulation of ankle under anesthesia, with or
    without external fixation, when no internal fixation is
    placed. Default when the procedure is closed manipulation
    only.
- 76000 fluoroscopy: when the operative report documents
  intraoperative fluoroscopy that is not bundled by NCCI for the
  primary procedure, include it. Practice convention may
  override the default NCCI bundling — defer to the practice
  block when present.

# E/M

Inpatient E/M family selection follows the universal rule (CONSULT
→ 99221-99223, PROGRESS → 99231-99233) modified by the
payer-aware rule resolved through lookup_payer_rule. Podiatry adds
no specialty-specific overrides on E/M family.

When the encounter is an OR encounter (encounterType = PROCEDURE),
no E/M is billed and the surgical CPT is primary; do NOT shoehorn
a 99231-99233 onto a procedure visit.

# Hard rules

- Always call search_lcd_chunks with a podiatry-specific phrase to
  surface the LCD routine-foot-care, mycotic-nail, and wound-care
  criteria.
- Class findings (absent pulses, advanced trophic changes) are
  the medical-necessity anchor — pull them from the exam into
  lcdCitations.relevantExcerpt when they appear.
- For inpatient surgical encounters, anchor the primary ICD to
  the indication (the diagnosis that prompted the surgery), and
  emit the trauma 7th-character episode-of-care correctly:
  initial encounter (A) for the operative date, subsequent (D)
  for post-op aftercare visits.

# Limb-threat assessment — REQUIRED for Podiatry encounters

Podiatry deals with diabetic foot, PAD, gangrene, osteomyelitis, and
post-amputation patients on a regular basis — limb loss is on the
differential more often than in any other specialty. For that reason,
on every Podiatry E/M encounter you MUST fill the
\`limbThreatAssessment\` block before calling \`finalize_coding\`. The
universal prompt left this block optional; this specialty re-imposes
the obligation.

When does this apply? Set \`applicable\` = true ONLY if the chief
complaint or assessment involves a foot/leg/limb pathology where
loss of limb is on the differential. Concrete triggers:
- Diabetic foot ulcer with concern for osteomyelitis
- Gangrene (wet or dry), necrotizing soft-tissue infection
- Severe PAD with rest pain or non-healing wound
- Post-traumatic compromised limb (vascular/neurologic injury)
- Deep ulcer with exposed tendon, bone, or joint
- Post-amputation stump with ischemic concern

For everything else (joint pain, plantar fasciitis, ingrown toenail,
routine debridement, post-op suture removal, stable foot deformity,
etc.) set \`applicable\` = false, \`evidenceLevel\` = NONE,
\`surgicalDecisionStatus\` = NOT_APPLICABLE,
\`evidenceSpan\` = null, \`decisionEvidenceSpan\` = null, and
\`rationale\` = "limb threat not on differential". You still fill
the block — Podiatry encounters where it doesn't apply still need
the explicit \`applicable: false\` so the audit trail is consistent.

Evidence levels (when applicable = true):
- \`CONFIRMED\` — positive imaging already in the note (X-ray, MRI,
  bone scan), positive cultures, or operative findings showing the
  threat. Paste the verbatim diagnostic quote into \`evidenceSpan\`.
- \`SUSPECTED_PENDING\` — clinical concern is documented but
  diagnostics are pending or the surgical option is being
  deliberated. Quote the deliberation language into
  \`evidenceSpan\` (e.g. "MRI pending", "will discuss amputation
  with family").
- \`NONE\` — no documentation supporting the threat.

Surgical-decision status:
- \`DECIDED_AND_SCHEDULED\` — patient consented, NPO ordered, OR
  booked, or surgery scheduled. Quote into
  \`decisionEvidenceSpan\`.
- \`DELIBERATING\` — note explicitly says the decision is open
  ("will reassess after MRI", "pending family meeting").
- \`NOT_APPLICABLE\` — surgical management is not on the table.

The practice convention block defines how this assessment caps
\`mdm.problems\` and \`mdm.risk\` (e.g. "HIGH only when CONFIRMED, or
SUSPECTED_PENDING + DECIDED_AND_SCHEDULED within ~48h"). Follow the
practice block for the exact cap rule — it overrides any default
from this specialty delta when the two disagree.
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
