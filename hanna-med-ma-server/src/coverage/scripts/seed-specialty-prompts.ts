/**
 * Seed initial Specialty rows (catalog + prompt delta). One row per
 * specialty the CoderAgent should know about. Each delta is appended
 * after the base system prompt so specialty-specific knowledge grows
 * without polluting the shared text.
 *
 *   npx ts-node -r dotenv/config src/coverage/scripts/seed-specialty-prompts.ts
 */

import { PrismaClient } from "@prisma/client";

interface SpecialtySeed {
  name: string;
  systemPrompt: string;
  /** POS codes (matching `place_of_service_codes.code`) shown as
   *  quick-pick buttons in the doctor's "Mark as seen" modal.
   *  Order matters — first entry renders top-left. Each code MUST
   *  exist in the catalog or the seed throws. */
  commonPosCodes: string[];
  /** Pre-selected POS when the modal opens. Null → no pre-fill,
   *  doctor picks explicitly. Must be one of `commonPosCodes` or
   *  null. */
  defaultPosCode: string | null;
}

const SEEDS: SpecialtySeed[] = [
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
    // Podiatry visit settings (in order of frequency for the
    // Hanna-Med Inpatient consult workflow):
    //   21 — Inpatient hospital consults (the bulk of work)
    //   22 — On-campus outpatient hospital procedures
    //   11 — Office / clinic visits
    //   23 — ER consults for diabetic foot crisis
    //   24 — ASC for elective forefoot/midfoot surgery
    //   31 — SNF wound care follow-ups
    //   12 — Home wound care (housebound DM patients)
    commonPosCodes: ["21", "22", "11", "23", "24", "31", "12"],
    defaultPosCode: "21",
  },
  {
    name: "Vascular",
    systemPrompt: `Specialty delta — VASCULAR

Exam scope: limit physical exam analysis to the Cardiovascular,
Vascular, Neurological, and Skin systems. Document pulses by
location and grade (0-3+), capillary refill time, and any
sensory/motor deficits relevant to limb perfusion.

# Diagnoses

Code preferences the note often justifies (confirm against
search_icd10_codes before emitting):

- Peripheral artery disease (PAD): I70.21x (claudication only),
  I70.22x (rest pain), I70.23x (ulceration), I70.24x (ulceration
  + stage), I70.25x (gangrene without ulceration), I70.26x
  (gangrene with ulceration). Pick by the LIMB AXIS (right/left/
  bilateral) and severity AXIS the note documents.
- Critical limb ischemia (CLI): use the I70.26x family + a
  pain/ulcer/gangrene combination ICD. CLI is a clinical concept,
  not a single code.
- DVT: I82.4xx for proximal acute (popliteal/femoral/iliac); use
  laterality and acute/chronic axis. I82.5xx for distal/calf vein.
- Pulmonary embolism: I26.x — distinguish acute (I26.99) vs
  acute on chronic (I27.x).
- Aortic aneurysm: I71.x — pick by anatomic site (thoracic,
  abdominal, thoracoabdominal) and rupture status.
- Carotid stenosis: I65.2x (occlusion / stenosis of carotid
  artery) — without infarction code if no stroke; with infarction
  code if a CVA accompanies.
- Diabetic vascular complications: E11.51 (DM with PAD), E11.52
  (DM with PAD with gangrene), E11.59 (DM with other circulatory
  complications) — pair with the I70.x specifying side / severity.
- Venous insufficiency: I87.2 (unspecified), I83.x (varicose
  veins of LE — use ulcer/inflammation/symptom axis).

# Procedures

CPT selection rules anchored to the operative or interventional
description:

- Diagnostic angiography:
  * **75716** Bilateral lower-extremity angiography
  * **75710** Unilateral lower-extremity angiography
  * **36245-36248** Selective catheter placement, arterial,
    by branch order. The branch order drives the code.
- Endovascular interventions:
  * **37220-37223** Iliac artery angioplasty / stent (with or
    without atherectomy) — driven by site + intervention type.
  * **37224-37227** Femoral / popliteal artery angioplasty /
    stent / atherectomy. Pair the right anatomic-axis code to
    what the operative description treats.
  * **37228-37235** Tibial / peroneal interventions, same axis.
- Open vascular surgery:
  * **35226** Repair, blood vessel, lower extremity (graft).
  * **35371-35372** Thromboendarterectomy, by site.
  * **35556** Bypass graft, vein, femoral-popliteal.
- Venous procedures:
  * **36475-36476** Endovenous radiofrequency / laser ablation,
    incompetent vein, lower extremity.
  * **37241-37244** Vascular embolization / occlusion, by
    therapy intent.
- Vascular access:
  * **36901-36909** Dialysis access maintenance / interventions.

When a diagnostic study and an intervention happen in the same
session, both are billable; document the conversion explicitly so
modifier 59 / X-modifiers are defensible.

# E/M

Inpatient E/M family selection follows the universal rule (CONSULT
→ 99221-99223, PROGRESS → 99231-99233) modified by the
payer-aware rule resolved through lookup_payer_rule. Vascular
adds no specialty-specific overrides on E/M family.

When the encounter is an interventional encounter (encounterType =
PROCEDURE), no E/M is billed and the procedural CPT is primary; do
NOT shoehorn a 99231-99233 onto a procedure visit.

# Hard rules

- Always call search_lcd_chunks with a vascular-specific phrase
  to surface the LCD coverage criteria for endovenous ablation,
  endovascular intervention, and supervised exercise therapy.
- For PAD interventions, the medical-necessity anchor is
  documented severity (rest pain, non-healing ulcer, lifestyle-
  limiting claudication) — pull the verbatim language into
  \`lcdCitations.relevantExcerpt\` when the LCD requires it.
- Trauma diagnoses use the correct 7th-character episode-of-care
  (A initial, D subsequent, S sequela).

# Limb-threat assessment — REQUIRED for Vascular encounters

Vascular shares Podiatry's exposure to diabetic foot, PAD, gangrene,
and ischemic limb pathology. On every Vascular E/M encounter you
MUST fill the \`limbThreatAssessment\` block before calling
\`finalize_coding\`, with the same semantics as the Podiatry block:

- \`applicable\` = true when the chief complaint involves limb-
  threatening pathology (CLI, gangrene, severe PAD with rest pain
  or non-healing ulcer, acute limb ischemia, ischemic compartment
  syndrome).
- \`evidenceLevel\` = CONFIRMED / SUSPECTED_PENDING / NONE per
  the documentation (imaging confirmed vs pending, etc.).
- \`surgicalDecisionStatus\` = DECIDED_AND_SCHEDULED /
  DELIBERATING / NOT_APPLICABLE based on whether revasc / amputation
  is scheduled vs being deliberated vs not on the table.
- For non-limb-threatening encounters (varicose veins follow-up,
  carotid screening, post-stent clinic visit, stable AAA
  surveillance), set \`applicable\` = false with the standard
  empty-block fields.

The practice convention block defines how this assessment caps
\`mdm.problems\` and \`mdm.risk\` — same cap rule as Podiatry.
`,
    // Vascular visit settings:
    //   21 — Inpatient consults (CLI, acute limb ischemia, DVT/PE)
    //   22 — On-campus outpatient hospital (pre-op, post-op clinic)
    //   11 — Office / clinic (claudication follow-ups, varicose vein)
    //   24 — ASC / cath lab (endovenous ablation, peripheral
    //        intervention if not done in hospital cath lab)
    //   19 — Off-campus outpatient hospital (vascular labs,
    //        non-invasive studies, often off the main hospital
    //        campus for Hanna-Med Vascular)
    //   23 — ER (acute limb ischemia, ruptured aneurysm)
    commonPosCodes: ["21", "22", "11", "24", "19", "23"],
    defaultPosCode: "21",
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
    // Internal Medicine spans both office primary-care and inpatient
    // hospitalist work. The Hanna-Med scope is hospitalist
    // consultation, so 21 leads, but office and outpatient hospital
    // remain plausible for general IM rotations.
    commonPosCodes: ["21", "22", "11", "19", "23", "12", "13"],
    defaultPosCode: "21",
  },
];

