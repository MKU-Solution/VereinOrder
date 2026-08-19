import { Controller, Get, Post, Patch, Body, Query, Param, UseGuards, Request } from '@nestjs/common';
import { SessionsService } from './sessions.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Get('active')
  async getActiveSession(@Request() req: any, @Query('eventId') eventId: string) {
    if (!eventId) throw new Error('eventId required');
    return this.sessionsService.getActiveSession(req.user.id, eventId);
  }

  @Post()
  async startSession(@Request() req: any, @Body() body: { eventId: string, startingBalance: number }) {
    return this.sessionsService.startSession(req.user.id, body.eventId, body.startingBalance);
  }

  @Get(':id/summary')
  async getSummary(@Request() req: any, @Param('id') id: string) {
    return this.sessionsService.getSummary(id, req.user.id);
  }

  @Patch(':id/close')
  async closeSession(@Request() req: any, @Param('id') id: string, @Body() body: { closingBalance: number }) {
    return this.sessionsService.closeSession(id, req.user.id, body.closingBalance);
  }
}
