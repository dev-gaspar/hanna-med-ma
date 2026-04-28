/**
 * Seed: create the "Hanna Med Podiatry & Vascular" practice, link the
 * 5 doctors to it, and populate the PayerEMRule table with Hajira's
 * full payer matrix from the 2026-04-27 calibration doc.
 *
 * Idempotent — re-running upserts the practice, links doctors that
 * aren't yet linked, and upserts payer rules by (payerName, practiceId,
 * ageMin) composite key.
 *
 *   npx ts-node -r dotenv/config src/coverage/scripts/seed-hanna-practice.ts
 */
import { PrismaClient, PayerEMCategory } from "@prisma/client";

const prisma = new PrismaClient();

const PRACTICE_NAME = "Hanna Med Podiatry & Vascular";

// Practice convention delta — these are workflow conventions specific to
// THIS practice that the AI Coder must apply on top of the base prompt
// and specialty delta. Source: Hajira calibration doc 2026-04-27.
const HANNA_PRACTICE_CONVENTION = `Practice convention delta — HANNA MED PODIATRY & VASCULAR

These workflow conventions are SPECIFIC to this practice (not universal CMS
rules, not specialty knowledge). They reflect how this practice's coder
(Hajira) and biller process claims for the payer mix this group sees.
Apply them on top of the universal rules and the specialty delta.

## ICD ranking — first 4 are load-bearing
The biller and most payers focus on the FIRST 4 ICD-10 codes for medical
necessity linkage to the primary CPT. Rank icd10Proposals by direct
relevance to the primary CPT: positions 1-4 are the load-bearing diagnoses
that justify the procedure or the E/M level. Positions 5+ are supporting
context (chronic comorbidities, status codes) that inform but don't drive
medical necessity. Quality of linkage matters far more than quantity —
target 4-8 ICDs total, all with clear ties to the primary CPT.

## Modifier -57 timing — strict ~48 hour window
Modifier -57 (decision for major surgery) applies in this practice ONLY
when the surgery is scheduled within approximately 48 hours of the
encounter. Signals: patient consented this visit, NPO ordered, surgery
scheduled the next day or within 48h. If surgery is scheduled 3+ days
later AND there are intermediate E/M visits before the surgery date, the
-57 attaches to the LAST E/M before the surgery, not to this earlier
consult. When in doubt, drop -57 and add an auditRiskNotes entry citing
the surgery scheduling lag.

## Principal-dx convention (overrides ICD-10-CM §II.G in some cases)
The ICD-10-CM Official Guidelines §II.G prescribe that for an admission to
treat a surgical complication, the complication code (e.g., T81.49XA
post-procedural infection) leads as the principal diagnosis. This
practice's convention is to lead with the most clinically specific
condition (e.g., L03.116 cellulitis of left lower limb, L97.523 chronic
ulcer with muscle necrosis) and place T-codes secondary, especially when
the post-op window is more than ~4 weeks from the original procedure. The
biller resolves §II.G compliance downstream when payers require it.
Default behavior: lead with most-specific clinical condition; add an
auditRiskNotes entry when §II.G is not followed so a human reviewer can
verify before submission.

## 76000 intraoperative fluoroscopy — billed when documented
NCCI Policy Manual Ch.1 §C bundles general fluoroscopy codes (76000) into
the surgical procedure for the operating surgeon. This practice's
convention bills 76000 separately when the operative note explicitly
documents intraoperative fluoroscopy used for visualization (e.g.,
"intraoperative fluoroscopy was utilized to visualize placement of the
guidewire"). When billing 76000 alongside an ORIF or fixation procedure,
add an auditRiskNotes entry noting the NCCI tension and the documentation
trigger that justifies separate billing.

## Obesity coding — specificity only when relevant to procedure
Default to E66.9 (obesity, unspecified) UNLESS BOTH:
  (1) the provider explicitly documents the obesity class (E66.811 / E66.812 /
      E66.813), AND
  (2) the obesity affects this encounter's procedure planning, risk, or
      medical necessity (e.g., pressure ulcer management, surgical
      positioning concerns, anesthesia risk).
If only (1) is true but obesity has no bearing on the procedure, code
E66.9 or omit the obesity code entirely. BMI Z68.x is paired only with
E66.81x (specific class), never with E66.9.

## MDM HIGH gate — operative urgency within 48 hours

For E/M encounters in specialties that fill the \`limbThreatAssessment\`
block (Podiatry today; Vascular when added), this assessment gates BOTH
\`mdm.problems\` AND \`mdm.risk\`. Hajira reserves HIGH for cases with
genuine operative urgency at the time of THIS encounter, not for cases
where the limb threat is "on the differential" but the surgical decision
is days away. If the active specialty does not engage with limb-threat
assessment (i.e., \`limbThreatAssessment\` is null/omitted), this rule
does not fire — score MDM by the universal CMS 2-of-3 rubric without
this cap.

Score \`mdm.problems = HIGH\` (and \`mdm.risk = HIGH\`) when AT LEAST ONE of:
  (a) limb threat is CONFIRMED (imaging-confirmed osteomyelitis,
      labs-confirmed deep infection, operatively-confirmed gangrene/
      necrosis, or documented severe PAD with rest pain or tissue loss) —
      regardless of surgical timing, OR
  (b) limb threat is SUSPECTED PENDING + surgical decision is
      DECIDED_AND_SCHEDULED within ~48 hours (NPO ordered today, consent
      documented today, surgery booked the next day, etc).

Score BOTH \`mdm.problems\` AND \`mdm.risk\` at MODERATE (never HIGH) when:
  - Limb threat is on the differential but surgicalDecisionStatus =
    DELIBERATING (e.g., "will discuss amputation with family", "pending
    MRI findings before deciding").
  - Surgery is scheduled but >48 hours out from this encounter — there
    will be intermediate E/M visits, and the operative-urgency belongs
    to the LAST one before the OR, not this earlier consult.
  - Antibiotics are being trialed before any operative decision.
  - The clinical picture sounds serious but THIS provider's role this
    visit is consultation/confirmation rather than operative planning.

This 48-hour window applies to BOTH MDM elements (Problems and Risk). The
universal CMS 2023 rubric allows HIGH risk for "decision regarding
hospitalization, DNR, or to de-escalate care" independently of surgery; in
this practice, when the encounter is fundamentally a podiatry consult on a
patient already admitted, those HIGH-risk drivers are owned by the
hospitalist — keep \`mdm.risk\` at MODERATE unless THIS provider is making
the operative decision today.

## Z-code linkage — quality over quantity, with explicit defaults

Insurance does NOT check a required number of ICD codes. They check medical
necessity linkage between ICD and CPT. Include a Z-code ONLY when removing
it would change a payer's understanding of why this service was justified.

DROP BY DEFAULT (omit unless THIS encounter's plan explicitly hinges on the
condition):
  - \`Z79.4\`    long-term insulin use
  - \`Z79.84\`   long-term oral hypoglycemic
  - \`Z79.1\`    long-term NSAID
  - \`Z79.2\`    long-term antibiotics (drop unless ID is co-managing AND
                 the antibiotic choice drives THIS encounter's plan)
  - \`Z79.899\`  other long-term drug therapy (case-dependent — default drop)
  - \`Z87.891\`  personal history of nicotine dependence
  - \`Z95.0\`    presence of pacemaker (drop unless cardiac status drives plan)
  - \`Z86.718\`  personal history of VTE — drop when the patient is on
                 active anticoagulation (use the active condition + Z79.01
                 instead).

KEEP WHEN APPLICABLE (the medical-necessity link is direct and documented):
  - \`Z79.01\`   long-term anticoagulants — KEEP when surgical decision is
                 made, a procedure is planned, or wound-care decisions
                 explicitly factor anticoagulation.
  - \`Z89.xxx\`  acquired absence (limb/digit) — KEEP when status affects
                 this encounter's procedure or post-op planning.
  - \`Z48.0x\`   encounter for wound-dressing change — KEEP when this IS
                 the primary purpose of the visit.
  - \`Z47.xx\`   surgical aftercare — KEEP for post-op follow-up encounters
                 within the global period.

When in doubt: ask "if the auditor cut this Z-code, would they still pay
the primary CPT at the same level?" If yes → omit. If no (the Z-code is
part of the necessity story) → keep.
`;

