import { Controller, Get, Post, UseGuards } from "@nestjs/common";
import { DiagnosticsService } from "./diagnostics.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { MaintenancePublic } from "../maintenance/maintenance.decorator";

@Controller("diagnostics")
@UseGuards(JwtAuthGuard, RolesGuard)
export class DiagnosticsController {
  constructor(private readonly diagnosticsService: DiagnosticsService) {}

  // Issue #67: nur dieser eine Weg ist laut Entwurf Abschnitt 6 ausgenommen,
  // "retry-failed-print-jobs" ausdruecklich nicht - das ist ein schreibender
  // Eingriff, den der Wartungsmodus wie jeden anderen abweist.
  @MaintenancePublic()
  @Get("status")
  @Roles("ADMINISTRATOR")
  async getStatus() {
    return this.diagnosticsService.getStatus();
  }

  @Post("retry-failed-print-jobs")
  @Roles("ADMINISTRATOR")
  async retryFailedPrintJobs() {
    return this.diagnosticsService.retryFailedPrintJobs();
  }
}
