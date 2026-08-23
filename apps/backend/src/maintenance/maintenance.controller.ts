import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Request,
  UseGuards,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { MaintenanceService } from "./maintenance.service";
import { MaintenancePublic } from "./maintenance.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import {
  MaintenanceState,
  PublicMaintenanceState,
  toPublicMaintenanceState,
} from "./maintenance.types";
import { StartMaintenanceDto } from "./maintenance.dto";

/**
 * `@MaintenancePublic()` auf Klassenebene nimmt den GESAMTEN Controller von
 * der Wartungssperre aus, wie `/backup/*`. Zwei Gründe:
 *
 * 1. `GET /maintenance` muss laut Entwurf unangemeldet und bei jeder Phase
 *    antworten — die Oberfläche braucht die Auskunft gerade dann.
 * 2. `POST /maintenance/end` ist der einzige Weg, den Wartungsmodus über die
 *    Anwendung wieder zu verlassen. Wäre diese Route selbst gesperrt, gäbe es
 *    aus LOCKED keinen Weg zurück außer einem händischen Eingriff an der
 *    Zustandsdatei — das widerspräche dem Zweck des Endpunkts. Das ist eine
 *    Ergänzung zur wörtlichen Ausnahmentabelle des Entwurfs (die nur
 *    `GET /maintenance` nennt), aus der Logik des Wartungsmodus selbst
 *    zwingend: ohne sie wäre der Ausstieg aus LOCKED nicht buchbar.
 *
 * `start`/`end` bleiben trotzdem hinter `JwtAuthGuard`/`RolesGuard`
 * (ADMINISTRATOR) — die Ausnahme gilt nur für den Wartungsguard, nicht für
 * Anmeldung und Rolle.
 */
@MaintenancePublic()
@Controller("maintenance")
export class MaintenanceController {
  constructor(
    private readonly maintenanceService: MaintenanceService,
    private readonly jwtService: JwtService,
  ) {}

  @Get()
  async getStatus(
    @Headers("authorization") authHeader?: string,
  ): Promise<MaintenanceState | PublicMaintenanceState> {
    const state = this.maintenanceService.getState();
    if (!this.isAuthenticated(authHeader)) {
      return toPublicMaintenanceState(state);
    }
    return state;
  }

  @Post("start")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("ADMINISTRATOR")
  async start(
    @Request() req: any,
    @Body() body: StartMaintenanceDto,
  ): Promise<MaintenanceState> {
    return this.maintenanceService.start(
      req.user.userId,
      req.user.username,
      body?.reason,
      body?.expectedUntil,
    );
  }

  @Post("end")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("ADMINISTRATOR")
  async end(@Request() req: any): Promise<MaintenanceState> {
    return this.maintenanceService.end(req.user.userId, req.user.username);
  }

  /**
   * "Eingeloggt" heißt hier: ein syntaktisch gültiges, korrekt signiertes und
   * nicht abgelaufenes Token — dieselbe Prüfung wie `JwtStrategy`, nur ohne
   * den Aufruf mit 401 abzulehnen, wenn es fehlt. Die Rolle spielt für die
   * Sichtbarkeit keine Rolle, nur der Nachweis einer bestehenden Anmeldung.
   */
  private isAuthenticated(authHeader?: string): boolean {
    if (!authHeader?.startsWith("Bearer ")) return false;
    try {
      this.jwtService.verify(authHeader.slice("Bearer ".length));
      return true;
    } catch {
      return false;
    }
  }
}
