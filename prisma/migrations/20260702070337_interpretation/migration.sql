-- CreateEnum
CREATE TYPE "InterpretationKind" AS ENUM ('NEUTRAL', 'BUFFETT');

-- CreateTable
CREATE TABLE "Interpretation" (
    "id" TEXT NOT NULL,
    "newsId" TEXT NOT NULL,
    "kind" "InterpretationKind" NOT NULL,
    "content" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Interpretation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Interpretation_newsId_kind_key" ON "Interpretation"("newsId", "kind");

-- AddForeignKey
ALTER TABLE "Interpretation" ADD CONSTRAINT "Interpretation_newsId_fkey" FOREIGN KEY ("newsId") REFERENCES "NewsItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
