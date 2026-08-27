import {
  Controller,
  Get,
  Patch,
  Param,
  ParseUUIDPipe,
  Query,
  Request,
  UseGuards,
  Optional,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { RunnerService } from "./runner.service";
import { RealtimeService } from "../realtime/realtime.service";

@Controller("runner")
@UseGuards(JwtAuthGuard, RolesGuard)
export class RunnerController {
  constructor(
    private readonly runnerService: RunnerService,
    @Optional() private readonly realtimeService?: RealtimeService,
  ) {}

  private broadcastTableStatus(order: any) {
    if (!order?.eventId || !order?.areaId || !order?.tableName) return;
    this.realtimeService?.broadcast(order.eventId, "TABLE_STATUS_CHANGED", {
      areaId: order.areaId,
      tableName: order.tableName,
    });
  }

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
  async claimOrder(
    @Request() req: any,
    @Param("orderId", new ParseUUIDPipe({ version: "4" })) orderId: string,
  ) {
    const order = await this.runnerService.claimOrder(req.user, orderId);
    this.broadcastTableStatus(order);
    return order;
  }

  @Patch("orders/:orderId/deliver")
  @Roles("RUNNER", "ADMINISTRATOR")
  async deliverOrder(
    @Request() req: any,
    @Param("orderId", new ParseUUIDPipe({ version: "4" })) orderId: string,
  ) {
    const order = await this.runnerService.deliverOrder(req.user, orderId);
    this.broadcastTableStatus(order);
    return order;
  }
}
