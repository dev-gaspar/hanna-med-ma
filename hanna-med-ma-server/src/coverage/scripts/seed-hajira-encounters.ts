/**
 * Seed script — pre-load the 49 Hajira-coded Baptist encounters into the
 * database WITHOUT running the AI Coder. After this runs, each doctor
 * (Peter Hanna, Siavash Rostami, Daniel Ginsberg) sees their encounters
 * in the Coder Inbox and can click "Run Coder" from the UI when they want.
 *
 *   npx ts-node -r dotenv/config src/coverage/scripts/seed-hajira-encounters.ts
 *
 * What it does:
 *
 *   1. Ensures the two specialties exist (Podiatry + Vascular).
 *   2. Ensures the 5 practice doctors exist:
 *      - Podiatry: Peter Hanna, Siavash Rostami, Daniel Ginsberg
 *      - Vascular: Paul Hanna, Austin Price (no test encounters, just roster)
 *      Password = username (bcrypt). Idempotent on `username`.
 *   3. For each of the 51 manifest entries (49 unique encounters + 2 _alt):
 *      a. Resolves the patient using the SAME upsert key as
 *         PatientSyncService — composite [emrSystem, normalizedName].
 *         Fixes the CSV's `"Last,First"` (no space after comma) by
 *         inserting a space so it matches the DB convention.
 *      b. Creates a DoctorPatient link with `isActive = false` so the
 *         test patient does NOT pollute the rounds dashboard. Existing
 *         links are NOT modified (we don't activate inactive patients).
 *      c. Uploads the local note + face-sheet PDFs to S3.
 *      d. Creates the Encounter with `noteStatus = FOUND_SIGNED` so it
 *         shows up in the Coder Inbox (which filters by noteStatus, not
 *         by DoctorPatient.isActive).
 *      e. Skips EncounterCoding — that's generated when the doctor
 *         clicks "Run Coder".
 *
 * Idempotent: re-running the script reuses existing patients / doctors /
 * doctor-patient links and skips encounters whose
 * (patientId, doctorId, dateOfService) already exist with the
 * `noteAgentSummary` marker we use for seeded rows.
 */
import * as fs from "fs";
import * as path from "path";
import * as bcrypt from "bcrypt";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../../app.module";
import { PrismaService } from "../../core/prisma.service";
import { S3Service } from "../../core/s3.service";
import { normalizeName } from "../../core/patient-name.util";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const MANIFEST_PATH = path.join(
  REPO_ROOT,
  "test-data",
  "hajira-pdfs",
  "manifest.json",
);
const PDFS_DIR = path.join(REPO_ROOT, "test-data", "hajira-pdfs");

const SEED_NOTE_MARKER =
  "Pre-loaded from Hajira's testing dataset (2026-04-22). Not a live RPA extract.";

// ── Doctor roster ──────────────────────────────────────────────────
type DoctorSpec = {
  name: string;
  username: string;
  specialtyName: "Podiatry" | "Vascular";
};
const DOCTORS: DoctorSpec[] = [
  // Podiatry
  { name: "Peter Hanna", username: "peterhanna", specialtyName: "Podiatry" },
  {
    name: "Siavash Rostami",
    username: "siavashrostami",
    specialtyName: "Podiatry",
  },
  {
    name: "Daniel Ginsberg",
    username: "danielginsberg",
    specialtyName: "Podiatry",
  },
  // Vascular (roster only — no test encounters)
  { name: "Paul Hanna", username: "paulhanna", specialtyName: "Vascular" },
  { name: "Austin Price", username: "austinprice", specialtyName: "Vascular" },
];

// Map manifest doctor strings to canonical names so we can look up the
// row created above. Manifest uses "Dr Peter Hanna" etc.
const MANIFEST_DOCTOR_TO_NAME: Record<string, string> = {
  "Dr Peter Hanna": "Peter Hanna",
  "Dr Siavash Rostami": "Siavash Rostami",
  "Dr Daniel Ginsberg": "Daniel Ginsberg",
};

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * The CSV / manifest has names like "Purdy,J Gerry" (no space after the
 * comma). The DB convention (and what PatientSyncService receives from
 * the RPA extracts) is "PURDY, J GERRY" with a space. Insert the space
 * before normalising so the upsert key matches existing rows.
 */
function fixCsvName(s: string): string {
  return s.replace(/,(?!\s)/g, ", ");
}