interface PayerRuleSeed {
  payerName: string;
  category: PayerEMCategory;
  ageMin?: number | null;
  ageMax?: number | null;
  notes?: string;
  payerPattern?: string;
}

// Hajira's payer matrix from 2026-04-27 calibration doc + WhatsApp follow-ups.
const HANNA_PAYER_RULES: PayerRuleSeed[] = [
  // ─── ALWAYS_CONSULT (consult codes 99253-99255 family) ────────────
  { payerName: "Oscar Health", category: "ALWAYS_CONSULT", notes: "Hajira doc G.3 — explicit C" },
  { payerName: "Self Pay", category: "ALWAYS_CONSULT", ageMax: 64, notes: "Patients under 65 coded as commercial insurance per Hajira" },
  { payerName: "Charity Pending", category: "ALWAYS_CONSULT", notes: "Hajira doc G.3 — explicit C" },
  // Other commercial networks Hajira listed in #31 answer:
  { payerName: "Kaiser Permanente", category: "ALWAYS_CONSULT", notes: "Out-of-network hospital billing per Hajira" },
  { payerName: "Multiplan", category: "ALWAYS_CONSULT", notes: "PHCS/Multiplan network payers per Hajira" },
  { payerName: "PHCS", category: "ALWAYS_CONSULT", notes: "Multiplan network per Hajira" },
  { payerName: "Health Net", category: "ALWAYS_CONSULT", notes: "Commercial lines only per Hajira" },
  { payerName: "Ambetter", category: "ALWAYS_CONSULT", notes: "Centene commercial subsidiary per Hajira" },
  { payerName: "Molina Healthcare", category: "ALWAYS_CONSULT", notes: "Commercial plans (NOT Marketplace) per Hajira", payerPattern: "(?i)^molina(?!.*marketplace)" },

  // ─── ALWAYS_INITIAL_HOSPITAL (99221-99223 family) ─────────────────
  { payerName: "Self Pay", category: "ALWAYS_INITIAL_HOSPITAL", ageMin: 65, notes: "Patients ≥65 coded as Medicare equivalent per Hajira" },
  { payerName: "Medicare", category: "ALWAYS_INITIAL_HOSPITAL", notes: "Straight Medicare A+B; consult codes deleted in 2010", payerPattern: "(?i)medicare(?!.*advantage)" },
  // Major Medicare Advantage carriers (per Hajira's note: all follow Medicare inpatient E/M rules)
  { payerName: "UHC Medicare Advantage", category: "ALWAYS_INITIAL_HOSPITAL", notes: "MA follows Medicare inpatient rules per Hajira", payerPattern: "(?i)united.*medicare.*advantage|uhc.*ma" },
  { payerName: "Humana Medicare Advantage", category: "ALWAYS_INITIAL_HOSPITAL", notes: "MA per Hajira", payerPattern: "(?i)humana(?!.*commercial)" },
  { payerName: "Aetna Medicare Advantage", category: "ALWAYS_INITIAL_HOSPITAL", notes: "MA per Hajira", payerPattern: "(?i)aetna.*medicare" },
  { payerName: "Cigna Medicare Advantage", category: "ALWAYS_INITIAL_HOSPITAL", notes: "MA per Hajira", payerPattern: "(?i)cigna.*medicare" },
  { payerName: "BCBS Medicare Advantage", category: "ALWAYS_INITIAL_HOSPITAL", notes: "MA per Hajira", payerPattern: "(?i)bcbs.*medicare|blue.*medicare.*advantage" },
  // Specific MA HMO products in this practice's payer mix:
  { payerName: "Humana ConvivaMC HMO", category: "ALWAYS_INITIAL_HOSPITAL", notes: "Per Hajira; matches Purdy face sheet" },
  { payerName: "PrefCare", category: "ALWAYS_INITIAL_HOSPITAL", notes: "Medicare HMO per Hajira" },
  { payerName: "Health Sun", category: "ALWAYS_INITIAL_HOSPITAL", notes: "Medicare HMO per Hajira; matches Corzo face sheet" },
  { payerName: "Careplus", category: "ALWAYS_INITIAL_HOSPITAL", notes: "Medicare HMO per Hajira" },
  // BCBS commercial / Marketplace
  { payerName: "BCBS PPO", category: "ALWAYS_INITIAL_HOSPITAL", notes: "Anthem dropped consult codes 2021 per Hajira", payerPattern: "(?i)bcbs.*ppo|bcbs.*ppc|blue.*cross.*ppo" },
  { payerName: "BCBS HDHP", category: "ALWAYS_INITIAL_HOSPITAL", notes: "Per Hajira", payerPattern: "(?i)bcbs.*hdhp" },
  { payerName: "BCBS MyBlue", category: "ALWAYS_INITIAL_HOSPITAL", notes: "Marketplace per Hajira" },
  { payerName: "BCBS BlueSelect", category: "ALWAYS_INITIAL_HOSPITAL", notes: "Marketplace per Hajira" },
  // Marketplace plans
  { payerName: "Molina Marketplace", category: "ALWAYS_INITIAL_HOSPITAL", notes: "Marketplace per Hajira", payerPattern: "(?i)molina.*marketplace|molina.*ex" },
  // Medicaid HMO
  { payerName: "United MD HMO", category: "ALWAYS_INITIAL_HOSPITAL", notes: "Medicaid HMO per Hajira" },
  { payerName: "Sunshine MMA", category: "ALWAYS_INITIAL_HOSPITAL", notes: "Medicaid HMO per Hajira" },
  // Other commercials that dropped consults
  { payerName: "UnitedHealthcare", category: "ALWAYS_INITIAL_HOSPITAL", notes: "UHC dropped consults 2019 per Hajira (commercial)", payerPattern: "(?i)unitedhealthcare(?!.*advantage)|uhc(?!.*ma)|nhp.*uhc" },
  { payerName: "Cigna", category: "ALWAYS_INITIAL_HOSPITAL", notes: "Cigna dropped consults 2019 per Hajira (commercial)", payerPattern: "(?i)^cigna(?!.*medicare)" },
  { payerName: "Aetna", category: "ALWAYS_INITIAL_HOSPITAL", notes: "Aetna dropped consults 2022 per Hajira (commercial)", payerPattern: "(?i)^aetna(?!.*medicare)" },

  // ─── DEPENDS_HUMAN_REVIEW ─────────────────────────────────────────
  { payerName: "Avmed", category: "DEPENDS_HUMAN_REVIEW", notes: "Hajira marked '?' depends — verify by plan" },
  { payerName: "Workers Comp", category: "DEPENDS_HUMAN_REVIEW", notes: "Hajira marked '?' depends — verify by carrier", payerPattern: "(?i)workers?.*comp" },
  { payerName: "Self Pay", category: "DEPENDS_HUMAN_REVIEW", notes: "Self Pay without age info — flag for human review" },
];

