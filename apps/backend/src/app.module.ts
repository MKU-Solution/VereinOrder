import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { AuthModule } from "./auth/auth.module";
import { PrismaModule } from "./prisma/prisma.module";
import { ProductsModule } from "./products/products.module";
import { OrdersModule } from "./orders/orders.module";
import { StationsModule } from "./stations/stations.module";
import { ReportsModule } from "./reports/reports.module";
import { PrintJobsModule } from "./print-jobs/print-jobs.module";
import { EventsModule } from "./events/events.module";
import { UsersModule } from "./users/users.module";
import { AreasModule } from "./areas/areas.module";
import { SessionsModule } from "./sessions/sessions.module";
import { RealtimeModule } from "./realtime/realtime.module";
import { BackupModule } from "./backup/backup.module";
import { AuditModule } from "./audit/audit.module";
import { DiagnosticsModule } from "./diagnostics/diagnostics.module";
import { RunnerModule } from "./runner/runner.module";
import { MaintenanceModule } from "./maintenance/maintenance.module";
import { ValueVouchersModule } from "./value-vouchers/value-vouchers.module";

@Module({
  imports: [
    // Terminplaner fuer den Lease-Reaper (Architekturvorgabe Abschnitt 3.2, M5)
    // und, seit Issue #67, fuer den Uebergang DRAINING -> LOCKED im
    // Wartungsmodus (MaintenanceService.tryAdvanceToLocked).
    ScheduleModule.forRoot(),
    PrismaModule,
    // Issue #67: MaintenanceModule zuerst, damit sein globaler Guard
    // (APP_GUARD) fuer jede Anfrage vor JwtAuthGuard/RolesGuard und
    // PrintWorkerGuard greift - siehe maintenance.module.ts.
    MaintenanceModule,
    AuthModule,
    ProductsModule,
    OrdersModule,
    StationsModule,
    ReportsModule,
    PrintJobsModule,
    EventsModule,
    UsersModule,
    AreasModule,
    SessionsModule,
    RealtimeModule,
    BackupModule,
    AuditModule,
    DiagnosticsModule,
    RunnerModule,
    ValueVouchersModule,
  ],
})
export class AppModule {}
