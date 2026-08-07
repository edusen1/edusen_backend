-- AlterTable
ALTER TABLE "User" ADD COLUMN "cardToken" VARCHAR(64);

-- CreateIndex
CREATE UNIQUE INDEX "User_cardToken_key" ON "User"("cardToken");
