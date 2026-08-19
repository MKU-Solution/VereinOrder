import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMINISTRATOR', 'REVISION', 'EVENT_MANAGER')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('summary')
  async getSummary(@Query('eventId') eventId?: string) {
    return this.reportsService.getSummary(eventId);
  }

  @Get('products')
  async getProductsSummary(@Query('eventId') eventId?: string) {
    return this.reportsService.getProductsSummary(eventId);
  }

  @Get('categories')
  async getCategoriesSummary(@Query('eventId') eventId?: string) {
    return this.reportsService.getCategoriesSummary(eventId);
  }

  @Get('users')
  async getUsersSummary(@Query('eventId') eventId?: string) {
    return this.reportsService.getUsersSummary(eventId);
  }

  @Get('hourly')
  async getHourlySummary(@Query('eventId') eventId?: string) {
    return this.reportsService.getHourlySummary(eventId);
  }

  @Get('sessions')
  async getSessionsSummary(@Query('eventId') eventId?: string) {
    return this.reportsService.getSessionsSummary(eventId);
  }

  @Get('export/:type')
  async exportCsv(
    @Param('type') type: 'orders' | 'products' | 'users' | 'sessions' | 'categories',
    @Query('eventId') eventId: string | undefined,
    @Res() res: any
  ) {
    const csvContent = await this.reportsService.exportCsv(type, eventId);
    const filename = `vereinorder_report_${type}_${new Date().toISOString().slice(0, 10)}.csv`;

    if (typeof res.header === 'function') {
      res.header('Content-Type', 'text/csv; charset=utf-8');
      res.header('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(csvContent);
    } else if (typeof res.setHeader === 'function') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(csvContent);
    }
    return csvContent;
  }
}
