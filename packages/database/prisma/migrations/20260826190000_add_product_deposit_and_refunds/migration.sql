-- AlterTable Product
ALTER TABLE "Product" ADD COLUMN "deposit" INTEGER NOT NULL DEFAULT 0;

-- AlterTable ProductCategory
ALTER TABLE "ProductCategory" ADD COLUMN "deposit" INTEGER NOT NULL DEFAULT 0;

-- AlterTable OrderItem
ALTER TABLE "OrderItem" ADD COLUMN "depositAtTime" INTEGER NOT NULL DEFAULT 0;

-- AlterTable Order
ALTER TABLE "Order" ADD COLUMN "depositRefundTotal" INTEGER NOT NULL DEFAULT 0;

-- Geldbeträge dürfen auch bei direkten Datenbankzugriffen keine negativen
-- Werte annehmen. Die API validiert dieselbe Invariante zusätzlich.
ALTER TABLE "Product" ADD CONSTRAINT "Product_deposit_nonnegative_check"
  CHECK ("deposit" >= 0);

ALTER TABLE "ProductCategory" ADD CONSTRAINT "ProductCategory_deposit_nonnegative_check"
  CHECK ("deposit" >= 0);

ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_depositAtTime_nonnegative_check"
  CHECK ("depositAtTime" >= 0);

ALTER TABLE "Order" ADD CONSTRAINT "Order_depositRefundTotal_nonnegative_check"
  CHECK ("depositRefundTotal" >= 0);
