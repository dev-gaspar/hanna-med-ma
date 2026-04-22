/**
 * Compare the two most recent codings for the same encounter — useful
 * for measuring the impact of a prompt change on a fixed input.
 *
 *   npx ts-node -r dotenv/config -T src/coverage/scripts/compare-last-two-codings.ts
 */
import { PrismaClient } from "@prisma/client";

interface Proposal {
  primaryCpt: string;
  cptProposals: Array<{ code: string; modifiers: string[]; units: number }>;
  icd10Proposals: Array<{ code: string; rationale: string }>;
  documentationGaps: Array<{ forCode: string; missingElement: string }>;
  providerQuestions: string[];
  auditRiskNotes: string[];
  auditRiskScore: number;
  riskBand: string;
  riskBreakdown: Array<{ dimension: string; verdict: string }>;
}

async function main() {
  const prisma = new PrismaClient();
  const rows = await prisma.encounterCoding.findMany({
    orderBy: { createdAt: "desc" },
    take: 2,
    select: {
      id: true,
      encounterId: true,
      status: true,
      primaryCpt: true,
      auditRiskScore: true,
      riskBand: true,
      runDurationMs: true,
      toolCallCount: true,
      proposal: true,
      createdAt: true,
    },
  });

  if (rows.length < 2) {
    console.log("Need at least 2 coding rows.");
    await prisma.$disconnect();
    return;
  }

  const [newer, older] = rows;
  const n = newer.proposal as unknown as Proposal;
  const o = older.proposal as unknown as Proposal;

  console.log(
    `\n=== Comparing coding #${newer.id} (new) vs #${older.id} (old) ===`,
  );
  console.log(`both encounter ${newer.encounterId}`);
  console.log(`\nSTATS`);
  console.log(
    `  duration:  new=${(newer.runDurationMs! / 1000).toFixed(1)}s  old=${(older.runDurationMs! / 1000).toFixed(1)}s`,
  );
  console.log(
    `  tools:     new=${newer.toolCallCount}  old=${older.toolCallCount}`,
  );
  console.log(
    `  risk:      new=${newer.auditRiskScore} (${newer.riskBand})  old=${older.auditRiskScore} (${older.riskBand})`,
  );

  const cptOld = new Set(o.cptProposals.map((c) => c.code));
  const cptNew = new Set(n.cptProposals.map((c) => c.code));
  console.log(`\nCPT`);
  console.log(`  old: ${[...cptOld].join(", ")}`);
  console.log(`  new: ${[...cptNew].join(", ")}`);

  const icdOld = o.icd10Proposals.map((i) => i.code);
  const icdNew = n.icd10Proposals.map((i) => i.code);
  const oldSet = new Set(icdOld);
  const newSet = new Set(icdNew);
  const added = icdNew.filter((c) => !oldSet.has(c));
  const removed = icdOld.filter((c) => !newSet.has(c));
  const kept = icdNew.filter((c) => oldSet.has(c));

  console.log(`\nICD-10  (old=${icdOld.length}, new=${icdNew.length})`);
  console.log(`  old (in order): ${icdOld.join(", ")}`);
  console.log(`  new (in order): ${icdNew.join(", ")}`);
  console.log(`  + added:  ${added.length ? added.join(", ") : "(none)"}`);
  console.log(`  - removed: ${removed.length ? removed.join(", ") : "(none)"}`);
  console.log(`  = kept:   ${kept.join(", ")}`);

  console.log(
    `\nDOCUMENTATION GAPS  (old=${o.documentationGaps.length}, new=${n.documentationGaps.length})`,
  );
  for (const g of n.documentationGaps) {
    console.log(`  • [${g.forCode}] ${g.missingElement}`);
  }

  console.log(
    `\nPROVIDER QUESTIONS  (old=${o.providerQuestions.length}, new=${n.providerQuestions.length})`,
  );
  for (const q of n.providerQuestions) {
    console.log(`  • ${q.slice(0, 140)}${q.length > 140 ? "…" : ""}`);
  }

  console.log(
    `\nAUDIT RISK NOTES  (old=${o.auditRiskNotes.length}, new=${n.auditRiskNotes.length})`,
  );
  for (const r of n.auditRiskNotes) {
    console.log(`  • ${r.slice(0, 140)}${r.length > 140 ? "…" : ""}`);
  }

  console.log(`\nRISK BREAKDOWN (new)`);
  for (const b of n.riskBreakdown) {
    console.log(`  ${b.dimension.padEnd(32)} → ${b.verdict}`);
  }

  console.log();
  for (const icd of n.icd10Proposals) {
    const prev = oldSet.has(icd.code) ? "=" : "+";
    console.log(
      `${prev} ${icd.code.padEnd(10)} — ${icd.rationale.replace(/\s+/g, " ").slice(0, 120)}`,
    );
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
