-- CreateTable
CREATE TABLE "PrepareJob" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "imageKey" TEXT,
    "imageUrl" TEXT,
    "bio" TEXT,
    "proxyEnc" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrepareJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrepareTarget" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordEnc" TEXT NOT NULL,
    "comboEnc" TEXT,
    "status" "StoryAppStatus" NOT NULL DEFAULT 'QUEUED',
    "error" TEXT,
    "doneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrepareTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PrepareJob_workspaceId_createdAt_idx" ON "PrepareJob"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "PrepareTarget_jobId_idx" ON "PrepareTarget"("jobId");

-- AddForeignKey
ALTER TABLE "PrepareJob" ADD CONSTRAINT "PrepareJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrepareTarget" ADD CONSTRAINT "PrepareTarget_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "PrepareJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
