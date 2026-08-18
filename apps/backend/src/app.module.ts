import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProductsModule } from './products/products.module';
import { OrdersModule } from './orders/orders.module';
import { StationsModule } from './stations/stations.module';
import { ReportsModule } from './reports/reports.module';
import { PrintJobsModule } from './print-jobs/print-jobs.module';
import { EventsModule } from './events/events.module';

@Module({
  imports: [PrismaModule, AuthModule, ProductsModule, OrdersModule, StationsModule, ReportsModule, PrintJobsModule, EventsModule],
})
export class AppModule {}