/** Parse the manifest's MM/DD/YYYY DOS into a Date at noon UTC. */
function parseDos(dos: string): Date {
  const m = dos.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) throw new Error(`Invalid DOS format: ${dos}`);
  const [, mm, dd, yyyy] = m;
  // noon UTC to avoid TZ off-by-one
  return new Date(`${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}T12:00:00Z`);
}

interface ManifestFile {
  file: string;
  facesheet?: string;
  encounterIdx: number;
  patient: string;
  dos: string;
  accountNumber?: string;
  doctor: string;
  primaryCpt?: string;
  typeOfEncounter: "Consult" | "Procedure" | string;
}

interface Manifest {
  files: ManifestFile[];
}

function mapEncounterType(s: string): "CONSULT" | "PROGRESS" | "PROCEDURE" {
  const upper = s.toUpperCase();
  if (upper === "CONSULT") return "CONSULT";
  if (upper === "PROGRESS") return "PROGRESS";
  if (upper === "PROCEDURE") return "PROCEDURE";
  // default fallback — should not hit
  return "CONSULT";
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn"],
  });
  const prisma = app.get(PrismaService);
  const s3 = app.get(S3Service);

  // Pre-flight checks
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error(`Manifest not found at ${MANIFEST_PATH}`);
    process.exit(1);
  }
  const manifest: Manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8"));
  console.log(`\nManifest loaded: ${manifest.files.length} entries`);

  // ── Step 1: ensure specialties ───────────────────────────────────
  console.log("\n[1/4] Ensuring specialties...");
  const specialtyByName: Record<string, number> = {};
  for (const name of ["Podiatry", "Vascular"]) {
    const sp = await prisma.specialty.upsert({
      where: { name },
      update: {},
      create: { name, systemPrompt: "" },
    });
    specialtyByName[name] = sp.id;
    console.log(`  ${name}: id=${sp.id}`);
  }

  // ── Step 2: ensure doctors ───────────────────────────────────────
  console.log("\n[2/4] Ensuring doctors (5 expected)...");
  const doctorByName: Record<string, number> = {};
  let docsCreated = 0;
  let docsExisting = 0;
  for (const spec of DOCTORS) {
    const existing = await prisma.doctor.findUnique({
      where: { username: spec.username },
    });
    if (existing) {
      doctorByName[spec.name] = existing.id;
      docsExisting++;
      console.log(`  ${spec.name} (existing id=${existing.id})`);
    } else {
      const passwordHash = await bcrypt.hash(spec.username, 10);
      const created = await prisma.doctor.create({
        data: {
          name: spec.name,
          username: spec.username,
          password: passwordHash,
          specialty: spec.specialtyName,
          specialtyId: specialtyByName[spec.specialtyName],
          emrSystems: ["BAPTIST"],
        },
      });
      doctorByName[spec.name] = created.id;
      docsCreated++;
      console.log(
        `  ${spec.name} (created id=${created.id}, specialty=${spec.specialtyName}, password=${spec.username})`,
      );
    }
  }
  console.log(`  Doctors: ${docsExisting} existing, ${docsCreated} created`);

  // ── Step 3: process encounters ───────────────────────────────────
  console.log(`\n[3/4] Processing ${manifest.files.length} encounters...`);
  let patientsCreated = 0;
  let patientsReused = 0;
  let linksCreated = 0;
  let linksExisting = 0;
  let encountersCreated = 0;
  let encountersSkipped = 0;
  let pdfsUploaded = 0;
  const pdfErrors: Array<{ idx: number; reason: string }> = [];

  for (const entry of manifest.files) {
    const idx = entry.encounterIdx;
    const docName = MANIFEST_DOCTOR_TO_NAME[entry.doctor];
    if (!docName || !doctorByName[docName]) {
      console.warn(`  #${idx} ${entry.patient}: unknown doctor "${entry.doctor}", SKIP`);
      continue;
    }
    const doctorId = doctorByName[docName];

    // (a) Resolve / upsert patient
    const fixedName = fixCsvName(entry.patient);
    const patientNormName = normalizeName(fixedName);
    let patient = await prisma.patient.findUnique({
      where: {
        emrSystem_normalizedName: {
          emrSystem: "BAPTIST",
          normalizedName: patientNormName,
        },
      },
    });
    if (patient) {
      patientsReused++;
    } else {
      patient = await prisma.patient.create({
        data: {
          emrSystem: "BAPTIST",
          name: fixedName.toUpperCase(),
          normalizedName: patientNormName,
          facility: "Baptist Hospital",
          billingEmrStatus: "ALREADY_EXISTS",
          billingEmrPatientId: `TEST-${idx}`,
        },
      });
      patientsCreated++;
    }

    // (b) DoctorPatient link — isActive=false so it doesn't pollute the
    // rounds dashboard. NEVER touch existing links (don't activate
    // inactive patients).
    const existingLink = await prisma.doctorPatient.findUnique({
      where: {
        doctorId_patientId: { doctorId, patientId: patient.id },
      },
    });
    if (existingLink) {
      linksExisting++;
    } else {
      await prisma.doctorPatient.create({
        data: {
          doctorId,
          patientId: patient.id,
          isActive: false, // critical — keeps rounds dashboard clean
          lastSeenAt: parseDos(entry.dos),
        },
      });
      linksCreated++;
    }

    // (c) Idempotency check — skip if encounter already seeded
    const dateOfService = parseDos(entry.dos);
    const existingEnc = await prisma.encounter.findFirst({
      where: {
        patientId: patient.id,
        doctorId,
        dateOfService,
        noteAgentSummary: { startsWith: "Pre-loaded from Hajira" },
      },
    });
    if (existingEnc) {
      encountersSkipped++;
      continue;
    }

    // (d) Create encounter (without S3 keys yet — we need encounter.id)
    const encounterType = mapEncounterType(entry.typeOfEncounter);
    let encounter = await prisma.encounter.create({
      data: {
        patientId: patient.id,
        doctorId,
        type: encounterType,
        dateOfService,
        // No deadline — these are historical, the 24h SLA window doesn't apply.
        deadline: null,
        noteStatus: "PENDING", // updated to FOUND_SIGNED after PDFs upload
        noteAttempts: 0,
        noteAgentSummary: SEED_NOTE_MARKER,
      },
    });

    // (e) Upload PDFs to S3
    const noteSrc = path.join(PDFS_DIR, entry.file);
    const fsSrc = entry.facesheet
      ? path.join(PDFS_DIR, entry.facesheet)
      : null;
    if (!fs.existsSync(noteSrc)) {
      pdfErrors.push({ idx, reason: `note PDF missing: ${entry.file}` });
      continue;
    }
    const noteKey = `encounters/seed-hajira/${encounter.id}-note.pdf`;
    const fsKey = fsSrc
      ? `encounters/seed-hajira/${encounter.id}-facesheet.pdf`
      : null;
    try {
      await s3.upload(noteKey, fs.readFileSync(noteSrc), "application/pdf");
      pdfsUploaded++;
      if (fsSrc && fs.existsSync(fsSrc) && fsKey) {
        await s3.upload(fsKey, fs.readFileSync(fsSrc), "application/pdf");
        pdfsUploaded++;
      }
    } catch (err) {
      pdfErrors.push({
        idx,
        reason: `S3 upload failed: ${(err as Error).message}`,
      });
      // roll back the encounter so we don't leave a half-created row
      await prisma.encounter.delete({ where: { id: encounter.id } });
      continue;
    }

    // (f) Update encounter with the S3 keys + final note status
    encounter = await prisma.encounter.update({
      where: { id: encounter.id },
      data: {
        providerNote: noteKey,
        faceSheet: fsKey,
        noteStatus: "FOUND_SIGNED",
        noteAttempts: 1,
        noteLastAttemptAt: new Date(),
      },
    });
    encountersCreated++;

    if (encountersCreated % 10 === 0) {
      process.stdout.write(`  …${encountersCreated} encounters created\n`);
    }
  }

  // ── Step 4: report ───────────────────────────────────────────────
  console.log("\n[4/4] Done.\n");
  console.log("=== Summary ===");
  console.log(`  Specialties:           ${Object.keys(specialtyByName).length}`);
  console.log(`  Doctors:               ${docsCreated} created, ${docsExisting} existing`);
  console.log(`  Patients:              ${patientsCreated} created, ${patientsReused} reused`);
  console.log(`  DoctorPatient links:   ${linksCreated} created (isActive=false), ${linksExisting} existing (unchanged)`);
  console.log(`  Encounters:            ${encountersCreated} created, ${encountersSkipped} skipped (already seeded)`);
  console.log(`  PDFs uploaded to S3:   ${pdfsUploaded}`);
  if (pdfErrors.length > 0) {
    console.log(`\n  Errors (${pdfErrors.length}):`);
    for (const e of pdfErrors) console.log(`    #${e.idx}: ${e.reason}`);
  }

  await app.close();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
