import { Controller, Get, Patch, Param, Body, UseGuards } from '@nestjs/common';
import { StationsService } from './stations.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('stations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StationsController {
  constructor(private readonly stationsService: StationsService) {}

  @Get()
  @Roles('ADMINISTRATOR', 'STATION', 'WAITER')
  async findAll() {
    return this.stationsService.findAllActive();
  }

  @Get(':id/items')
  @Roles('ADMINISTRATOR', 'STATION', 'WAITER')
  async getPendingItems(@Param('id') id: string) {
    return this.stationsService.getPendingItems(id);
  }

  @Patch('items/:itemId/status')
  @Roles('ADMINISTRATOR', 'STATION', 'WAITER')
  async updateItemStatus(@Param('itemId') itemId: string, @Body('status') status: string) {
    return this.stationsService.updateItemStatus(itemId, status);
  }
}
