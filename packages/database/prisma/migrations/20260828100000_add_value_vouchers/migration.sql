-- Issue #139: Wertgutscheine sind ein eigenstaendiges, centgenaues
-- Geldwert-Aggregat. ProductVoucher bleibt unveraendert.
--
-- Die zusammengesetzten Fremdschluessel binden Gutschein, Bestellung und
-- Kassensitzung an dieselbe Veranstaltung und Betriebsart. CHECK-Constraints
-- sichern die innerhalb einer Zeile pruefbaren Salden- und Typinvarianten.
-- Die lueckenlose, append-only Bewegungskette und der Abgleich der ISSUE-
-- Bewegung mit ValueVoucher.initialBalance sind zeilenuebergreifend und werden
-- zusaetzlich vor Restore sowie spaeter im transaktionalen Domaenendienst
-- geprueft.
BEGIN;

CREATE TYPE "ValueVoucherStatus" AS ENUM ('ACTIVE', 'DEPLETED', 'CANCELLED');
CREATE TYPE "ValueVoucherMovementType" AS ENUM ('ISSUE', 'REDEEM', 'REDEEM_REVERSAL', 'CANCEL');

ALTER TYPE "PrintJobType" ADD VALUE 'VALUE_VOUCHER_ISSUE';
ALTER TYPE "PrintJobType" ADD VALUE 'VALUE_VOUCHER_BALANCE';

CREATE UNIQUE INDEX "Order_id_eventId_dataMode_key"
  ON "Order"("id", "eventId", "dataMode");
CREATE UNIQUE INDEX "Payment_id_orderId_key"
  ON "Payment"("id", "orderId");
CREATE UNIQUE INDEX "CashierSession_id_eventId_dataMode_key"
  ON "CashierSession"("id", "eventId", "dataMode");

CREATE TABLE "ValueVoucher" (
  "id" TEXT NOT NULL,
  "code" VARCHAR(40) NOT NULL,
  "status" "ValueVoucherStatus" NOT NULL DEFAULT 'ACTIVE',
  "initialBalance" INTEGER NOT NULL,
  "currentBalance" INTEGER NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 0,
  "eventId" TEXT NOT NULL,
  "dataMode" "OperationalDataMode" NOT NULL,
  "issuedByUserId" TEXT NOT NULL,
  "issuedCashierSessionId" TEXT NOT NULL,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ValueVoucher_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ValueVoucher_initialBalance_positive_check"
    CHECK ("initialBalance" > 0),
  CONSTRAINT "ValueVoucher_currentBalance_range_check"
    CHECK ("currentBalance" >= 0 AND "currentBalance" <= "initialBalance"),
  CONSTRAINT "ValueVoucher_version_nonnegative_check"
    CHECK ("version" >= 0),
  CONSTRAINT "ValueVoucher_status_balance_check"
    CHECK (
      ("status" = 'ACTIVE' AND "currentBalance" > 0)
      OR ("status" IN ('DEPLETED', 'CANCELLED') AND "currentBalance" = 0)
    )
);

