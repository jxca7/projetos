-- CreateEnum
CREATE TYPE "ImportMode" AS ENUM ('LINK', 'PROFILE');

-- AlterTable
ALTER TABLE "MediaAsset" ADD COLUMN     "caption" TEXT;

-- AlterTable
ALTER TABLE "MediaImport" ADD COLUMN     "account" TEXT,
ADD COLUMN     "downloaded" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "mode" "ImportMode" NOT NULL DEFAULT 'LINK',
ADD COLUMN     "options" JSONB,
ADD COLUMN     "skipped" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "sourceUrl" DROP NOT NULL;
