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

@Module({
  imports: [
    // Terminplaner fuer den Lease-Reaper (Architekturvorgabe Abschnitt 3.2, M5).
    ScheduleModule.forRoot(),
    PrismaModule,
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
  ],
})
export class AppModule {}
