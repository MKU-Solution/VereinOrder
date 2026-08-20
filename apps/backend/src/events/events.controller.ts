import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Headers,
  UseGuards,
  Request,
} from "@nestjs/common";
import { EventsService } from "./events.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { EventStatus } from "@vereinorder/database";

@Controller("events")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMINISTRATOR", "EVENT_MANAGER")
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get()
  async findAll() {
    return this.eventsService.findAll();
  }

  @Get(":id")
  async findOne(@Param("id") id: string) {
    return this.eventsService.findOne(id);
  }

  @Post(":sourceId/duplicate")
  @Roles("ADMINISTRATOR")
  async duplicate(
    @Request() req,
    @Param("sourceId") sourceId: string,
    @Body() body: { name?: string },
    @Headers("idempotency-key") idempotencyKey: string,
  ) {
    return this.eventsService.duplicate(
      sourceId,
      req.user?.userId,
      idempotencyKey,
      body,
    );
  }

  @Post(":sourceId/assortment-copy")
  @Roles("ADMINISTRATOR")
  async copyAssortment(
    @Request() req,
    @Param("sourceId") sourceId: string,
    @Body()
    body: {
      targetEventId: string;
      stationMappings: Record<string, string | null>;
    },
    @Headers("idempotency-key") idempotencyKey: string,
  ) {
    return this.eventsService.copyAssortment(
      sourceId,
      req.user?.userId,
      idempotencyKey,
      body,
    );
  }

  @Get(":id/config-export")
  @Roles("ADMINISTRATOR")
  async exportConfig(@Param("id") id: string) {
    return this.eventsService.exportConfig(id);
  }

  @Post("config-import")
  @Roles("ADMINISTRATOR")
  async importConfig(
    @Request() req,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: string,
  ) {
    return this.eventsService.importConfig(
      req.user?.userId,
      idempotencyKey,
      body,
    );
  }

  @Get(":id/test-data-summary")
  @Roles("ADMINISTRATOR")
  async testDataSummary(@Param("id") id: string) {
    return this.eventsService.testDataSummary(id);
  }

  @Post()
  async create(@Request() req, @Body() data: any) {
    const userId = req.user?.userId;
    return this.eventsService.create(data, userId);
  }

  @Patch(":id")
  async update(@Request() req, @Param("id") id: string, @Body() data: any) {
    const userId = req.user?.userId;
    return this.eventsService.update(id, data, userId);
  }

  @Post(":id/activate")
  async activate(
    @Request() req,
    @Param("id") id: string,
    @Body("confirmed") confirmed: boolean,
    @Body("disclaimerVersion") disclaimerVersion?: string,
  ) {
    const userId = req.user?.userId;
    return this.eventsService.activate(
      id,
      userId,
      confirmed,
      disclaimerVersion || "1.0",
    );
  }

  @Patch(":id/status")
  async changeStatus(
    @Request() req,
    @Param("id") id: string,
    @Body("status") status: EventStatus,
  ) {
    const userId = req.user?.userId;
    return this.eventsService.changeStatus(id, status, userId);
  }

  @Post(":id/clean-test-data")
  @Roles("ADMINISTRATOR")
  async cleanTestData(
    @Request() req,
    @Param("id") id: string,
    @Body("confirmationName") confirmationName: string,
    @Headers("idempotency-key") idempotencyKey: string,
  ) {
    const userId = req.user?.userId;
    return this.eventsService.cleanTestData(
      id,
      userId,
      confirmationName,
      idempotencyKey,
    );
  }

  @Delete(":id")
  async remove(@Request() req, @Param("id") id: string) {
    const userId = req.user?.userId;
    return this.eventsService.remove(id, userId);
  }
}
