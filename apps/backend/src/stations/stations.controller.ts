import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
} from "@nestjs/common";
import { StationsService } from "./stations.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";

@Controller("stations")
@UseGuards(JwtAuthGuard, RolesGuard)
export class StationsController {
  constructor(private readonly stationsService: StationsService) {}

  @Get()
  @Roles("ADMINISTRATOR", "STATION", "WAITER")
  async findAll() {
    return this.stationsService.findAllActive();
  }

  @Get(":id/items")
  @Roles("ADMINISTRATOR", "STATION", "WAITER")
  async getPendingItems(@Param("id") id: string) {
    return this.stationsService.getPendingItems(id);
  }

  @Get("admin/all")
  @Roles("ADMINISTRATOR", "EVENT_MANAGER")
  async findAllAdmin(@Query("eventId") eventId: string) {
    return this.stationsService.findAllAdmin(eventId);
  }

  @Post()
  @Roles("ADMINISTRATOR", "EVENT_MANAGER")
  async create(@Body() data: any) {
    return this.stationsService.create(data);
  }

  @Patch(":id")
  @Roles("ADMINISTRATOR", "EVENT_MANAGER")
  async update(@Param("id") id: string, @Body() data: any) {
    return this.stationsService.update(id, data);
  }
  @Patch("items/:itemId/status")
  @Roles("ADMINISTRATOR", "STATION", "WAITER")
  async updateItemStatus(
    @Param("itemId") itemId: string,
    @Body("status") status: string,
  ) {
    return this.stationsService.updateItemStatus(itemId, status);
  }
}
