import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProductsModule } from './products/products.module';
import { OrdersModule } from './orders/orders.module';
import { StationsModule } from './stations/stations.module';

@Module({
  imports: [PrismaModule, AuthModule, ProductsModule, OrdersModule, StationsModule],
})
export class AppModule {}
