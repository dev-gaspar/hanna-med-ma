-- Consolidate specialty metadata into a single catalog table with a
-- Doctor relation. Replaces the standalone specialty_prompt_deltas.

-- 1. New catalog table.
CREATE TABLE "specialties" (
    "id"           SERIAL PRIMARY KEY,
    "name"         TEXT NOT NULL,
    "systemPrompt" TEXT NOT NULL DEFAULT '',
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "specialties_name_key" ON "specialties" ("name");

-- 2. Seed from the two existing sources: the prompt-deltas rows and
--    the distinct non-empty specialty strings already on doctors.
--    The delta rows are the authoritative display casing; if a doctor
--    row's specialty string differs only in case/trim, the delta wins.
INSERT INTO "specialties" ("name", "systemPrompt", "updatedAt")
SELECT DISTINCT ON (LOWER(TRIM(specialty)))
       specialty AS name,
       "systemPrompt",
       NOW()
FROM "specialty_prompt_deltas"
ORDER BY LOWER(TRIM(specialty)), id;

INSERT INTO "specialties" ("name", "systemPrompt", "updatedAt")
SELECT DISTINCT ON (LOWER(TRIM(d.specialty)))
       d.specialty AS name,
       '' AS "systemPrompt",
       NOW()
FROM "doctors" d
WHERE d.specialty IS NOT NULL
  AND TRIM(d.specialty) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM "specialties" s
    WHERE LOWER(TRIM(s.name)) = LOWER(TRIM(d.specialty))
  )
ORDER BY LOWER(TRIM(d.specialty)), d.id;

-- 3. FK column on doctors. Nullable because existing rows may have
--    no matching specialty string (or it may be " ").
ALTER TABLE "doctors" ADD COLUMN "specialtyId" INTEGER;

UPDATE "doctors" d
SET    "specialtyId" = s.id
FROM   "specialties" s
WHERE  d.specialty IS NOT NULL
   AND LOWER(TRIM(d.specialty)) = LOWER(TRIM(s.name));

ALTER TABLE "doctors"
  ADD CONSTRAINT "doctors_specialtyId_fkey"
  FOREIGN KEY ("specialtyId") REFERENCES "specialties"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "doctors_specialtyId_idx" ON "doctors" ("specialtyId");

-- 4. Retire the standalone deltas table.
DROP TABLE "specialty_prompt_deltas";
