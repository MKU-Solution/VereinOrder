import { Injectable, Inject, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@vereinorder/database';
import { PRISMA_CLIENT } from '../prisma/prisma.module';

@Injectable()
export class SessionsService {
  constructor(@Inject(PRISMA_CLIENT) private prisma: PrismaClient) {}

  async getActiveSession(userId: string, eventId: string) {
    return this.prisma.cashierSession.findFirst({
      where: {
        userId,
        eventId,
        status: 'ACTIVE'
      }
    });
  }

  async startSession(userId: string, eventId: string, startingBalance: number) {
    const existing = await this.getActiveSession(userId, eventId);
    if (existing) {
      throw new BadRequestException('User already has an active session for this event');
    }

    return this.prisma.cashierSession.create({
      data: {
        userId,
        eventId,
        startingBalance,
        status: 'ACTIVE'
      }
    });
  }

  async getSummary(id: string, userId: string) {
    const session = await this.prisma.cashierSession.findUnique({
      where: { id },
      include: { payments: true }
    });

    if (!session) throw new NotFoundException('Session not found');
    if (session.userId !== userId) throw new BadRequestException('Not your session');

    let cashSales = 0;
    let cardSales = 0;
    let otherSales = 0;

    for (const p of session.payments) {
      if (p.status === 'COMPLETED') {
        if (p.method === 'CASH') cashSales += p.amount;
        else if (p.method === 'CARD') cardSales += p.amount;
        else otherSales += p.amount;
      } else if (p.status === 'REFUNDED') {
        if (p.method === 'CASH') cashSales -= p.amount;
        else if (p.method === 'CARD') cardSales -= p.amount;
        else otherSales -= p.amount;
      }
    }

    const expectedCash = session.startingBalance + cashSales;

    return {
      id: session.id,
      status: session.status,
      startingBalance: session.startingBalance,
      cashSales,
      cardSales,
      otherSales,
      expectedCash,
      startTime: session.startTime,
      closingBalance: session.closingBalance,
      endTime: session.endTime
    };
  }

  async closeSession(id: string, userId: string, closingBalance: number) {
    const session = await this.prisma.cashierSession.findUnique({ where: { id } });
    if (!session) throw new NotFoundException('Session not found');
    if (session.userId !== userId) throw new BadRequestException('Not your session');
    if (session.status === 'CLOSED') throw new BadRequestException('Session already closed');

    return this.prisma.cashierSession.update({
      where: { id },
      data: {
        status: 'CLOSED',
        closingBalance,
        endTime: new Date()
      }
    });
  }
}
