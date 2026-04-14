-- Re-introduce note tracking on encounters, now purely informational
-- (observability). Lifecycle is driven by Redis delayed queue + attempts
-- counter, not by a state-machine column.

-- 1. Create the NoteStatus enum
CREATE TYPE "NoteStatus" AS ENUM (
  'PENDING',
  'SEARCHING',
  'NOT_FOUND',
  'FOUND_UNSIGNED',
  'FOUND_SIGNED'
);

-- 2. Add tracking columns to encounters
ALTER TABLE "encounters"
  ADD COLUMN "noteStatus" "NoteStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "noteAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "noteLastAttemptAt" TIMESTAMP(3),
  ADD COLUMN "noteAgentSummary" TEXT;

-- 3. For encounters that already have a providerNote populated, mark them as
--    terminal success so the scheduler does not pick them up again.
UPDATE "encounters"
SET "noteStatus" = 'FOUND_SIGNED'
WHERE "providerNote" IS NOT NULL;

-- 4. Index for fast lookup of pending work by state
CREATE INDEX "encounters_noteStatus_idx" ON "encounters"("noteStatus");
