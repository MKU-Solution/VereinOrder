-- Add the dedicated delivery role without changing existing user assignments.
ALTER TYPE "Role" ADD VALUE 'RUNNER';

-- Track the hand-off between preparation and completed delivery explicitly.
ALTER TYPE "OrderItemStatus" ADD VALUE 'IN_DELIVERY';

ALTER TABLE "Order"
ADD COLUMN "areaId" TEXT,
ADD COLUMN "claimedByUserId" TEXT,
ADD COLUMN "claimedAt" TIMESTAMP(3);

CREATE INDEX "Order_claimedByUserId_idx" ON "Order"("claimedByUserId");
CREATE INDEX "Order_eventId_fulfillmentStatus_areaId_idx"
ON "Order"("eventId", "fulfillmentStatus", "areaId");

ALTER TABLE "Order"
ADD CONSTRAINT "Order_areaId_fkey"
FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Order"
ADD CONSTRAINT "Order_claimedByUserId_fkey"
FOREIGN KEY ("claimedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