async function main() {
  const prisma = new PrismaClient();
  try {
    // Validate every commonPosCodes / defaultPosCode reference against
    // the place_of_service_codes catalog before writing anything. A
    // typo'd code in the seed must surface here, not later as a UI
    // bug ("button references missing POS row").
    const catalog = await prisma.placeOfServiceCode.findMany({
      select: { code: true, active: true },
    });
    if (catalog.length === 0) {
      throw new Error(
        "place_of_service_codes table is empty — run load-place-of-service-codes.ts first.",
      );
    }
    const activeCodes = new Set(
      catalog.filter((c) => c.active).map((c) => c.code),
    );
    for (const s of SEEDS) {
      for (const code of s.commonPosCodes) {
        if (!activeCodes.has(code)) {
          throw new Error(
            `Specialty "${s.name}" references POS code "${code}" which is not in the active catalog. Either add it to load-place-of-service-codes.ts or fix the seed.`,
          );
        }
      }
      if (s.defaultPosCode !== null) {
        if (!activeCodes.has(s.defaultPosCode)) {
          throw new Error(
            `Specialty "${s.name}" defaultPosCode="${s.defaultPosCode}" is not in the active catalog.`,
          );
        }
        if (!s.commonPosCodes.includes(s.defaultPosCode)) {
          throw new Error(
            `Specialty "${s.name}" defaultPosCode="${s.defaultPosCode}" must also appear in commonPosCodes.`,
          );
        }
      }
    }

    for (const s of SEEDS) {
      await prisma.specialty.upsert({
        where: { name: s.name },
        create: {
          name: s.name,
          systemPrompt: s.systemPrompt,
          commonPosCodes: s.commonPosCodes,
          defaultPosCode: s.defaultPosCode,
        },
        update: {
          systemPrompt: s.systemPrompt,
          commonPosCodes: s.commonPosCodes,
          defaultPosCode: s.defaultPosCode,
        },
      });
      console.log(
        `✓ ${s.name} (${s.systemPrompt.length} chars, POS: [${s.commonPosCodes.join(", ")}], default=${s.defaultPosCode ?? "—"})`,
      );
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
