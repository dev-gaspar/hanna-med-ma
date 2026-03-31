-- ============================================================================
-- Migration: Global Patients + Encounters + DoctorPatient
--
-- SAFE DATA MIGRATION:
--   1. Creates new tables & enums
--   2. Populates doctor_patients from existing patient.doctorId
--   3. Creates encounters from patients with isSeen=true
--   4. Deduplicates patients (same emrSystem+normalizedName) → single global record
--   5. Removes old columns/constraints from patients
-- ============================================================================

-- ==========================================================================
-- STEP 1: Create new enums
-- ==========================================================================
CREATE TYPE "EncounterStatus" AS ENUM ('PENDING', 'REGISTERED', 'ALREADY_EXISTS', 'FAILED');
CREATE TYPE "EncounterType" AS ENUM ('CONSULT', 'PROGRESS');

-- ==========================================================================
-- STEP 2: Create doctor_patients table
-- ==========================================================================
CREATE TABLE "doctor_patients" (
    "id" SERIAL NOT NULL,
    "doctorId" INTEGER NOT NULL,
    "patientId" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "doctor_patients_pkey" PRIMARY KEY ("id")
);

-- ==========================================================================
-- STEP 3: Create encounters table
-- ==========================================================================
CREATE TABLE "encounters" (
    "id" SERIAL NOT NULL,
    "patientId" INTEGER NOT NULL,
    "doctorId" INTEGER NOT NULL,
    "type" "EncounterType" NOT NULL DEFAULT 'CONSULT',
    "dateOfService" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "EncounterStatus" NOT NULL DEFAULT 'PENDING',
    "deadline" TIMESTAMP(3),
    "faceSheetUrl" TEXT,
    "providerNoteUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "encounters_pkey" PRIMARY KEY ("id")
);

-- ==========================================================================
-- STEP 4: Populate doctor_patients from existing patients
--         Each patient row currently has a doctorId → create a link
-- ==========================================================================
INSERT INTO "doctor_patients" ("doctorId", "patientId", "isActive", "lastSeenAt", "createdAt", "updatedAt")
SELECT "doctorId", "id", "isActive", "lastSeenAt", "createdAt", NOW()
FROM "patients";

-- ==========================================================================
-- STEP 5: Create Encounters from patients where isSeen = true
--         Maps billingEmrStatus → EncounterStatus
-- ==========================================================================
INSERT INTO "encounters" ("patientId", "doctorId", "type", "dateOfService", "status", "deadline", "createdAt", "updatedAt")
SELECT
    "id",
    "doctorId",
    'CONSULT'::"EncounterType",
    "updatedAt",
    CASE
        WHEN "billingEmrStatus" = 'PENDING' THEN 'PENDING'::"EncounterStatus"
        WHEN "billingEmrStatus" = 'REGISTERED' THEN 'REGISTERED'::"EncounterStatus"
        WHEN "billingEmrStatus" = 'ALREADY_EXISTS' THEN 'ALREADY_EXISTS'::"EncounterStatus"
        WHEN "billingEmrStatus" = 'FAILED' THEN 'FAILED'::"EncounterStatus"
        ELSE 'PENDING'::"EncounterStatus"
    END,
    "updatedAt" + INTERVAL '24 hours',
    NOW(),
    NOW()
FROM "patients"
WHERE "isSeen" = true;

-- ==========================================================================
-- STEP 6: Deduplicate patients with same (emrSystem, normalizedName)
--
--   When two doctors share the same patient, there are two rows.
--   We keep the one with the LOWEST id as the "survivor" and re-point
--   all foreign keys from duplicates to the survivor.
-- ==========================================================================

-- 6a: Build merge map (duplicateId → survivorId)
CREATE TEMP TABLE patient_merge AS
SELECT
    p."id" AS "duplicateId",
    survivor."id" AS "survivorId"
FROM "patients" p
INNER JOIN (
    SELECT MIN("id") AS "id", "emrSystem", "normalizedName"
    FROM "patients"
    GROUP BY "emrSystem", "normalizedName"
) survivor
    ON p."emrSystem" = survivor."emrSystem"
   AND p."normalizedName" = survivor."normalizedName"
WHERE p."id" != survivor."id";

