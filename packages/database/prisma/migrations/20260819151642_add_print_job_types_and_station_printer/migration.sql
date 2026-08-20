-- CreateEnum
CREATE TYPE "PrintJobType" AS ENUM ('STATION_TICKET', 'PRODUCT_VOUCHER', 'RECEIPT', 'CASHIER_CLOSING');

-- AlterTable
ALTER TABLE "PrintJob" ADD COLUMN     "jobType" "PrintJobType" NOT NULL DEFAULT 'STATION_TICKET';

-- AlterTable
ALTER TABLE "Station" ADD COLUMN     "printerId" TEXT;

-- AddForeignKey
ALTER TABLE "Station" ADD CONSTRAINT "Station_printerId_fkey" FOREIGN KEY ("printerId") REFERENCES "Printer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
