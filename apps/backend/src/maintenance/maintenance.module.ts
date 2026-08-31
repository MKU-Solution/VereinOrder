import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { MaintenanceStateService } from "./maintenance-state.service";
import { MaintenanceService } from "./maintenance.service";
import { MaintenanceController } from "./maintenance.controller";
import { MaintenanceGuard } from "./maintenance.guard";
import { requireJwtSecret } from "../secrets/ensure-secrets";

/**
 * `@Global()`, damit `MaintenanceStateService` (und darüber `MaintenanceService`)
 * ohne weiteren Importaufwand in `print-jobs.reaper.ts` und
 * `backup.service.ts` verfügbar ist — genau wie `PrismaModule` und
 * `AuditModule` es bereits sind.
 *
 * `MaintenanceGuard` wird hier als `APP_GUARD` registriert. NestJS führt
 * global registrierte Guards vor jedem controller- oder routengebundenen
 * Guard aus (`JwtAuthGuard`, `RolesGuard`, `PrintWorkerGuard`) — das ist die
 * Grundlage für Ergänzung 2 der Projektleitung ("503, nicht 401"). Ein
 * eigener Test (`test/maintenance.guard-order.integration-spec.ts`) beweist
 * das gegen die tatsächliche Registrierung, weil ein künftiger Umbau von
 * global auf lokale `@UseGuards(...)`-Bindung diese Reihenfolge lautlos
 * kippen könnte.
 */
@Global()
@Module({
  imports: [
    JwtModule.register({
      // #175: kein Rueckfall auf einen festen Wert mehr.
      secret: requireJwtSecret(),
    }),
  ],
  controllers: [MaintenanceController],
  providers: [
    MaintenanceStateService,
    MaintenanceService,
    { provide: APP_GUARD, useClass: MaintenanceGuard },
  ],
  exports: [MaintenanceStateService, MaintenanceService],
})
export class MaintenanceModule {}
