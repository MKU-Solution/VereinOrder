import { Module } from "@nestjs/common";
import { PrintJobsService } from "./print-jobs.service";
import { PrintJobsController } from "./print-jobs.controller";
import { PrintJobsReaperService } from "./print-jobs.reaper";
import { PrintWorkerGuard } from "./print-worker.guard";

@Module({
  providers: [PrintJobsService, PrintWorkerGuard, PrintJobsReaperService],
  controllers: [PrintJobsController],
  exports: [PrintJobsService],
})
export class PrintJobsModule {}
