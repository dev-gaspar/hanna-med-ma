-- CMS quarterly releases include historical snapshots of each edit
-- (same pair can recur with different deletion dates). Drop the
-- unique index (Prisma declares it as a UNIQUE INDEX, not an
-- ALTER TABLE constraint) and keep only a plain composite index.

DROP INDEX IF EXISTS "ncci_edits_column1Cpt_column2Cpt_editType_effectiveDate_key";

CREATE INDEX IF NOT EXISTS "ncci_edits_column1Cpt_column2Cpt_editType_idx"
  ON "ncci_edits" ("column1Cpt", "column2Cpt", "editType");
