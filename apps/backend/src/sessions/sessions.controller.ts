import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Query,
  Param,
  UseGuards,
  Request,
} from "@nestjs/common";
import { SessionsService } from "./sessions.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMINISTRATOR", "WAITER", "CASHIER")
@Controller("sessions")
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Get("context")
  async getContext(@Request() req: any) {
    return this.sessionsService.getContext(req.user.userId);
  }

  @Get("active")
  async getActiveSession(
    @Request() req: any,
    @Query("eventId") eventId: string,
  ) {
    if (!eventId) throw new BadRequestException("eventId required");
    return this.sessionsService.getActiveSession(req.user.userId, eventId);
  }

  @Post()
  async startSession(
    @Request() req: any,
    @Body() body: { eventId: string; startingBalance: number },
  ) {
    return this.sessionsService.startSession(
      req.user.userId,
      body.eventId,
      body.startingBalance,
    );
  }

  @Get(":id/summary")
  async getSummary(@Request() req: any, @Param("id") id: string) {
    return this.sessionsService.getSummary(id, req.user.userId);
  }

  @Patch(":id/close")
  async closeSession(
    @Request() req: any,
    @Param("id") id: string,
    @Body() body: { closingBalance: number },
  ) {
    return this.sessionsService.closeSession(
      id,
      req.user.userId,
      body.closingBalance,
    );
  }
}
