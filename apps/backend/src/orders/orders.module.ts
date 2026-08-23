import { Module } from "@nestjs/common";
import { OrdersService } from "./orders.service";
import { OrdersController } from "./orders.controller";
import { OrderSubmissionExceptionFilter } from "./order-submission-exception.filter";

@Module({
  providers: [OrdersService, OrderSubmissionExceptionFilter],
  controllers: [OrdersController],
})
export class OrdersModule {}
