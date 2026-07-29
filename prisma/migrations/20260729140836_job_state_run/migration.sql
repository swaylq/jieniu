
-- CreateTable
CREATE TABLE "JobState" (
    "key" TEXT NOT NULL,
    "lastFire" TIMESTAMP(3),
    "nextFire" TIMESTAMP(3),
    "lastStatus" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "runningAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobState_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL,
    "jobKey" TEXT NOT NULL,
    "firedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "exitCode" INTEGER,
    "output" TEXT,
    "metrics" JSONB,
    "alerts" JSONB,
    "narration" TEXT,
    "durationMs" INTEGER,
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobRun_jobKey_firedAt_idx" ON "JobRun"("jobKey", "firedAt");
