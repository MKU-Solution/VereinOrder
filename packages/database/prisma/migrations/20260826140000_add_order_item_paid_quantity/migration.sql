-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN "paidQuantity" INTEGER NOT NULL DEFAULT 0;

-- Backfill: Setze paidQuantity = quantity für alle bereits vollständig bezahlten Bestellungen
UPDATE "OrderItem"
SET "paidQuantity" = "quantity"
FROM "Order"
WHERE "OrderItem"."orderId" = "Order"."id"
  AND "Order"."paymentStatus" = 'PAID';
