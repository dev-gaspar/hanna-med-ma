-- Add Practice model + PayerEMRule + Doctor.practiceId FK + PayerEMCategory enum

CREATE TYPE "PayerEMCategory" AS ENUM (
    'ALWAYS_INITIAL_HOSPITAL',
    'ALWAYS_CONSULT',
    'DEPENDS_HUMAN_REVIEW'
);

CREATE TABLE "practices" (
    "id"           SERIAL       PRIMARY KEY,
    "name"         TEXT         NOT NULL UNIQUE,
    "systemPrompt" TEXT         NOT NULL DEFAULT '',
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL
);

CREATE TABLE "payer_em_rules" (
    "id"           SERIAL                NOT NULL,
    "payerName"    TEXT                  NOT NULL,
    "payerPattern" TEXT,
    "category"     "PayerEMCategory"     NOT NULL,
    "ageMin"       INTEGER,
    "ageMax"       INTEGER,
    "practiceId"   INTEGER,
    "notes"        TEXT,
    "source"       TEXT,
    "createdAt"    TIMESTAMP(3)          NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3)          NOT NULL,
    CONSTRAINT "payer_em_rules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payer_em_rules_payerName_practiceId_ageMin_key"
    ON "payer_em_rules" ("payerName", "practiceId", "ageMin");
CREATE INDEX "payer_em_rules_category_idx" ON "payer_em_rules" ("category");
CREATE INDEX "payer_em_rules_payerName_idx" ON "payer_em_rules" ("payerName");

ALTER TABLE "payer_em_rules"
  ADD CONSTRAINT "payer_em_rules_practiceId_fkey"
  FOREIGN KEY ("practiceId") REFERENCES "practices"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Doctor.practiceId — nullable FK to practices
ALTER TABLE "doctors" ADD COLUMN "practiceId" INTEGER;

ALTER TABLE "doctors"
  ADD CONSTRAINT "doctors_practiceId_fkey"
  FOREIGN KEY ("practiceId") REFERENCES "practices"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
