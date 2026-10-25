-- AlterTable
ALTER TABLE "SocialAccount" ADD COLUMN     "folderId" TEXT;

-- CreateTable
CREATE TABLE "AccountFolder" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountFolder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountFolder_workspaceId_position_idx" ON "AccountFolder"("workspaceId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "AccountFolder_workspaceId_name_key" ON "AccountFolder"("workspaceId", "name");

-- AddForeignKey
ALTER TABLE "SocialAccount" ADD CONSTRAINT "SocialAccount_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "AccountFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountFolder" ADD CONSTRAINT "AccountFolder_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
