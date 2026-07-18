-- CreateTable
CREATE TABLE "ThesisAlertReview" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "dimensionKey" TEXT NOT NULL,
    "crossedAt" TIMESTAMP(3) NOT NULL,
    "action" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ThesisAlertReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ThesisAlertReview_userId_idx" ON "ThesisAlertReview"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ThesisAlertReview_userId_entityId_dimensionKey_key" ON "ThesisAlertReview"("userId", "entityId", "dimensionKey");

-- AddForeignKey
ALTER TABLE "ThesisAlertReview" ADD CONSTRAINT "ThesisAlertReview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
