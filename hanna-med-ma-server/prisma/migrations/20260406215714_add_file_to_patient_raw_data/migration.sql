-- AlterTable
ALTER TABLE "doctor_patients" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "encounters" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "patient_raw_data" ADD COLUMN     "file" TEXT;
