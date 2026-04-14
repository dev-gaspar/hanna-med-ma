/**
 * One-shot: push a billing note-search task to Redis for encounter 28.
 * Resolves doctorId/patientName from the encounter so the payload matches DB reality.
 */

import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";

const prisma = new PrismaClient();

async function main() {
  const encounterId = 28;

  const encounter = await prisma.encounter.findUnique({
    where: { id: encounterId },
    include: {
      patient: true,
      doctor: true,
    },
  });

  if (!encounter) throw new Error(`Encounter ${encounterId} not found`);

  const payload = {
    encounterId: encounter.id,
    patientName: encounter.patient.name,
    doctorId: encounter.doctor.id,
    doctorName: encounter.doctor.name,
    doctorSpecialty: encounter.doctor.specialty || "Podiatry",
    encounterType: encounter.type,
    dateOfService: "07/07/2024",
    emrSystem: encounter.patient.emrSystem,
    attempt: 1,
    maxAttempts: 3,
  };

  console.log("Payload:", JSON.stringify(payload, null, 2));

  const redisUrl = process.env.SERVER_REDIS_URL;
  if (!redisUrl) throw new Error("SERVER_REDIS_URL not set");

  const redis = new Redis(redisUrl);
  const len = await redis.lpush("billing:note-search", JSON.stringify(payload));
  console.log(`Pushed to billing:note-search → queue length: ${len}`);
  await redis.quit();
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
