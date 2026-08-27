import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  ParseUUIDPipe,
  UseGuards,
} from "@nestjs/common";
import { AreasService } from "./areas.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CreateAreaDto, SaveFloorPlanDto, UpdateAreaDto } from "./dto/area.dto";

@Controller("areas")
@UseGuards(JwtAuthGuard, RolesGuard)
export class AreasController {
  constructor(private readonly areasService: AreasService) {}

  @Get()
  @Roles("ADMINISTRATOR", "EVENT_MANAGER", "WAITER", "CASHIER", "STATION")
  async findAll(
    @Query("eventId", new ParseUUIDPipe({ version: "4" })) eventId: string,
  ) {
    return this.areasService.findAll(eventId);
  }

  @Get("floor-plans")
  @Roles("ADMINISTRATOR", "EVENT_MANAGER", "WAITER", "CASHIER", "RUNNER")
  async findFloorPlans(
    @Query("eventId", new ParseUUIDPipe({ version: "4" })) eventId: string,
  ) {
    return this.areasService.findFloorPlans(eventId);
  }

  @Put(":id/floor-plan")
  @Roles("ADMINISTRATOR", "EVENT_MANAGER")
  async saveFloorPlan(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body() data: SaveFloorPlanDto,
  ) {
    return this.areasService.saveFloorPlan(id, data);
  }

  @Post()
  @Roles("ADMINISTRATOR", "EVENT_MANAGER")
  async create(@Body() data: CreateAreaDto) {
    return this.areasService.create(data);
  }

  @Patch(":id")
  @Roles("ADMINISTRATOR", "EVENT_MANAGER")
  async update(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body() data: UpdateAreaDto,
  ) {
    return this.areasService.update(id, data);
  }

  @Delete(":id")
  @Roles("ADMINISTRATOR", "EVENT_MANAGER")
  async remove(@Param("id", new ParseUUIDPipe({ version: "4" })) id: string) {
    return this.areasService.remove(id);
  }
}
