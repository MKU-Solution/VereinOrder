import { Controller, Get, Patch, Param, Body } from '@nestjs/common';
import { PrintJobsService } from './print-jobs.service';
import { PrintJob } from '@vereinorder/database';

// Note: No auth guards here for MVP, or we would need a specific worker token
@Controller('print-jobs')
export class PrintJobsController {
  constructor(private readonly printJobsService: PrintJobsService) {}

  @Get()
  async getPendingJobs(): Promise<PrintJob[]> {
    return this.printJobsService.getPendingJobs();
  }

  @Patch(':id/status')
  async updateJobStatus(@Param('id') id: string, @Body('status') status: string, @Body('errorMessage') errorMessage?: string): Promise<PrintJob> {
    return this.printJobsService.updateJobStatus(id, status, errorMessage);
  }
}
