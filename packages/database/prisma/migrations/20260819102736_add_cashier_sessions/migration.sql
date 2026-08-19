-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('ACTIVE', 'CLOSED');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "cashierSessionId" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "cashierSessionId" TEXT;

-- CreateTable
CREATE TABLE "CashierSession" (
    "id" TEXT NOT NULL,
    "startingBalance" INTEGER NOT NULL DEFAULT 0,
    "closingBalance" INTEGER,
    "status" "SessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "startTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endTime" TIMESTAMP(3),
    "userId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,

    CONSTRAINT "CashierSession_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_cashierSessionId_fkey" FOREIGN KEY ("cashierSessionId") REFERENCES "CashierSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_cashierSessionId_fkey" FOREIGN KEY ("cashierSessionId") REFERENCES "CashierSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashierSession" ADD CONSTRAINT "CashierSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashierSession" ADD CONSTRAINT "CashierSession_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
