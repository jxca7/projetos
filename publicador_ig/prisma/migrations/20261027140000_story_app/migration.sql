-- CreateEnum
CREATE TYPE "StoryAppStatus" AS ENUM ('QUEUED', 'POSTING', 'DONE', 'FAILED', 'SKIPPED_2FA');

-- CreateTable
CREATE TABLE "StoryAppJob" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "imageKey" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "link" TEXT,
    "linkLabel" TEXT,
    "highlight" TEXT,
    "proxyEnc" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoryAppJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoryAppTarget" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordEnc" TEXT NOT NULL,
    "status" "StoryAppStatus" NOT NULL DEFAULT 'QUEUED',
    "error" TEXT,
    "igStoryId" TEXT,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoryAppTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StoryAppJob_workspaceId_createdAt_idx" ON "StoryAppJob"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "StoryAppTarget_jobId_idx" ON "StoryAppTarget"("jobId");

-- AddForeignKey
ALTER TABLE "StoryAppJob" ADD CONSTRAINT "StoryAppJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryAppTarget" ADD CONSTRAINT "StoryAppTarget_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "StoryAppJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
