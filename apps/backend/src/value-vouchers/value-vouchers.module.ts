import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { ValueVouchersController } from "./value-vouchers.controller";
import { ValueVouchersService } from "./value-vouchers.service";

@Module({
  imports: [AuditModule],
  providers: [ValueVouchersService],
  controllers: [ValueVouchersController],
  exports: [ValueVouchersService],
})
export class ValueVouchersModule {}
