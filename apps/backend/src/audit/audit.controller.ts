import { Controller, Get, Query, UseGuards, Res } from '@nestjs/common';
import { AuditService } from './audit.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('audit')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('logs')
  @Roles('ADMINISTRATOR', 'EVENT_MANAGER')
  async getLogs(
    @Query('action') action?: string,
    @Query('entityType') entityType?: string,
    @Query('userId') userId?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number
  ) {
    return this.auditService.getLogs({ action, entityType, userId, search, limit, offset });
  }

  @Get('stats')
  @Roles('ADMINISTRATOR', 'EVENT_MANAGER')
  async getStats() {
    return this.auditService.getStats();
  }

  @Get('export')
  @Roles('ADMINISTRATOR', 'EVENT_MANAGER')
  async exportCsv(@Res() res: any) {
    const csvData = await this.auditService.exportCsv();
    const timestamp = new Date().toISOString().slice(0, 10);
    const filename = `vereinorder_audit_log_${timestamp}.csv`;

    if (res.header) {
      res.header('Content-Type', 'text/csv; charset=utf-8');
      res.header('Content-Disposition', `attachment; filename="${filename}"`);
    } else if (res.setHeader) {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    }

    return res.send ? res.send(csvData) : res.end(csvData);
  }
}
