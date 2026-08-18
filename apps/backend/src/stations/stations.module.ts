import { Module } from '@nestjs/common';
import { StationsService } from './stations.service';
import { StationsController } from './stations.controller';

@Module({
  providers: [StationsService],
  controllers: [StationsController],
})
export class StationsModule {}