CREATE TABLE "ValueVoucherMovement" (
  "id" TEXT NOT NULL,
  "type" "ValueVoucherMovementType" NOT NULL,
  "balanceDelta" INTEGER NOT NULL,
  "balanceBefore" INTEGER NOT NULL,
  "balanceAfter" INTEGER NOT NULL,
  "voucherId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "dataMode" "OperationalDataMode" NOT NULL,
  "orderId" TEXT,
  "paymentId" TEXT,
  "reversesMovementId" TEXT,
  "actorUserId" TEXT NOT NULL,
  "cashierSessionId" TEXT NOT NULL,
  "fundingMethod" "PaymentMethod",
  "tenderedAmount" INTEGER,
  "changeAmount" INTEGER,
  "reason" VARCHAR(500),
  "idempotencyKey" VARCHAR(128) NOT NULL,
  "requestFingerprint" CHAR(64) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ValueVoucherMovement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ValueVoucherMovement_balance_chain_check"
    CHECK (
      "balanceBefore" BETWEEN 0 AND 2147483647
      AND "balanceAfter" BETWEEN 0 AND 2147483647
      AND "balanceAfter" = "balanceBefore" + "balanceDelta"
    ),
  CONSTRAINT "ValueVoucherMovement_reason_check"
    CHECK ("reason" IS NULL OR length(btrim("reason")) > 0),
  CONSTRAINT "ValueVoucherMovement_tender_check"
    CHECK (
      ("fundingMethod" = 'CASH'
        AND "tenderedAmount" IS NOT NULL
        AND "changeAmount" IS NOT NULL
        AND "tenderedAmount" >= "balanceDelta"
        AND "changeAmount" = "tenderedAmount" - "balanceDelta")
      OR ("fundingMethod" = 'CARD'
        AND "tenderedAmount" IS NULL
        AND "changeAmount" IS NULL)
      OR ("fundingMethod" IS NULL
        AND "tenderedAmount" IS NULL
        AND "changeAmount" IS NULL)
    ),
  CONSTRAINT "ValueVoucherMovement_type_fields_check"
    CHECK (
      ("type" = 'ISSUE'
        AND "balanceDelta" > 0
        AND "balanceBefore" = 0
        AND "balanceAfter" = "balanceDelta"
        AND "orderId" IS NULL
        AND "paymentId" IS NULL
        AND "reversesMovementId" IS NULL
        AND "fundingMethod" IN ('CASH', 'CARD'))
      OR ("type" = 'REDEEM'
        AND "balanceDelta" < 0
        AND "orderId" IS NOT NULL
        AND "paymentId" IS NOT NULL
        AND "reversesMovementId" IS NULL
        AND "fundingMethod" IS NULL)
      OR ("type" = 'REDEEM_REVERSAL'
        AND "balanceDelta" > 0
        AND "paymentId" IS NULL
        AND "reversesMovementId" IS NOT NULL
        AND "fundingMethod" IS NULL
        AND "reason" IS NOT NULL
        AND length(btrim("reason")) > 0)
      OR ("type" = 'CANCEL'
        AND "balanceDelta" < 0
        AND "balanceAfter" = 0
        AND "orderId" IS NULL
        AND "paymentId" IS NULL
        AND "reversesMovementId" IS NULL
        AND "fundingMethod" IS NULL
        AND "reason" IS NOT NULL
        AND length(btrim("reason")) > 0)
    )
);

CREATE TABLE "ValueVoucherAllocation" (
  "id" TEXT NOT NULL,
  "movementId" TEXT NOT NULL,
  "orderItemId" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,

  CONSTRAINT "ValueVoucherAllocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ValueVoucherAllocation_amount_positive_check" CHECK ("amount" > 0)
);

CREATE UNIQUE INDEX "ValueVoucher_code_key" ON "ValueVoucher"("code");
CREATE UNIQUE INDEX "ValueVoucher_id_eventId_dataMode_key"
  ON "ValueVoucher"("id", "eventId", "dataMode");
CREATE INDEX "ValueVoucher_eventId_dataMode_status_idx"
  ON "ValueVoucher"("eventId", "dataMode", "status");
CREATE INDEX "ValueVoucher_issuedCashierSessionId_issuedAt_idx"
  ON "ValueVoucher"("issuedCashierSessionId", "issuedAt");

CREATE UNIQUE INDEX "ValueVoucherMovement_paymentId_key"
  ON "ValueVoucherMovement"("paymentId");
CREATE UNIQUE INDEX "ValueVoucherMovement_idempotencyKey_key"
  ON "ValueVoucherMovement"("idempotencyKey");
CREATE UNIQUE INDEX "ValueVoucherMovement_id_voucher_event_mode_key"
  ON "ValueVoucherMovement"("id", "voucherId", "eventId", "dataMode");
CREATE UNIQUE INDEX "ValueVoucherMovement_paymentId_orderId_key"
  ON "ValueVoucherMovement"("paymentId", "orderId");
CREATE INDEX "ValueVoucherMovement_voucherId_createdAt_id_idx"
  ON "ValueVoucherMovement"("voucherId", "createdAt", "id");
