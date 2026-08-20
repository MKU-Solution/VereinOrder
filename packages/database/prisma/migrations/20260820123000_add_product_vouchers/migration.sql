CREATE TYPE "ProductVoucherStatus" AS ENUM ('ISSUED', 'REDEEMED', 'CANCELLED');

ALTER TABLE "Payment"
  ADD COLUMN "tenderedAmount" INTEGER,
  ADD COLUMN "changeAmount" INTEGER NOT NULL DEFAULT 0;

-- A cashier must not have two simultaneously active sessions for one event.
CREATE UNIQUE INDEX "CashierSession_userId_eventId_active_key"
  ON "CashierSession"("userId", "eventId")
  WHERE "status" = 'ACTIVE';

CREATE TABLE "ProductVoucher" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "status" "ProductVoucherStatus" NOT NULL DEFAULT 'ISSUED',
  "eventId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "orderItemId" TEXT NOT NULL,
  "issuedByUserId" TEXT,
  "cashierSessionId" TEXT,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "redeemedAt" TIMESTAMP(3),
  "redeemedAtStationId" TEXT,

  CONSTRAINT "ProductVoucher_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductVoucher_code_key" ON "ProductVoucher"("code");
CREATE INDEX "ProductVoucher_eventId_status_idx" ON "ProductVoucher"("eventId", "status");
CREATE INDEX "ProductVoucher_orderId_idx" ON "ProductVoucher"("orderId");

ALTER TABLE "ProductVoucher"
  ADD CONSTRAINT "ProductVoucher_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductVoucher"
  ADD CONSTRAINT "ProductVoucher_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProductVoucher"
  ADD CONSTRAINT "ProductVoucher_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductVoucher"
  ADD CONSTRAINT "ProductVoucher_orderItemId_fkey"
  FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductVoucher"
  ADD CONSTRAINT "ProductVoucher_issuedByUserId_fkey"
  FOREIGN KEY ("issuedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProductVoucher"
  ADD CONSTRAINT "ProductVoucher_cashierSessionId_fkey"
  FOREIGN KEY ("cashierSessionId") REFERENCES "CashierSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProductVoucher"
  ADD CONSTRAINT "ProductVoucher_redeemedAtStationId_fkey"
  FOREIGN KEY ("redeemedAtStationId") REFERENCES "Station"("id") ON DELETE SET NULL ON UPDATE CASCADE;
