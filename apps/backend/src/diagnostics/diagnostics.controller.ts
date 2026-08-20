import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { DiagnosticsService } from './diagnostics.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('diagnostics')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DiagnosticsController {
  constructor(private readonly diagnosticsService: DiagnosticsService) {}

  @Get('status')
  @Roles('ADMINISTRATOR')
  async getStatus() {
    return this.diagnosticsService.getStatus();
  }

  @Post('retry-failed-print-jobs')
  @Roles('ADMINISTRATOR')
  async retryFailedPrintJobs() {
    return this.diagnosticsService.retryFailedPrintJobs();
  }
}
