import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";

const prisma = new PrismaClient();

(async () => {
  const url = process.env.SERVER_REDIS_URL;
  if (!url) throw new Error("SERVER_REDIS_URL not set");
  const r = new Redis(url);

  const before = await r.llen("billing:note-search");
  await r.del("billing:note-search");
  console.log(`Cleared billing:note-search (was ${before} items)`);

  const enc = await prisma.encounter.findUnique({
    where: { id: 28 },
    include: { patient: true, doctor: true },
  });
  if (!enc) throw new Error("Encounter 28 not found");

  const payload = {
    encounterId: enc.id,
    patientName: enc.patient.name,
    doctorId: enc.doctor.id,
    doctorName: enc.doctor.name,
    doctorSpecialty: enc.doctor.specialty || "Podiatry",
    encounterType: enc.type,
    dateOfService: "07/07/2024",
    emrSystem: enc.patient.emrSystem,
    attempt: 1,
    maxAttempts: 3,
  };

  const len = await r.lpush("billing:note-search", JSON.stringify(payload));
  console.log(`Pushed fresh task → queue length: ${len}`);

  await r.quit();
  await prisma.$disconnect();
})();
