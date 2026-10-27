-- AlterTable
ALTER TABLE "StoryAppTarget" ADD COLUMN     "comboEnc" TEXT;

-- CreateTable
CREATE TABLE "IgSession" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "settingsEnc" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IgSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IgSession_workspaceId_username_key" ON "IgSession"("workspaceId", "username");

-- AddForeignKey
ALTER TABLE "IgSession" ADD CONSTRAINT "IgSession_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
