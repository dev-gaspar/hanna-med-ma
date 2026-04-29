-- AlterTable: capture CMS Place of Service code per encounter (asked
-- to the doctor when marking the patient as seen, per Dr. Peter
-- 2026-04-18 meeting).
ALTER TABLE "encounters" ADD COLUMN "placeOfService" TEXT;

-- Backfill legacy encounters that pre-date this column. Every
-- encounter in scope so far is hospital inpatient (Baptist/Jackson/
-- Steward), so POS=21 is the correct historical value. Encounters
-- without an EMR system are left null and will fail the NOT-NULL
-- guard in coding.service.ts on the next run — surfacing the gap
-- rather than silently coding with a wrong default.
UPDATE "encounters" e
SET "placeOfService" = '21'
FROM "patients" p
WHERE e."patientId" = p.id
  AND e."placeOfService" IS NULL
  AND p."emrSystem" IN ('BAPTIST', 'JACKSON', 'STEWARD');

-- AlterTable: pin Medicare administrative geography to the practice
-- so MPFS pricing and LCD jurisdiction stop being hardcoded in
-- coding.service.ts. Defaults match Hanna-Med (Miami-Dade + FCSO
-- FL Part B) — they are write-time defaults; the coder reads each
-- row explicitly and throws if a doctor isn't linked to a practice.
ALTER TABLE "practices" ADD COLUMN "medicareLocality" TEXT NOT NULL DEFAULT '04';
ALTER TABLE "practices" ADD COLUMN "medicareContractorNumber" TEXT NOT NULL DEFAULT '09102';
