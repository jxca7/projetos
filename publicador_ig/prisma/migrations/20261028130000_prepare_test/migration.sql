-- CreateTable
CREATE TABLE "PrepareTestJob" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "proxyEnc" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrepareTestJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrepareTestTarget" (
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

    CONSTRAINT "PrepareTestTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PrepareTestJob_workspaceId_createdAt_idx" ON "PrepareTestJob"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "PrepareTestTarget_jobId_idx" ON "PrepareTestTarget"("jobId");

-- AddForeignKey
ALTER TABLE "PrepareTestJob" ADD CONSTRAINT "PrepareTestJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrepareTestTarget" ADD CONSTRAINT "PrepareTestTarget_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "PrepareTestJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
