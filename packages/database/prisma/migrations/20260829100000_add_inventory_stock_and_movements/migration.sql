-- Issue #141: Nachvollziehbare Bestandsfuehrung je Produkt, Veranstaltung
-- und Betriebsart. Die bestehende Product.availability-Spalte bleibt bewusst
-- unveraendert erhalten und wird im Prisma-Modell als manualAvailability
-- abgebildet. Dadurch gehen bestehende manuelle Overrides nicht verloren und
-- es werden insbesondere keine historischen Mengen erfunden.
BEGIN;

CREATE TYPE "InventoryMovementType" AS ENUM (
  'INITIALIZATION',
  'SALE',
  'CANCELLATION',
  'CORRECTION'
);

CREATE UNIQUE INDEX "Product_id_eventId_key"
  ON "Product"("id", "eventId");
CREATE UNIQUE INDEX "OrderItem_id_orderId_productId_key"
  ON "OrderItem"("id", "orderId", "productId");

CREATE TABLE "InventoryStock" (
  "productId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "dataMode" "OperationalDataMode" NOT NULL,
  "trackingEnabled" BOOLEAN NOT NULL DEFAULT false,
  "initialQuantity" INTEGER NOT NULL DEFAULT 0,
  "stockQuantity" INTEGER NOT NULL DEFAULT 0,
  "lowStockThreshold" INTEGER NOT NULL DEFAULT 0,
  "manualBlocked" BOOLEAN NOT NULL DEFAULT false,
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "InventoryStock_pkey"
    PRIMARY KEY ("productId", "eventId", "dataMode"),
  CONSTRAINT "InventoryStock_quantities_nonnegative_check"
    CHECK (
      "initialQuantity" BETWEEN 0 AND 2147483647
      AND "stockQuantity" BETWEEN 0 AND 2147483647
      AND "lowStockThreshold" BETWEEN 0 AND 2147483647
      AND "version" BETWEEN 0 AND 2147483647
    ),
  CONSTRAINT "InventoryStock_untracked_zero_check"
    CHECK (
      "trackingEnabled"
      OR (
        "initialQuantity" = 0
        AND "stockQuantity" = 0
        AND "lowStockThreshold" = 0
      )
    )
);

CREATE TABLE "InventoryMovement" (
  "id" TEXT NOT NULL,
  "type" "InventoryMovementType" NOT NULL,
  "quantityDelta" INTEGER NOT NULL,
  "quantityBefore" INTEGER NOT NULL,
  "quantityAfter" INTEGER NOT NULL,
  "productId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "dataMode" "OperationalDataMode" NOT NULL,
  "orderId" TEXT,
  "orderItemId" TEXT,
  "reversesMovementId" TEXT,
  "actorUserId" TEXT NOT NULL,
  "reason" VARCHAR(500),
  "idempotencyKey" VARCHAR(128) NOT NULL,
  "requestFingerprint" VARCHAR(64) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InventoryMovement_quantity_chain_check"
    CHECK (
      "quantityBefore" BETWEEN 0 AND 2147483647
      AND "quantityAfter" BETWEEN 0 AND 2147483647
      AND "quantityAfter"::bigint =
        "quantityBefore"::bigint + "quantityDelta"::bigint
    ),
  CONSTRAINT "InventoryMovement_reason_check"
    CHECK (
      "reason" IS NULL
      OR (length(btrim("reason")) BETWEEN 1 AND 500)
    ),
  CONSTRAINT "InventoryMovement_idempotencyKey_check"
    CHECK (length(btrim("idempotencyKey")) BETWEEN 1 AND 128),
  CONSTRAINT "InventoryMovement_requestFingerprint_check"
    CHECK ("requestFingerprint" ~ '^[0-9a-fA-F]{64}$'),
  CONSTRAINT "InventoryMovement_not_self_reversal_check"
    CHECK ("reversesMovementId" IS NULL OR "reversesMovementId" <> "id"),
  CONSTRAINT "InventoryMovement_type_fields_check"
    CHECK (
      ("type" = 'INITIALIZATION'
        AND "quantityBefore" = 0
        AND "quantityDelta" >= 0
        AND "quantityAfter" = "quantityDelta"
        AND "orderId" IS NULL
        AND "orderItemId" IS NULL
        AND "reversesMovementId" IS NULL)
      OR ("type" = 'SALE'
        AND "quantityDelta" < 0
        AND "orderId" IS NOT NULL
        AND "orderItemId" IS NOT NULL
        AND "reversesMovementId" IS NULL)
      OR ("type" = 'CANCELLATION'
        AND "quantityDelta" > 0
        AND "orderId" IS NOT NULL
        AND "orderItemId" IS NOT NULL
        AND "reversesMovementId" IS NOT NULL)
      OR ("type" = 'CORRECTION'
        AND "quantityDelta" <> 0
        AND "orderId" IS NULL
        AND "orderItemId" IS NULL
        AND "reversesMovementId" IS NULL
        AND "reason" IS NOT NULL
        AND length(btrim("reason")) > 0)
    )
);

