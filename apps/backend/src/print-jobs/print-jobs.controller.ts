import { Controller, Get, Post, Patch, Param, Body, UseGuards } from '@nestjs/common';
import { PrintJobsService } from './print-jobs.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('print-jobs')
export class PrintJobsController {
  constructor(private readonly printJobsService: PrintJobsService) {}

  // Worker polling endpoint (public or internal)
  @Get()
  async getPendingJobs() {
    return this.printJobsService.getPendingJobs();
  }

  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body('status') status: string,
    @Body('errorMessage') errorMessage?: string
  ) {
    return this.printJobsService.updateJobStatus(id, status, errorMessage);
  }

  // --- ADMIN PRINTER MANAGEMENT ---

  @Get('printers')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMINISTRATOR', 'EVENT_MANAGER')
  async getPrinters() {
    return this.printJobsService.findAllPrinters();
  }

  @Post('printers')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMINISTRATOR', 'EVENT_MANAGER')
  async createPrinter(@Body() data: any) {
    return this.printJobsService.createPrinter(data);
  }

  @Patch('printers/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMINISTRATOR', 'EVENT_MANAGER')
  async updatePrinter(@Param('id') id: string, @Body() data: any) {
    return this.printJobsService.updatePrinter(id, data);
  }

  @Post('printers/:id/test')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMINISTRATOR', 'EVENT_MANAGER')
  async testPrinter(@Param('id') id: string) {
    return this.printJobsService.createTestJob(id);
  }
}
