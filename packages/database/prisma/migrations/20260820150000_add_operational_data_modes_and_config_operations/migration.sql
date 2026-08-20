CREATE TYPE "OperationalDataMode" AS ENUM ('TEST', 'LIVE');

ALTER TABLE "Order" ADD COLUMN "dataMode" "OperationalDataMode";
ALTER TABLE "CashierSession" ADD COLUMN "dataMode" "OperationalDataMode";

-- Historic records predate the separation and are deliberately retained as live data.
UPDATE "Order" SET "dataMode" = 'LIVE' WHERE "dataMode" IS NULL;
UPDATE "CashierSession" SET "dataMode" = 'LIVE' WHERE "dataMode" IS NULL;

ALTER TABLE "Order" ALTER COLUMN "dataMode" SET NOT NULL;
ALTER TABLE "CashierSession" ALTER COLUMN "dataMode" SET NOT NULL;

CREATE INDEX "Order_eventId_dataMode_idx" ON "Order"("eventId", "dataMode");
CREATE INDEX "CashierSession_eventId_dataMode_idx" ON "CashierSession"("eventId", "dataMode");

CREATE TABLE "ConfigOperation" (
  "id" TEXT NOT NULL,
  "scopeId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "response" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConfigOperation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ConfigOperation_scopeId_action_idempotencyKey_key"
  ON "ConfigOperation"("scopeId", "action", "idempotencyKey");
