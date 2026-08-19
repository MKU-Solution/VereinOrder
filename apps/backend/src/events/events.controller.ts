import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, Request } from '@nestjs/common';
import { EventsService } from './events.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { EventStatus } from '@vereinorder/database';

@Controller('events')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMINISTRATOR', 'EVENT_MANAGER')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get()
  async findAll() {
    return this.eventsService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.eventsService.findOne(id);
  }

  @Post()
  async create(@Request() req, @Body() data: any) {
    const userId = req.user?.userId;
    return this.eventsService.create(data, userId);
  }

  @Patch(':id')
  async update(@Request() req, @Param('id') id: string, @Body() data: any) {
    const userId = req.user?.userId;
    return this.eventsService.update(id, data, userId);
  }

  @Post(':id/activate')
  async activate(
    @Request() req,
    @Param('id') id: string,
    @Body('confirmed') confirmed: boolean,
    @Body('disclaimerVersion') disclaimerVersion?: string
  ) {
    const userId = req.user?.userId;
    return this.eventsService.activate(id, userId, confirmed, disclaimerVersion || '1.0');
  }

  @Patch(':id/status')
  async changeStatus(
    @Request() req,
    @Param('id') id: string,
    @Body('status') status: EventStatus
  ) {
    const userId = req.user?.userId;
    return this.eventsService.changeStatus(id, status, userId);
  }

  @Post(':id/clean-test-data')
  async cleanTestData(@Request() req, @Param('id') id: string) {
    const userId = req.user?.userId;
    return this.eventsService.cleanTestData(id, userId);
  }

  @Delete(':id')
  async remove(@Request() req, @Param('id') id: string) {
    const userId = req.user?.userId;
    return this.eventsService.remove(id, userId);
  }
}
