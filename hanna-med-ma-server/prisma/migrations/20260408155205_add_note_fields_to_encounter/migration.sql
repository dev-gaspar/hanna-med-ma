-- CreateEnum
CREATE TYPE "NoteStatus" AS ENUM ('PENDING', 'SEARCHING', 'FOUND', 'NOT_FOUND', 'FAILED');

-- AlterTable
ALTER TABLE "encounters" ADD COLUMN     "noteFile" TEXT,
ADD COLUMN     "noteRetries" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "noteStatus" "NoteStatus" NOT NULL DEFAULT 'PENDING';
