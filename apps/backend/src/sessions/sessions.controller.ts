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
import { MaintenanceBlockedDuringDraining } from "../maintenance/maintenance.decorator";
import { IdParamDto } from "../common/validation/request.dto";
import { CloseSessionDto, StartSessionDto } from "./dto/sessions.dto";

interface AuthenticatedRequest {
  user: { userId: string };
}

// Issue #66, Stationskasse: STATION ergänzt, sonst kann diese Rolle keine
// eigene Kassensitzung öffnen - ohne Sitzung weist createQuickSale jeden
// Verkauf ab (siehe orders.service.ts), und der Stationsmodus wäre für
// STATION unbenutzbar. Jede Methode dieses Controllers scoped bereits
// serverseitig auf den eigenen Benutzer (SessionsService: getContext und
// getActiveSession liefern nur die eigenen Sitzungen, getSummary und
// closeSession lehnen eine fremde Sitzung mit "Not your session" ab) -
// STATION bekommt dadurch keinen Zugriff auf fremde Kassensitzungen, nur
// auf ihre eigenen, wie jede andere Rolle hier auch.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMINISTRATOR", "WAITER", "CASHIER", "STATION")
@Controller("sessions")
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  // Issue #67 (Wartungsmodus), Entscheidung der Projektleitung Runde 2:
  // dieser Endpunkt bleibt auch in DRAINING gesperrt, nicht erst ab LOCKED -
  // siehe die Begründung bei @MaintenanceBlockedDuringDraining().
  @MaintenanceBlockedDuringDraining()
  @Get("context")
  async getContext(@Request() req: AuthenticatedRequest) {
    return this.sessionsService.getContext(req.user.userId);
  }

  @Get("active")
  async getActiveSession(
    @Request() req: AuthenticatedRequest,
    @Query("eventId") eventId: string,
  ) {
    if (!eventId) throw new BadRequestException("eventId required");
    return this.sessionsService.getActiveSession(req.user.userId, eventId);
  }

  @Post()
  async startSession(
    @Request() req: AuthenticatedRequest,
    @Body() body: StartSessionDto,
  ) {
    return this.sessionsService.startSession(
      req.user.userId,
      body.eventId,
      body.startingBalance,
    );
  }

  @Get(":id/summary")
  async getSummary(
    @Request() req: AuthenticatedRequest,
    @Param() params: IdParamDto,
  ) {
    return this.sessionsService.getSummary(params.id, req.user.userId);
  }

  @Patch(":id/close")
  async closeSession(
    @Request() req: AuthenticatedRequest,
    @Param() params: IdParamDto,
    @Body() body: CloseSessionDto,
  ) {
    return this.sessionsService.closeSession(
      params.id,
      req.user.userId,
      body.closingBalance,
    );
  }
}
