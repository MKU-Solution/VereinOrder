import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Request,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import {
  CancelValueVoucherDto,
  IssueValueVoucherDto,
  RedeemValueVoucherDto,
  ValueVoucherQueryDto,
} from "./dto/value-vouchers.dto";
import { ValueVouchersService } from "./value-vouchers.service";

interface AuthenticatedRequest {
  user: { userId: string; role: string };
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("value-vouchers")
export class ValueVouchersController {
  constructor(private readonly valueVouchers: ValueVouchersService) {}

  @Post()
  @Roles("ADMINISTRATOR", "CASHIER")
  issue(
    @Request() req: AuthenticatedRequest,
    @Body() body: IssueValueVoucherDto,
  ) {
    return this.valueVouchers.issue(req.user.userId, req.user.role, body);
  }

  @Get("quote")
  @Roles("ADMINISTRATOR", "CASHIER", "WAITER")
  quote(
    @Request() req: AuthenticatedRequest,
    @Query() query: ValueVoucherQueryDto,
  ) {
    return this.valueVouchers.quote(req.user.userId, req.user.role, query);
  }

  @Post("redeem")
  @Roles("ADMINISTRATOR", "CASHIER", "WAITER")
  redeem(
    @Request() req: AuthenticatedRequest,
    @Body() body: RedeemValueVoucherDto,
  ) {
    return this.valueVouchers.redeem(req.user.userId, req.user.role, body);
  }

  @Get("history")
  @Roles("ADMINISTRATOR", "EVENT_MANAGER", "REVISION")
  history(
    @Request() req: AuthenticatedRequest,
    @Query() query: ValueVoucherQueryDto,
  ) {
    return this.valueVouchers.history(req.user.userId, req.user.role, query);
  }

  @Post("cancel")
  @Roles("ADMINISTRATOR", "EVENT_MANAGER", "REVISION")
  cancel(
    @Request() req: AuthenticatedRequest,
    @Body() body: CancelValueVoucherDto,
  ) {
    return this.valueVouchers.cancel(req.user.userId, req.user.role, body);
  }
}
