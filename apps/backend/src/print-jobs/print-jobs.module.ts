import { Module } from '@nestjs/common';
import { PrintJobsService } from './print-jobs.service';
import { PrintJobsController } from './print-jobs.controller';

@Module({
  providers: [PrintJobsService],
  controllers: [PrintJobsController],
  exports: [PrintJobsService],
})
export class PrintJobsModule {}
