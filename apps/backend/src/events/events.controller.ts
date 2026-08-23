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
import { IdParamDto, SourceIdParamDto } from "../common/validation/request.dto";
import {
  ActivateEventDto,
  ChangeEventStatusDto,
  CleanTestDataDto,
  CopyAssortmentDto,
  CreateEventDto,
  DuplicateEventDto,
  EventConfigImportPayload,
  UpdateEventDto,
} from "./events.dto";

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
  async findOne(@Param() params: IdParamDto) {
    return this.eventsService.findOne(params.id);
  }

  @Post(":sourceId/duplicate")
  @Roles("ADMINISTRATOR")
  async duplicate(
    @Request() req,
    @Param() params: SourceIdParamDto,
    @Body() body: DuplicateEventDto,
    @Headers("idempotency-key") idempotencyKey: string,
  ) {
    return this.eventsService.duplicate(
      params.sourceId,
      req.user?.userId,
      idempotencyKey,
      body,
    );
  }

  @Post(":sourceId/assortment-copy")
  @Roles("ADMINISTRATOR")
  async copyAssortment(
    @Request() req,
    @Param() params: SourceIdParamDto,
    @Body() body: CopyAssortmentDto,
    @Headers("idempotency-key") idempotencyKey: string,
  ) {
    return this.eventsService.copyAssortment(
      params.sourceId,
      req.user?.userId,
      idempotencyKey,
      body,
    );
  }

  @Get(":id/config-export")
  @Roles("ADMINISTRATOR")
  async exportConfig(@Param() params: IdParamDto) {
    return this.eventsService.exportConfig(params.id);
  }

  @Post("config-import")
  @Roles("ADMINISTRATOR")
  async importConfig(
    @Request() req,
    // Der versionsabhaengige Payload wird ausschliesslich vom bestehenden
    // EventsService-Parser validiert und darf hier nicht vorzeitig whitelisted werden.
    @Body() body: EventConfigImportPayload,
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
  async testDataSummary(@Param() params: IdParamDto) {
    return this.eventsService.testDataSummary(params.id);
  }

  @Post()
  async create(@Request() req, @Body() data: CreateEventDto) {
    const userId = req.user?.userId;
    return this.eventsService.create(data, userId);
  }

  @Patch(":id")
  async update(
    @Request() req,
    @Param() params: IdParamDto,
    @Body() data: UpdateEventDto,
  ) {
    const userId = req.user?.userId;
    return this.eventsService.update(params.id, data, userId);
  }

  @Post(":id/activate")
  async activate(
    @Request() req,
    @Param() params: IdParamDto,
    @Body() body: ActivateEventDto,
  ) {
    const userId = req.user?.userId;
    return this.eventsService.activate(
      params.id,
      userId,
      body.confirmed,
      body.disclaimerVersion || "1.0",
    );
  }

  @Patch(":id/status")
  async changeStatus(
    @Request() req,
    @Param() params: IdParamDto,
    @Body() body: ChangeEventStatusDto,
  ) {
    const userId = req.user?.userId;
    return this.eventsService.changeStatus(params.id, body.status, userId);
  }

  @Post(":id/clean-test-data")
  @Roles("ADMINISTRATOR")
  async cleanTestData(
    @Request() req,
    @Param() params: IdParamDto,
    @Body() body: CleanTestDataDto,
    @Headers("idempotency-key") idempotencyKey: string,
  ) {
    const userId = req.user?.userId;
    return this.eventsService.cleanTestData(
      params.id,
      userId,
      body.confirmationName,
      idempotencyKey,
    );
  }

  @Delete(":id")
  async remove(@Request() req, @Param() params: IdParamDto) {
    const userId = req.user?.userId;
    return this.eventsService.remove(params.id, userId);
  }
}
