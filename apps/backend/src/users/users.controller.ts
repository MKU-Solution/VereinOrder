import { Controller, Get, Post, Patch, Param, Body, UseGuards, Request } from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Roles('ADMINISTRATOR')
  async findAll() {
    return this.usersService.findAll();
  }

  @Post()
  @Roles('ADMINISTRATOR')
  async create(@Request() req: any, @Body() body: any) {
    const userId = req.user?.userId;
    return this.usersService.create(body, userId);
  }

  @Patch(':id')
  @Roles('ADMINISTRATOR')
  async update(@Request() req: any, @Param('id') id: string, @Body() body: any) {
    const userId = req.user?.userId;
    return this.usersService.update(id, body, userId);
  }

  @Patch(':id/pin')
  @Roles('ADMINISTRATOR')
  async updatePin(@Request() req: any, @Param('id') id: string, @Body('pin') pin: string) {
    const userId = req.user?.userId;
    return this.usersService.updatePin(id, pin, userId);
  }
}
