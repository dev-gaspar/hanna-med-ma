-- CreateTable: CMS Place-of-Service code catalog. Source:
-- https://www.cms.gov/Medicare/Coding/place-of-service-codes/Place_of_Service_Code_Set
-- Populated by `npx ts-node scripts/load-place-of-service-codes.ts`.
CREATE TABLE "place_of_service_codes" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortLabel" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "place_of_service_codes_pkey" PRIMARY KEY ("code")
);

-- AlterTable: per-specialty POS config — drives which codes appear
-- as quick-pick buttons in the encounter modal and which one is
-- pre-selected. Both editable from the admin UI per specialty.
ALTER TABLE "specialties" ADD COLUMN "commonPosCodes" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "specialties" ADD COLUMN "defaultPosCode" TEXT;
