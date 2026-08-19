/*
  Warnings:

  - You are about to drop the column `status` on the `Order` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "OrderLifecycleStatus" AS ENUM ('SUBMITTED', 'ACCEPTED', 'PARTIALLY_CANCELLED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "OrderFulfillmentStatus" AS ENUM ('PENDING', 'PREPARING', 'PARTIALLY_READY', 'READY', 'PARTIALLY_DELIVERED', 'DELIVERED');

-- CreateEnum
CREATE TYPE "OrderPaymentStatus" AS ENUM ('OPEN', 'PARTIALLY_PAID', 'PAID', 'REFUNDED');

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'REFUND';

-- AlterTable
ALTER TABLE "Order" DROP COLUMN "status",
ADD COLUMN     "fulfillmentStatus" "OrderFulfillmentStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "lifecycleStatus" "OrderLifecycleStatus" NOT NULL DEFAULT 'SUBMITTED',
ADD COLUMN     "paymentStatus" "OrderPaymentStatus" NOT NULL DEFAULT 'OPEN';

-- DropEnum
DROP TYPE "OrderStatus";

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "userId" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
