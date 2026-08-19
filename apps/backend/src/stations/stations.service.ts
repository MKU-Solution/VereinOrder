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
    if (!['PENDING', 'PREPARING', 'READY', 'DELIVERED', 'CANCELLED'].includes(status)) {
      throw new NotFoundException('Invalid status');
    }
    
    return await this.prisma.$transaction(async (prisma) => {
      const updatedItem = await prisma.orderItem.update({
        where: { id: itemId },
        data: { status: status as any },
        include: { order: { include: { items: true } } }
      });

      const order = updatedItem.order;
      const activeItems = order.items.filter(i => i.status !== 'CANCELLED');
      
      if (activeItems.length > 0) {
        const allDelivered = activeItems.every(i => i.status === 'DELIVERED');
        const allPending = activeItems.every(i => i.status === 'PENDING');
        const anyDelivered = activeItems.some(i => i.status === 'DELIVERED');
        const allReady = activeItems.every(i => i.status === 'READY');
        const anyReady = activeItems.some(i => i.status === 'READY');
        const anyPreparing = activeItems.some(i => i.status === 'PREPARING');
        
        let newFulfillmentStatus = order.fulfillmentStatus;
        if (allDelivered) newFulfillmentStatus = 'DELIVERED';
        else if (anyDelivered) newFulfillmentStatus = 'PARTIALLY_DELIVERED';
        else if (allReady) newFulfillmentStatus = 'READY';
        else if (anyReady) newFulfillmentStatus = 'PARTIALLY_READY';
        else if (anyPreparing) newFulfillmentStatus = 'PREPARING';
        else if (allPending) newFulfillmentStatus = 'PENDING';
        
        if (newFulfillmentStatus !== order.fulfillmentStatus) {
          await prisma.order.update({
            where: { id: order.id },
            data: { fulfillmentStatus: newFulfillmentStatus as any }
          });
        }
      }
      
      return updatedItem;
    });
  }
}
