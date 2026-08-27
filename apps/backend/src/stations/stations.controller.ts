import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  ParseUUIDPipe,
  UseGuards,
  Optional,
} from "@nestjs/common";
import { StationsService } from "./stations.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import {
  CreateStationDto,
  UpdateOrderItemStatusDto,
  UpdateStationDto,
} from "./dto/station.dto";
import { RealtimeService } from "../realtime/realtime.service";

@Controller("stations")
@UseGuards(JwtAuthGuard, RolesGuard)
export class StationsController {
  constructor(
    private readonly stationsService: StationsService,
    @Optional() private readonly realtimeService?: RealtimeService,
  ) {}

  @Get()
  @Roles("ADMINISTRATOR", "STATION", "WAITER")
  async findAll() {
    return this.stationsService.findAllActive();
  }

  @Get(":id/items")
  @Roles("ADMINISTRATOR", "STATION", "WAITER")
  async getPendingItems(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
  ) {
    return this.stationsService.getPendingItems(id);
  }

  @Get("admin/all")
  @Roles("ADMINISTRATOR", "EVENT_MANAGER")
  async findAllAdmin(
    @Query("eventId", new ParseUUIDPipe({ version: "4" })) eventId: string,
  ) {
    return this.stationsService.findAllAdmin(eventId);
  }

  @Post()
  @Roles("ADMINISTRATOR", "EVENT_MANAGER")
  async create(@Body() data: CreateStationDto) {
    return this.stationsService.create(data);
  }

  @Patch(":id")
  @Roles("ADMINISTRATOR", "EVENT_MANAGER")
  async update(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body() data: UpdateStationDto,
  ) {
    return this.stationsService.update(id, data);
  }
  @Patch("items/:itemId/status")
  @Roles("ADMINISTRATOR", "STATION", "WAITER")
  async updateItemStatus(
    @Param("itemId", new ParseUUIDPipe({ version: "4" })) itemId: string,
    @Body() data: UpdateOrderItemStatusDto,
  ) {
    const item = await this.stationsService.updateItemStatus(
      itemId,
      data.status,
    );
    if (item?.order?.eventId && item.order.areaId && item.order.tableName) {
      this.realtimeService?.broadcast(
        item.order.eventId,
        "TABLE_STATUS_CHANGED",
        { areaId: item.order.areaId, tableName: item.order.tableName },
      );
    }
    return item;
  }
}
