import { Controller, Get, Post, Patch, Param, Body, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Roles('ADMINISTRATOR', 'EVENT_MANAGER')
  async findAll() {
    return this.usersService.findAll();
  }

  @Post()
  @Roles('ADMINISTRATOR')
  async create(@Body() data: any) {
    return this.usersService.create(data);
  }

  @Patch(':id')
  @Roles('ADMINISTRATOR')
  async update(@Param('id') id: string, @Body() data: any) {
    return this.usersService.update(id, data);
  }

  @Patch(':id/pin')
  @Roles('ADMINISTRATOR')
  async updatePin(@Param('id') id: string, @Body('pin') pin: string) {
    return this.usersService.updatePin(id, pin);
  }
}
