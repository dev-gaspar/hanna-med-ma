-- Async pipeline for the AI Coder.
-- Postgres can't use a freshly-added enum value in the same transaction,
-- so this migration only extends the enum. The column additions live in
-- a paired companion migration (20260421000100_coding_async_columns).

ALTER TYPE "EncounterCodingStatus" ADD VALUE IF NOT EXISTS 'IN_PROGRESS';
ALTER TYPE "EncounterCodingStatus" ADD VALUE IF NOT EXISTS 'FAILED';
