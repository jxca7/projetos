-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('QUEUED', 'DOWNLOADING', 'DONE', 'DUPLICATE', 'FAILED');

-- CreateTable
CREATE TABLE "MediaImport" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'QUEUED',
    "title" TEXT,
    "error" TEXT,
    "assetId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstagramCookie" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "cookiesEnc" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstagramCookie_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MediaImport_workspaceId_createdAt_idx" ON "MediaImport"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "InstagramCookie_workspaceId_key" ON "InstagramCookie"("workspaceId");

-- AddForeignKey
ALTER TABLE "MediaImport" ADD CONSTRAINT "MediaImport_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaImport" ADD CONSTRAINT "MediaImport_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstagramCookie" ADD CONSTRAINT "InstagramCookie_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