CREATE INDEX "InventoryStock_eventId_dataMode_idx"
  ON "InventoryStock"("eventId", "dataMode");
CREATE INDEX "InventoryStock_eventId_dataMode_trackingEnabled_manualBlock_idx"
  ON "InventoryStock"(
    "eventId", "dataMode", "trackingEnabled", "manualBlocked"
  );

CREATE UNIQUE INDEX "InventoryMovement_idempotencyKey_key"
  ON "InventoryMovement"("idempotencyKey");
CREATE UNIQUE INDEX "InventoryMovement_reversesMovementId_key"
  ON "InventoryMovement"("reversesMovementId");
CREATE UNIQUE INDEX "InventoryMovement_id_productId_eventId_dataMode_key"
  ON "InventoryMovement"("id", "productId", "eventId", "dataMode");
CREATE INDEX "InventoryMovement_productId_eventId_dataMode_createdAt_id_idx"
  ON "InventoryMovement"(
    "productId", "eventId", "dataMode", "createdAt", "id"
  );
CREATE INDEX "InventoryMovement_eventId_dataMode_type_createdAt_idx"
  ON "InventoryMovement"("eventId", "dataMode", "type", "createdAt");
CREATE INDEX "InventoryMovement_orderId_type_idx"
  ON "InventoryMovement"("orderId", "type");
CREATE INDEX "InventoryMovement_orderItemId_type_idx"
  ON "InventoryMovement"("orderItemId", "type");
CREATE INDEX "InventoryMovement_actorUserId_createdAt_idx"
  ON "InventoryMovement"("actorUserId", "createdAt");

ALTER TABLE "InventoryStock"
  ADD CONSTRAINT "InventoryStock_productId_eventId_fkey"
  FOREIGN KEY ("productId", "eventId")
  REFERENCES "Product"("id", "eventId")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "InventoryStock"
  ADD CONSTRAINT "InventoryStock_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "InventoryMovement"
  ADD CONSTRAINT "InventoryMovement_productId_eventId_dataMode_fkey"
  FOREIGN KEY ("productId", "eventId", "dataMode")
  REFERENCES "InventoryStock"("productId", "eventId", "dataMode")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "InventoryMovement"
  ADD CONSTRAINT "InventoryMovement_orderId_eventId_dataMode_fkey"
  FOREIGN KEY ("orderId", "eventId", "dataMode")
  REFERENCES "Order"("id", "eventId", "dataMode")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "InventoryMovement"
  ADD CONSTRAINT "InventoryMovement_orderItemId_orderId_productId_fkey"
  FOREIGN KEY ("orderItemId", "orderId", "productId")
  REFERENCES "OrderItem"("id", "orderId", "productId")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "InventoryMovement"
  ADD CONSTRAINT "InventoryMovement_reversesMovementId_productId_eventId_dat_fkey"
  FOREIGN KEY (
    "reversesMovementId", "productId", "eventId", "dataMode"
  )
  REFERENCES "InventoryMovement"("id", "productId", "eventId", "dataMode")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "InventoryMovement"
  ADD CONSTRAINT "InventoryMovement_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

-- Bewegungen sind ein Ledger und duerfen durch normale Anwendungspfade nie
-- nachtraeglich veraendert oder geloescht werden. Der Legacy-JSON-Restore
-- setzt die Ausnahme ausschließlich per SET LOCAL innerhalb seiner
-- Wiederherstellungstransaktion.
CREATE FUNCTION "guard_inventory_movement_append_only"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('vereinorder.inventory_restore', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'InventoryMovement is append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "InventoryMovement_append_only_trigger"
BEFORE UPDATE OR DELETE ON "InventoryMovement"
FOR EACH ROW EXECUTE FUNCTION "guard_inventory_movement_append_only"();

-- Eine begonnene Bestandsfuehrung kann weder deaktiviert noch geloescht
-- werden. Mengen werden danach ausschließlich transaktional samt Ledger
-- geaendert. Unbenutzte, noch nicht aktivierte Zeilen duerfen entfernt werden.
CREATE FUNCTION "guard_initialized_inventory_stock"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('vereinorder.inventory_restore', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' AND OLD."trackingEnabled" THEN
    RAISE EXCEPTION 'Initialized InventoryStock cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD."trackingEnabled"
     AND NOT NEW."trackingEnabled" THEN
    RAISE EXCEPTION 'Inventory tracking cannot be disabled after initialization'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "InventoryStock_initialized_guard_trigger"
BEFORE UPDATE OR DELETE ON "InventoryStock"
FOR EACH ROW EXECUTE FUNCTION "guard_initialized_inventory_stock"();

COMMIT;
