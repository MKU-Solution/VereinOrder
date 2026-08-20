import { Module } from "@nestjs/common";
import { PrintJobsService } from "./print-jobs.service";
import { PrintJobsController } from "./print-jobs.controller";
import { PrintWorkerGuard } from "./print-worker.guard";

@Module({
  providers: [PrintJobsService, PrintWorkerGuard],
  controllers: [PrintJobsController],
  exports: [PrintJobsService],
})
export class PrintJobsModule {}
