import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProductsModule } from './products/products.module';
import { OrdersModule } from './orders/orders.module';
import { StationsModule } from './stations/stations.module';
import { ReportsModule } from './reports/reports.module';
import { PrintJobsModule } from './print-jobs/print-jobs.module';
import { EventsModule } from './events/events.module';
import { UsersModule } from './users/users.module';
import { AreasModule } from './areas/areas.module';
import { SessionsModule } from './sessions/sessions.module';
import { RealtimeModule } from './realtime/realtime.module';

@Module({
  imports: [PrismaModule, AuthModule, ProductsModule, OrdersModule, StationsModule, ReportsModule, PrintJobsModule, EventsModule, UsersModule, AreasModule, SessionsModule, RealtimeModule],
})
export class AppModule {}
