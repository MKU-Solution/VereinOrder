import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  Request,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { RunnerService } from "./runner.service";

@Controller("runner")
@UseGuards(JwtAuthGuard, RolesGuard)
export class RunnerController {
  constructor(private readonly runnerService: RunnerService) {}

  @Get("context")
  @Roles("RUNNER", "ADMINISTRATOR")
  context(@Query("eventId") eventId?: string) {
    return this.runnerService.getContext(eventId);
  }

  @Get("orders")
  @Roles("RUNNER", "ADMINISTRATOR")
  listOrders(
    @Request() req: any,
    @Query("eventId") eventId?: string,
    @Query("areaId") areaId?: string,
  ) {
    return this.runnerService.listOrders(req.user, eventId, areaId);
  }

  @Get("orders/mine")
  @Roles("RUNNER", "ADMINISTRATOR")
  listMine(
    @Request() req: any,
    @Query("eventId") eventId?: string,
    @Query("areaId") areaId?: string,
  ) {
    return this.runnerService.listMine(req.user, eventId, areaId);
  }

  @Patch("orders/:orderId/claim")
  @Roles("RUNNER", "ADMINISTRATOR")
  claimOrder(@Request() req: any, @Param("orderId") orderId: string) {
    return this.runnerService.claimOrder(req.user, orderId);
  }

  @Patch("orders/:orderId/deliver")
  @Roles("RUNNER", "ADMINISTRATOR")
  deliverOrder(@Request() req: any, @Param("orderId") orderId: string) {
    return this.runnerService.deliverOrder(req.user, orderId);
  }
}
