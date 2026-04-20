-- modifier becomes NOT NULL with empty-string default so it can participate
-- in the (cpt, modifier, localityId, year) compound unique without
-- Postgres's NULL-as-distinct behavior breaking upserts.

UPDATE "fee_schedule_items" SET "modifier" = '' WHERE "modifier" IS NULL;
ALTER TABLE "fee_schedule_items"
  ALTER COLUMN "modifier" SET NOT NULL,
  ALTER COLUMN "modifier" SET DEFAULT '';
