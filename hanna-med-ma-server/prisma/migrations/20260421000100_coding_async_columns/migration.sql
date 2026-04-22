-- Companion to 20260421000000_coding_async_pipeline.
-- Adds the columns needed by the async generation path and flips the
-- default status to IN_PROGRESS (safe now that the enum value was
-- committed in the prior migration).

ALTER TABLE "encounter_codings"
  ALTER COLUMN "proposal" DROP NOT NULL,
  ALTER COLUMN "status" SET DEFAULT 'IN_PROGRESS',
  ADD COLUMN IF NOT EXISTS "reasoningLog" JSONB,
  ADD COLUMN IF NOT EXISTS "errorMessage" TEXT,
  ADD COLUMN IF NOT EXISTS "startedAt"   TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3);
