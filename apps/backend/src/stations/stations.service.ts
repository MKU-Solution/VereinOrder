import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@vereinorder/database';
import { PRISMA_CLIENT } from '../prisma/prisma.module';

@Injectable()
export class StationsService {
  constructor(@Inject(PRISMA_CLIENT) private prisma: PrismaClient) {}

  async findAllActive() {
    return this.prisma.station.findMany({
      where: {
        isActive: true,
        event: { status: 'ACTIVE' } // simplified for MVP
      },
      orderBy: { sortOrder: 'asc' }
    });
  }

  // --- ADMIN METHODS: STATIONS ---

  async findAllAdmin(eventId: string) {
    return this.prisma.station.findMany({
      where: { eventId },
      orderBy: { sortOrder: 'asc' }
    });
  }

  async create(data: any) {
    return this.prisma.station.create({ data });
  }

  async update(id: string, data: any) {
    return this.prisma.station.update({ where: { id }, data });
  }

  async getPendingItems(stationId: string) {
    return this.prisma.orderItem.findMany({
      where: {
        status: 'PENDING',
        product: { targetStationId: stationId }
      },
      include: {
        product: true,
        order: {
          select: { orderNumber: true, createdAt: true }
        }
      },
      orderBy: { createdAt: 'asc' }
    });
  }

  async updateItemStatus(itemId: string, status: string) {
    // Basic validation
    if (!['PENDING', 'PREPARING', 'READY', 'DELIVERED', 'CANCELLED'].includes(status)) {
      throw new NotFoundException('Invalid status');
    }
    
    return this.prisma.orderItem.update({
      where: { id: itemId },
      data: { status: status as any }
    });
  }
}
