-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "rksvConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "rksvConfirmedByUserId" TEXT,
ADD COLUMN     "rksvDisclaimerVersion" TEXT DEFAULT '1.0';
