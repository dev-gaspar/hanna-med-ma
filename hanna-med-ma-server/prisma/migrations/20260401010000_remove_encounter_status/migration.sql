-- Drop the status column and index from encounters
DROP INDEX IF EXISTS "encounters_doctorId_status_idx";
ALTER TABLE "encounters" DROP COLUMN IF EXISTS "status";

-- Drop the EncounterStatus enum (no longer used)
DROP TYPE IF EXISTS "EncounterStatus";