async function main() {
  console.log(`\n[1] Upserting practice "${PRACTICE_NAME}"...`);
  const practice = await prisma.practice.upsert({
    where: { name: PRACTICE_NAME },
    update: { systemPrompt: HANNA_PRACTICE_CONVENTION },
    create: { name: PRACTICE_NAME, systemPrompt: HANNA_PRACTICE_CONVENTION },
  });
  console.log(`   id=${practice.id}  systemPrompt=${practice.systemPrompt.length} chars`);

  console.log(`\n[2] Linking the 5 practice doctors to practice id=${practice.id}...`);
  const doctorNames = [
    "Peter Hanna",
    "Siavash Rostami",
    "Daniel Ginsberg",
    "Paul Hanna",
    "Austin Price",
  ];
  let linked = 0;
  let alreadyLinked = 0;
  for (const name of doctorNames) {
    const doctor = await prisma.doctor.findFirst({ where: { name } });
    if (!doctor) {
      console.log(`   ⚠️  ${name} not found — skip`);
      continue;
    }
    if (doctor.practiceId === practice.id) {
      alreadyLinked++;
      console.log(`   ${name} — already linked`);
      continue;
    }
    await prisma.doctor.update({
      where: { id: doctor.id },
      data: { practiceId: practice.id },
    });
    linked++;
    console.log(`   ${name} (id=${doctor.id}) linked`);
  }
  console.log(`   ${linked} newly linked, ${alreadyLinked} already linked`);

  console.log(`\n[3] Seeding ${HANNA_PAYER_RULES.length} PayerEMRule rows for practice ${practice.id}...`);
  // Prisma can't use composite unique keys for upsert when any column is
  // nullable (PostgreSQL treats NULLs as distinct in unique constraints).
  // Use findFirst + create/update instead.
  let rulesCreated = 0;
  let rulesUpdated = 0;
  for (const rule of HANNA_PAYER_RULES) {
    // Include ageMax in the dedupe predicate — without it, two rows that
    // share (payerName, practiceId, ageMin=null) but differ only in
    // ageMax (e.g. Self Pay <65 with ageMax=64 vs Self Pay catch-all
    // with ageMax=null) collapse into one row, and only the LAST one
    // wins. That's how the original 33-row seed produced 32 stored
    // rows and why Self-Pay-<65 → ALWAYS_CONSULT was missing.
    const existing = await prisma.payerEMRule.findFirst({
      where: {
        payerName: rule.payerName,
        practiceId: practice.id,
        ageMin: rule.ageMin ?? null,
        ageMax: rule.ageMax ?? null,
      },
    });
    if (existing) {
      await prisma.payerEMRule.update({
        where: { id: existing.id },
        data: {
          category: rule.category,
          ageMax: rule.ageMax ?? null,
          notes: rule.notes ?? null,
          payerPattern: rule.payerPattern ?? null,
          source: "Hajira 2026-04-27 calibration doc",
        },
      });
      rulesUpdated++;
    } else {
      await prisma.payerEMRule.create({
        data: {
          payerName: rule.payerName,
          payerPattern: rule.payerPattern ?? null,
          category: rule.category,
          ageMin: rule.ageMin ?? null,
          ageMax: rule.ageMax ?? null,
          practiceId: practice.id,
          notes: rule.notes ?? null,
          source: "Hajira 2026-04-27 calibration doc",
        },
      });
      rulesCreated++;
    }
  }
  console.log(`   ${rulesCreated} created, ${rulesUpdated} updated`);

  // ─── Global catch-all row ────────────────────────────────────────
  // One global rule (practiceId=null) for any unrecognised payer. The
  // resolver also returns a synthetic FALLBACK_DEPENDS verdict when no
  // row matches, so behaviour is identical with or without this row —
  // but having an explicit row gives the audit trail a single source
  // ("matched ruleId X") instead of "matched no row, fell back".
  console.log(`\n[4] Ensuring global catch-all row exists (practiceId=null)...`);
  const existingGlobal = await prisma.payerEMRule.findFirst({
    where: {
      payerName: "*",
      practiceId: null,
      ageMin: null,
      ageMax: null,
    },
  });
  if (existingGlobal) {
    await prisma.payerEMRule.update({
      where: { id: existingGlobal.id },
      data: {
        category: "DEPENDS_HUMAN_REVIEW",
        payerPattern: ".*",
        notes:
          "Global catch-all — no explicit rule for this payer. Defer to human review and default to ALWAYS_INITIAL_HOSPITAL family.",
        source: "Sprint 1 catch-all 2026-04-27",
      },
    });
    console.log(`   id=${existingGlobal.id} updated`);
  } else {
    const created = await prisma.payerEMRule.create({
      data: {
        payerName: "*",
        payerPattern: ".*",
        category: "DEPENDS_HUMAN_REVIEW",
        ageMin: null,
        ageMax: null,
        practiceId: null,
        notes:
          "Global catch-all — no explicit rule for this payer. Defer to human review and default to ALWAYS_INITIAL_HOSPITAL family.",
        source: "Sprint 1 catch-all 2026-04-27",
      },
    });
    console.log(`   created id=${created.id}`);
  }

  // Sanity print
  console.log("\n=== Final state ===");
  const summary = await prisma.payerEMRule.groupBy({
    by: ["category"],
    where: { practiceId: practice.id },
    _count: { _all: true },
  });
  for (const s of summary) {
    console.log(`   ${s.category}: ${s._count._all} rules`);
  }
  const doctorCount = await prisma.doctor.count({ where: { practiceId: practice.id } });
  console.log(`   Doctors linked to practice: ${doctorCount}`);

  await prisma.$disconnect();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