CREATE INDEX "ValueVoucherMovement_event_mode_type_createdAt_idx"
  ON "ValueVoucherMovement"("eventId", "dataMode", "type", "createdAt");
CREATE INDEX "ValueVoucherMovement_orderId_type_idx"
  ON "ValueVoucherMovement"("orderId", "type");
CREATE INDEX "ValueVoucherMovement_session_type_createdAt_idx"
  ON "ValueVoucherMovement"("cashierSessionId", "type", "createdAt");
CREATE INDEX "ValueVoucherMovement_reversesMovementId_idx"
  ON "ValueVoucherMovement"("reversesMovementId");

CREATE UNIQUE INDEX "ValueVoucherAllocation_movementId_orderItemId_key"
  ON "ValueVoucherAllocation"("movementId", "orderItemId");
CREATE INDEX "ValueVoucherAllocation_orderItemId_idx"
  ON "ValueVoucherAllocation"("orderItemId");

ALTER TABLE "ValueVoucher"
  ADD CONSTRAINT "ValueVoucher_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ValueVoucher"
  ADD CONSTRAINT "ValueVoucher_issuedByUserId_fkey"
  FOREIGN KEY ("issuedByUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ValueVoucher"
  ADD CONSTRAINT "ValueVoucher_issuingSession_fkey"
  FOREIGN KEY ("issuedCashierSessionId", "eventId", "dataMode")
  REFERENCES "CashierSession"("id", "eventId", "dataMode")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "ValueVoucherMovement"
  ADD CONSTRAINT "ValueVoucherMovement_voucher_fkey"
  FOREIGN KEY ("voucherId", "eventId", "dataMode")
  REFERENCES "ValueVoucher"("id", "eventId", "dataMode")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "ValueVoucherMovement"
  ADD CONSTRAINT "ValueVoucherMovement_order_fkey"
  FOREIGN KEY ("orderId", "eventId", "dataMode")
  REFERENCES "Order"("id", "eventId", "dataMode")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "ValueVoucherMovement"
  ADD CONSTRAINT "ValueVoucherMovement_payment_fkey"
  FOREIGN KEY ("paymentId", "orderId")
  REFERENCES "Payment"("id", "orderId")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "ValueVoucherMovement"
  ADD CONSTRAINT "ValueVoucherMovement_reversal_fkey"
  FOREIGN KEY ("reversesMovementId", "voucherId", "eventId", "dataMode")
  REFERENCES "ValueVoucherMovement"("id", "voucherId", "eventId", "dataMode")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "ValueVoucherMovement"
  ADD CONSTRAINT "ValueVoucherMovement_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ValueVoucherMovement"
  ADD CONSTRAINT "ValueVoucherMovement_cashierSession_fkey"
  FOREIGN KEY ("cashierSessionId", "eventId", "dataMode")
  REFERENCES "CashierSession"("id", "eventId", "dataMode")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "ValueVoucherAllocation"
  ADD CONSTRAINT "ValueVoucherAllocation_movementId_fkey"
  FOREIGN KEY ("movementId") REFERENCES "ValueVoucherMovement"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ValueVoucherAllocation"
  ADD CONSTRAINT "ValueVoucherAllocation_orderItemId_fkey"
  FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PrintJob"
  ADD COLUMN "valueVoucherMovementId" TEXT,
  ADD COLUMN "sourceKey" VARCHAR(128);
CREATE UNIQUE INDEX "PrintJob_sourceKey_key" ON "PrintJob"("sourceKey");
CREATE INDEX "PrintJob_valueVoucherMovementId_idx"
  ON "PrintJob"("valueVoucherMovementId");
ALTER TABLE "PrintJob"
  ADD CONSTRAINT "PrintJob_valueVoucherMovementId_fkey"
  FOREIGN KEY ("valueVoucherMovementId") REFERENCES "ValueVoucherMovement"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx"
  ON "AuditLog"("entityType", "entityId", "createdAt");
CREATE INDEX "AuditLog_action_createdAt_idx"
  ON "AuditLog"("action", "createdAt");

COMMIT;
