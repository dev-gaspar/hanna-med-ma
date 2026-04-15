/**
 * Fast-path test: schedule a billing:note-search task with a short delay
 * (default 10s) so we exercise the Redis scheduler thread without waiting
 * the real 4h production delay.
 *
 * Usage:
 *   npx ts-node scripts/schedule_note_fast.ts            # defaults: 10s, attempt 1
 *   DELAY_SECONDS=30 ATTEMPT=1 npx ts-node ...           # override
 *   ATTEMPT=6 npx ts-node ...                            # simulate the final attempt
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";

const prisma = new PrismaClient();

(async () => {
  const encounterId = 28;
  const delaySeconds = Number(process.env.DELAY_SECONDS ?? 10);
  const attempt = Number(process.env.ATTEMPT ?? 1);
  const maxAttempts = Number(process.env.MAX_ATTEMPTS ?? 6);

  const enc = await prisma.encounter.findUnique({
    where: { id: encounterId },
    include: { patient: true, doctor: true },
  });
  if (!enc) throw new Error(`Encounter ${encounterId} not found`);

  const payload = {
    encounterId: enc.id,
    patientName: enc.patient.name,
    doctorId: enc.doctor.id,
    doctorName: enc.doctor.name,
    doctorSpecialty: enc.doctor.specialty ?? "Podiatry",
    encounterType: enc.type,
    dateOfService: "07/07/2024",
    emrSystem: enc.patient.emrSystem,
    attempt,
    maxAttempts,
  };

  const url = process.env.SERVER_REDIS_URL;
  if (!url) throw new Error("SERVER_REDIS_URL not set");
  const r = new Redis(url);

  const score = Math.floor(Date.now() / 1000) + Math.max(0, delaySeconds);
  const result = await r.zadd(
    "billing:note-search:scheduled",
    score,
    JSON.stringify(payload),
  );
  console.log(
    `Scheduled encounter ${encounterId} on billing:note-search:scheduled ` +
      `(delay=${delaySeconds}s, score=${score}, attempt=${attempt}/${maxAttempts}) ` +
      `→ result=${result}`,
  );
  console.log(`The RPA scheduler (30s poll) will flip it to the active queue shortly.`);

  await r.quit();
  await prisma.$disconnect();
})();
