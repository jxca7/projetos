-- CreateTable
CREATE TABLE "ConnectJob" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "proxyEnc" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConnectJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConnectTarget" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "comboEnc" TEXT NOT NULL,
    "status" "StoryAppStatus" NOT NULL DEFAULT 'QUEUED',
    "error" TEXT,
    "connected" TEXT,
    "doneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConnectTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConnectJob_workspaceId_createdAt_idx" ON "ConnectJob"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "ConnectTarget_jobId_idx" ON "ConnectTarget"("jobId");

-- AddForeignKey
ALTER TABLE "ConnectJob" ADD CONSTRAINT "ConnectJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectTarget" ADD CONSTRAINT "ConnectTarget_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ConnectJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