-- 6b: Merge billingEmr fields — keep the "best" status on the survivor
--     Priority: ALREADY_EXISTS > REGISTERED > PENDING > FAILED
UPDATE "patients" surv
SET
    "billingEmrStatus" = CASE
        WHEN dup."billingEmrStatus" = 'ALREADY_EXISTS' THEN 'ALREADY_EXISTS'::"BillingEmrStatus"
        WHEN dup."billingEmrStatus" = 'REGISTERED' AND surv."billingEmrStatus" NOT IN ('ALREADY_EXISTS') THEN 'REGISTERED'::"BillingEmrStatus"
        ELSE surv."billingEmrStatus"
    END,
    "billingEmrPatientId" = COALESCE(surv."billingEmrPatientId", dup."billingEmrPatientId")
FROM patient_merge pm
JOIN "patients" dup ON dup."id" = pm."duplicateId"
WHERE surv."id" = pm."survivorId";

-- 6c: Re-point doctor_patients from duplicate → survivor
UPDATE "doctor_patients" dp
SET "patientId" = pm."survivorId"
FROM patient_merge pm
WHERE dp."patientId" = pm."duplicateId";

-- 6d: Remove duplicate doctor_patients (same doctorId + patientId after re-point)
DELETE FROM "doctor_patients" dp1
USING "doctor_patients" dp2
WHERE dp1."id" > dp2."id"
  AND dp1."doctorId" = dp2."doctorId"
  AND dp1."patientId" = dp2."patientId";

-- 6e: Re-point encounters from duplicate → survivor
UPDATE "encounters" e
SET "patientId" = pm."survivorId"
FROM patient_merge pm
WHERE e."patientId" = pm."duplicateId";

-- 6f: Re-point patient_raw_data from duplicate → survivor
UPDATE "patient_raw_data" prd
SET "patientId" = pm."survivorId"
FROM patient_merge pm
WHERE prd."patientId" = pm."duplicateId";

-- 6g: Remove duplicate raw data (keep newest per patientId+dataType)
DELETE FROM "patient_raw_data" prd1
USING "patient_raw_data" prd2
WHERE prd1."id" < prd2."id"
  AND prd1."patientId" = prd2."patientId"
  AND prd1."dataType" = prd2."dataType";

-- 6h: Delete the duplicate patient rows
DELETE FROM "patients" p
USING patient_merge pm
WHERE p."id" = pm."duplicateId";

-- 6i: Cleanup
DROP TABLE patient_merge;

-- ==========================================================================
-- STEP 7: Drop old constraints and indexes from patients
-- ==========================================================================
DROP INDEX IF EXISTS "patients_doctorId_emrSystem_idx";
DROP INDEX IF EXISTS "patients_doctorId_isActive_idx";
ALTER TABLE "patients" DROP CONSTRAINT IF EXISTS "patients_doctorId_emrSystem_normalizedName_key";
ALTER TABLE "patients" DROP CONSTRAINT IF EXISTS "patients_doctorId_fkey";

-- ==========================================================================
-- STEP 8: Drop old columns from patients
-- ==========================================================================
ALTER TABLE "patients" DROP COLUMN "doctorId";
ALTER TABLE "patients" DROP COLUMN "isSeen";
ALTER TABLE "patients" DROP COLUMN "isActive";
ALTER TABLE "patients" DROP COLUMN "lastSeenAt";

-- ==========================================================================
-- STEP 9: Add new constraint and indexes to patients
-- ==========================================================================
CREATE UNIQUE INDEX "patients_emrSystem_normalizedName_key" ON "patients"("emrSystem", "normalizedName");
CREATE INDEX "patients_emrSystem_idx" ON "patients"("emrSystem");

-- ==========================================================================
-- STEP 10: Add constraints and indexes to doctor_patients
-- ==========================================================================
CREATE UNIQUE INDEX "doctor_patients_doctorId_patientId_key" ON "doctor_patients"("doctorId", "patientId");
CREATE INDEX "doctor_patients_doctorId_isActive_idx" ON "doctor_patients"("doctorId", "isActive");

ALTER TABLE "doctor_patients"
    ADD CONSTRAINT "doctor_patients_doctorId_fkey"
    FOREIGN KEY ("doctorId") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "doctor_patients"
    ADD CONSTRAINT "doctor_patients_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ==========================================================================
-- STEP 11: Add constraints and indexes to encounters
-- ==========================================================================
CREATE INDEX "encounters_doctorId_idx" ON "encounters"("doctorId");
CREATE INDEX "encounters_patientId_idx" ON "encounters"("patientId");
CREATE INDEX "encounters_doctorId_status_idx" ON "encounters"("doctorId", "status");

ALTER TABLE "encounters"
    ADD CONSTRAINT "encounters_doctorId_fkey"
    FOREIGN KEY ("doctorId") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "encounters"
    ADD CONSTRAINT "encounters_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
