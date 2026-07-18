-- CreateTable
CREATE TABLE "UserThesis" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "reason" TEXT,
    "horizon" TEXT,
    "dimensions" JSONB NOT NULL,
    "baseModel" TEXT,
    "adoptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserThesis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserThesis_userId_idx" ON "UserThesis"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserThesis_userId_entityId_key" ON "UserThesis"("userId", "entityId");

-- AddForeignKey
ALTER TABLE "UserThesis" ADD CONSTRAINT "UserThesis_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserThesis" ADD CONSTRAINT "UserThesis_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
