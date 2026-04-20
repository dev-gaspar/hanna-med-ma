-- CreateEnum
CREATE TYPE "EncounterCodingStatus" AS ENUM ('DRAFT', 'UNDER_REVIEW', 'APPROVED', 'TRANSFERRED_TO_CARETRACKER', 'DENIED');

-- CreateEnum
CREATE TYPE "NoteVersionBasis" AS ENUM ('DRAFT', 'SIGNED');




-- CreateTable
CREATE TABLE "encounter_codings" (
    "id" SERIAL NOT NULL,
    "encounterId" INTEGER NOT NULL,
    "status" "EncounterCodingStatus" NOT NULL DEFAULT 'DRAFT',
    "basedOnNoteVersion" "NoteVersionBasis" NOT NULL DEFAULT 'SIGNED',
    "proposal" JSONB NOT NULL,
    "primaryCpt" TEXT,
    "auditRiskScore" INTEGER,
    "riskBand" TEXT,
    "toolCallCount" INTEGER,
    "runDurationMs" INTEGER,
    "approvedByDoctorId" INTEGER,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "encounter_codings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "encounter_codings_encounterId_idx" ON "encounter_codings"("encounterId");

-- CreateIndex
CREATE INDEX "encounter_codings_status_idx" ON "encounter_codings"("status");

-- AddForeignKey
ALTER TABLE "encounter_codings" ADD CONSTRAINT "encounter_codings_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "encounters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

