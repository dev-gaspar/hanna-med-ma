/**
 * One-shot script: reset the Cuevas Serrano test encounter so the billing
 * note-search flow can be retested from scratch.
 *
 * - Finds the patient by normalizedName containing "cuevas"
 * - Clears providerNote (and any stale faceSheet) on all their encounters
 * - Re-populates faceSheet from the latest INSURANCE raw data, if any
 * - Refreshes deadline to now+24h so the flow treats them as pending
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const patient = await prisma.patient.findFirst({
    where: { normalizedName: { contains: "cuevas", mode: "insensitive" } },
  });

  if (!patient) {
    console.log("Cuevas Serrano patient not found.");
    return;
  }

  const insurance = await prisma.patientRawData.findFirst({
    where: { patientId: patient.id, dataType: "INSURANCE" },
    orderBy: { extractedAt: "desc" },
    select: { file: true },
  });

  const encounters = await prisma.encounter.findMany({
    where: { patientId: patient.id },
    orderBy: { createdAt: "desc" },
  });

  console.log(`Patient ${patient.id} (${patient.name}) has ${encounters.length} encounter(s).`);
  console.log(`Latest insurance file key: ${insurance?.file ?? "(none)"}`);

  const deadline = new Date(Date.now() + 24 * 60 * 60 * 1000);

  for (const enc of encounters) {
    const updated = await prisma.encounter.update({
      where: { id: enc.id },
      data: {
        providerNote: null,
        faceSheet: insurance?.file ?? null,
        deadline,
        noteStatus: "PENDING",
        noteAttempts: 0,
        noteLastAttemptAt: null,
        noteAgentSummary: null,
      },
    });
    console.log(
      `  encounter ${enc.id}: ` +
        `noteStatus=${updated.noteStatus}, ` +
        `noteAttempts=${updated.noteAttempts}, ` +
        `providerNote=null, ` +
        `faceSheet=${updated.faceSheet ?? "null"}, ` +
        `deadline=${updated.deadline?.toISOString()}`,
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
