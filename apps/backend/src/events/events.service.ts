import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaClient, EventStatus } from '@vereinorder/database';
import { PRISMA_CLIENT } from '../prisma/prisma.module';

@Injectable()
export class EventsService {
  constructor(@Inject(PRISMA_CLIENT) private prisma: PrismaClient) {}

  async findAll() {
    return this.prisma.event.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: {
            orders: true,
            products: true,
            stations: true,
            areas: true
          }
        }
      }
    });
  }

  async findOne(id: string) {
    const event = await this.prisma.event.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            orders: true,
            products: true,
            stations: true,
            areas: true,
            cashierSessions: true
          }
        }
      }
    });
    if (!event) throw new NotFoundException('Event not found');
    return event;
  }

  async create(data: any, userId?: string) {
    const event = await this.prisma.event.create({
      data: {
        name: data.name,
        organizer: data.organizer || null,
        location: data.location || null,
        startTime: data.startTime ? new Date(data.startTime) : null,
        endTime: data.endTime ? new Date(data.endTime) : null,
        timezone: data.timezone || 'Europe/Vienna',
        status: (data.status as EventStatus) || 'DRAFT',
        testMode: data.testMode || false
      }
    });

    if (userId) {
      await this.prisma.auditLog.create({
        data: {
          action: 'EVENT_CREATED',
          entityId: event.id,
          entityType: 'Event',
          userId,
          details: { name: event.name, status: event.status }
        }
      });
    }

    return event;
  }

  async update(id: string, data: any, userId?: string) {
    const existing = await this.prisma.event.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Event not found');

    const event = await this.prisma.event.update({
      where: { id },
      data: {
        name: data.name !== undefined ? data.name : undefined,
        organizer: data.organizer !== undefined ? data.organizer : undefined,
        location: data.location !== undefined ? data.location : undefined,
        startTime: data.startTime !== undefined ? (data.startTime ? new Date(data.startTime) : null) : undefined,
        endTime: data.endTime !== undefined ? (data.endTime ? new Date(data.endTime) : null) : undefined,
        timezone: data.timezone !== undefined ? data.timezone : undefined,
        status: data.status ? (data.status as EventStatus) : undefined,
        testMode: data.testMode !== undefined ? data.testMode : undefined
      }
    });

    if (userId) {
      await this.prisma.auditLog.create({
        data: {
          action: 'EVENT_UPDATED',
          entityId: event.id,
          entityType: 'Event',
          userId,
          details: { changes: data }
        }
      });
    }

    return event;
  }

  async activate(id: string, userId: string, confirmed: boolean, disclaimerVersion: string = '1.0') {
    const existing = await this.prisma.event.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Event not found');

    if (!confirmed) {
      throw new BadRequestException('Die rechtliche RKSV-Bestätigung ist für die Aktivierung des Festbetriebs zwingend erforderlich.');
    }

    const updated = await this.prisma.event.update({
      where: { id },
      data: {
        status: 'ACTIVE',
        testMode: false,
        rksvConfirmedAt: new Date(),
        rksvConfirmedByUserId: userId,
        rksvDisclaimerVersion: disclaimerVersion
      }
    });

    await this.prisma.auditLog.create({
      data: {
        action: 'RKSV_DISCLAIMER_CONFIRMED',
        entityId: id,
        entityType: 'Event',
        userId,
        details: {
          disclaimerText: 'VereinOrder ist keine RKSV-Registrierkasse. Der Veranstalter ist selbst dafür verantwortlich zu prüfen, ob für diese Veranstaltung Einzelaufzeichnungs-, Belegerteilungs- oder Registrierkassenpflichten bestehen.',
          version: disclaimerVersion,
          appVersion: '0.1.0',
          activatedAt: updated.rksvConfirmedAt
        }
      }
    });

    return updated;
  }

  async changeStatus(id: string, status: EventStatus, userId: string) {
    const existing = await this.prisma.event.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Event not found');

    if (status === 'ACTIVE' && !existing.rksvConfirmedAt) {
      throw new BadRequestException('Echtbetrieb kann nur mit vorheriger RKSV-Bestätigung über /activate aktiviert werden.');
    }

    const isTestMode = status === 'TEST_MODE';

    const updated = await this.prisma.event.update({
      where: { id },
      data: {
        status,
        testMode: isTestMode ? true : (status === 'ACTIVE' ? false : existing.testMode)
      }
    });

    await this.prisma.auditLog.create({
      data: {
        action: 'EVENT_STATUS_CHANGED',
        entityId: id,
        entityType: 'Event',
        userId,
        details: { previousStatus: existing.status, newStatus: status, testMode: updated.testMode }
      }
    });

    return updated;
  }

  async cleanTestData(id: string, userId: string) {
    const event = await this.prisma.event.findUnique({ where: { id } });
    if (!event) throw new NotFoundException('Event not found');

    return await this.prisma.$transaction(async (tx) => {
      const eventOrders = await tx.order.findMany({
        where: { eventId: id },
        select: { id: true }
      });
      const orderIds = eventOrders.map(o => o.id);

      let deletedPrintJobs = { count: 0 };
      let deletedPayments = { count: 0 };
      let deletedOrderItems = { count: 0 };
      let deletedOrders = { count: 0 };

      if (orderIds.length > 0) {
        deletedPrintJobs = await tx.printJob.deleteMany({
          where: { orderId: { in: orderIds } }
        });
        deletedPayments = await tx.payment.deleteMany({
          where: { orderId: { in: orderIds } }
        });
        deletedOrderItems = await tx.orderItem.deleteMany({
          where: { orderId: { in: orderIds } }
        });
        deletedOrders = await tx.order.deleteMany({
          where: { id: { in: orderIds } }
        });
      }

      const deletedSessions = await tx.cashierSession.deleteMany({
        where: { eventId: id }
      });

      await tx.auditLog.create({
        data: {
          action: 'EVENT_TEST_DATA_CLEANED',
          entityId: id,
          entityType: 'Event',
          userId,
          details: {
            ordersDeleted: deletedOrders.count,
            paymentsDeleted: deletedPayments.count,
            sessionsDeleted: deletedSessions.count,
            printJobsDeleted: deletedPrintJobs.count,
            itemsDeleted: deletedOrderItems.count
          }
        }
      });

      return {
        success: true,
        message: 'Testdaten erfolgreich bereinigt.',
        deleted: {
          orders: deletedOrders.count,
          payments: deletedPayments.count,
          sessions: deletedSessions.count,
          printJobs: deletedPrintJobs.count
        }
      };
    });
  }

  async remove(id: string, userId: string) {
    const existing = await this.prisma.event.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Event not found');

    await this.prisma.auditLog.create({
      data: {
        action: 'EVENT_DELETED',
        entityId: id,
        entityType: 'Event',
        userId,
        details: { name: existing.name }
      }
    });

    return this.prisma.event.delete({ where: { id } });
  }
}
