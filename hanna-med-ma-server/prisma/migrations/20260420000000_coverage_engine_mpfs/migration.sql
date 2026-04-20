-- Phase 1: regulatory-engine foundation. Two tables that back the
-- Medicare Physician Fee Schedule (MPFS) lookups: Locality (GPCIs)
-- and FeeScheduleItem (per-CPT, per-locality, per-year).

-- CreateTable
CREATE TABLE "localities" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "macContractor" TEXT,
    "description" TEXT,
    "workGpci" DOUBLE PRECISION NOT NULL,
    "peGpci" DOUBLE PRECISION NOT NULL,
    "mpGpci" DOUBLE PRECISION NOT NULL,
    "year" INTEGER NOT NULL,

    CONSTRAINT "localities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_schedule_items" (
    "id" SERIAL NOT NULL,
    "cpt" TEXT NOT NULL,
    "modifier" TEXT,
    "year" INTEGER NOT NULL,
    "localityId" INTEGER NOT NULL,
    "description" TEXT,
    "workRvu" DOUBLE PRECISION NOT NULL,
    "peRvu" DOUBLE PRECISION NOT NULL,
    "peFacilityRvu" DOUBLE PRECISION,
    "mpRvu" DOUBLE PRECISION NOT NULL,
    "conversionFactor" DOUBLE PRECISION NOT NULL,
    "amountUsd" DOUBLE PRECISION NOT NULL,
    "amountFacilityUsd" DOUBLE PRECISION,
    "globalDays" TEXT,
    "statusCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fee_schedule_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "localities_code_state_year_key" ON "localities"("code", "state", "year");

-- CreateIndex
CREATE INDEX "fee_schedule_items_cpt_year_idx" ON "fee_schedule_items"("cpt", "year");

-- CreateIndex
CREATE UNIQUE INDEX "fee_schedule_items_cpt_modifier_localityId_year_key" ON "fee_schedule_items"("cpt", "modifier", "localityId", "year");

-- AddForeignKey
ALTER TABLE "fee_schedule_items" ADD CONSTRAINT "fee_schedule_items_localityId_fkey" FOREIGN KEY ("localityId") REFERENCES "localities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
