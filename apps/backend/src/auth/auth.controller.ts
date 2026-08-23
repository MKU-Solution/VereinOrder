import {
  Controller,
  ForbiddenException,
  Post,
  Body,
  UnauthorizedException,
  HttpCode,
  HttpStatus,
  Request,
  UseGuards,
} from "@nestjs/common";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { MaintenancePublic } from "../maintenance/maintenance.decorator";

@Controller("auth")
export class AuthController {
  constructor(private authService: AuthService) {}

  // Issue #67: sonst kommt bei LOCKED niemand mehr herein, auch kein
  // Administrator, der den Wartungsmodus wieder beenden will.
  @MaintenancePublic()
  @HttpCode(HttpStatus.OK)
  @Post("login")
  async login(@Body() body: any) {
    const { username, pin } = body;
    const user = await this.authService.validateUser(username, pin);
    if (!user) {
      throw new UnauthorizedException("Ungültiger Benutzername oder PIN");
    }
    return this.authService.login(user);
  }

  // Issue #67, Entscheidung der Projektleitung Runde 2: Der Administrator
  // ist die einzige Person, die den Wartungsmodus beenden kann, und sein
  // Bildschirm sperrt sich nach Zeitablauf unverändert weiter (der
  // Auto-Lock-Zeitgeber in AppLayout kennt den Wartungsmodus nicht).
  // Entsperren läuft ausschließlich über diesen Weg - wäre er gesperrt,
  // müsste sich der Administrator mitten in einer Wiederherstellung
  // vollständig ab- und wieder anmelden, um an den Knopf zu kommen, der die
  // Wartung beendet: der Moment mit der geringsten Fehlertoleranz. Sicher-
  // heitlich unbedenklich, weil `/auth/switch` dieselbe PIN-Anmeldung ist
  // wie das bereits ausgenommene `/auth/login` - eine Anmeldefläche halb zu
  // sperren wäre nur eine Falle, kein Gewinn.
  @MaintenancePublic()
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @Post("switch")
  async switchUser(@Request() req: any, @Body() body: any) {
    const user = await this.authService.validateUser(body?.username, body?.pin);
    if (!user) {
      throw new ForbiddenException("Ungültiger Benutzername oder PIN");
    }
    const previousUserId = req.user?.userId;
    const action = previousUserId === user.id ? "SCREEN_UNLOCK" : "USER_SWITCH";
    return this.authService.login(user, action, previousUserId);
  }
}
