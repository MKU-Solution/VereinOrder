import { Module } from "@nestjs/common";
import { OrdersService } from "./orders.service";
import { OrdersController } from "./orders.controller";
import { OrderSubmissionExceptionFilter } from "./order-submission-exception.filter";
import { InventoryModule } from "../inventory/inventory.module";

@Module({
  imports: [InventoryModule],
  providers: [OrdersService, OrderSubmissionExceptionFilter],
  controllers: [OrdersController],
})
export class OrdersModule {}
