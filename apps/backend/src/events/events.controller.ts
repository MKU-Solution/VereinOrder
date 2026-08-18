import { Controller, Get, Post, Patch, Param, Body, UseGuards } from '@nestjs/common';
import { EventsService } from './events.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('events')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get()
  @Roles('ADMINISTRATOR', 'EVENT_MANAGER')
  async findAll() {
    return this.eventsService.findAll();
  }

  @Get(':id')
  @Roles('ADMINISTRATOR', 'EVENT_MANAGER')
  async findOne(@Param('id') id: string) {
    return this.eventsService.findOne(id);
  }

  @Post()
  @Roles('ADMINISTRATOR', 'EVENT_MANAGER')
  async create(@Body() data: any) {
    return this.eventsService.create(data);
  }

  @Patch(':id')
  @Roles('ADMINISTRATOR', 'EVENT_MANAGER')
  async update(@Param('id') id: string, @Body() data: any) {
    return this.eventsService.update(id, data);
  }
}
