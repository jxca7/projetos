-- AlterTable
ALTER TABLE "PostTarget" ADD COLUMN     "childContainerIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "containerCreatedAt" TIMESTAMP(3),
ADD COLUMN     "pollAttempts" INTEGER NOT NULL DEFAULT 0;
