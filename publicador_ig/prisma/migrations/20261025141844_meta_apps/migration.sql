-- AlterTable
ALTER TABLE "SocialAccount" ADD COLUMN     "metaAppId" TEXT;

-- CreateTable
CREATE TABLE "MetaApp" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "appSecretEnc" TEXT NOT NULL,
    "graphVersion" TEXT NOT NULL DEFAULT 'v23.0',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetaApp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MetaApp_workspaceId_isActive_idx" ON "MetaApp"("workspaceId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "MetaApp_workspaceId_appId_key" ON "MetaApp"("workspaceId", "appId");

-- AddForeignKey
ALTER TABLE "SocialAccount" ADD CONSTRAINT "SocialAccount_metaAppId_fkey" FOREIGN KEY ("metaAppId") REFERENCES "MetaApp"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetaApp" ADD CONSTRAINT "MetaApp_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
