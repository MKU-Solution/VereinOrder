import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { AreasService } from './areas.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('areas')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AreasController {
  constructor(private readonly areasService: AreasService) {}

  @Get()
  @Roles('ADMINISTRATOR', 'EVENT_MANAGER', 'WAITER', 'CASHIER', 'STATION')
  async findAll(@Query('eventId') eventId: string) {
    return this.areasService.findAll(eventId);
  }

  @Post()
  @Roles('ADMINISTRATOR', 'EVENT_MANAGER')
  async create(@Body() data: { name: string; sortOrder?: number; eventId: string }) {
    return this.areasService.create(data);
  }

  @Patch(':id')
  @Roles('ADMINISTRATOR', 'EVENT_MANAGER')
  async update(@Param('id') id: string, @Body() data: { name?: string; sortOrder?: number }) {
    return this.areasService.update(id, data);
  }

  @Delete(':id')
  @Roles('ADMINISTRATOR', 'EVENT_MANAGER')
  async remove(@Param('id') id: string) {
    return this.areasService.remove(id);
  }
}
