-- Simplify encounter note tracking:
--   * Rename faceSheetUrl   -> faceSheet     (keys, not URLs)
--   * Rename providerNoteUrl -> providerNote (keys, not URLs)
--   * Fold noteFile data into providerNote (same purpose) then drop noteFile
--   * Drop noteStatus / noteRetries and NoteStatus enum
--     (note presence/absence + deadline is enough to know if a search is pending)

-- 1. Rename the existing "Url" columns to the key-based names
ALTER TABLE "encounters" RENAME COLUMN "faceSheetUrl" TO "faceSheet";
ALTER TABLE "encounters" RENAME COLUMN "providerNoteUrl" TO "providerNote";

-- 2. If providerNote is empty but noteFile has a value, keep the value
UPDATE "encounters"
SET "providerNote" = "noteFile"
WHERE "providerNote" IS NULL AND "noteFile" IS NOT NULL;

-- 3. Drop the redundant / removed columns
ALTER TABLE "encounters" DROP COLUMN "noteFile";
ALTER TABLE "encounters" DROP COLUMN "noteRetries";
ALTER TABLE "encounters" DROP COLUMN "noteStatus";

-- 4. Drop the NoteStatus enum (no column references it anymore)
DROP TYPE "NoteStatus";
