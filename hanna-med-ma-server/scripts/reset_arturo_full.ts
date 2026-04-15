/**
 * Full reset of Arturo Nicolas Bayona for a clean end-to-end test from the
 * app's "Seen" button. Same contract as reset_carlos_full.ts:
 *   - patient.billingEmrStatus → PENDING
 *   - patient.billingEmrPatientId → null
 *   - deletes all existing encounters
 *   - clears any leftover billing:note-search tasks from Redis
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";

const prisma = new PrismaClient();

(async () => {
  const patient = await prisma.patient.findFirst({
    where: { normalizedName: { contains: "bayona", mode: "insensitive" } },
  });
  if (!patient) {
    console.log("Bayona patient not found.");
    return;
  }

  console.log(`Patient ${patient.id} (${patient.name})`);
  console.log(
    `  before: billingEmrStatus=${patient.billingEmrStatus}, billingEmrPatientId=${patient.billingEmrPatientId ?? "null"}`,
  );

  const encounters = await prisma.encounter.findMany({
    where: { patientId: patient.id },
    select: { id: true },
  });
  if (encounters.length > 0) {
    const ids = encounters.map((e) => e.id);
    await prisma.encounter.deleteMany({ where: { id: { in: ids } } });
    console.log(`  deleted ${ids.length} encounter(s): ${ids.join(", ")}`);
  } else {
    console.log("  no encounters to delete.");
  }

  const updated = await prisma.patient.update({
    where: { id: patient.id },
    data: {
      billingEmrStatus: "PENDING",
      billingEmrPatientId: null,
    },
  });
  console.log(
    `  after: billingEmrStatus=${updated.billingEmrStatus}, billingEmrPatientId=${updated.billingEmrPatientId ?? "null"}`,
  );

  const url = process.env.SERVER_REDIS_URL;
  if (url) {
    const r = new Redis(url);
    const activeDeleted = await r.del("billing:note-search");
    const scheduledDeleted = await r.del("billing:note-search:scheduled");
    const ctDeleted = await r.del("caretracker:tasks");
    console.log(
      `Redis cleared — active=${activeDeleted}, scheduled=${scheduledDeleted}, caretracker=${ctDeleted}`,
    );
    await r.quit();
  }

  console.log("\nReady. Now mark Arturo as Seen from the app.");
})()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
