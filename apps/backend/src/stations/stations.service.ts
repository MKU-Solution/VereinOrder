import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@vereinorder/database';
import { PRISMA_CLIENT } from '../prisma/prisma.module';
import { deriveFulfillmentStatus } from '../orders/fulfillment-status';

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
        status: { in: ['PENDING', 'PREPARING'] },
        product: { targetStationId: stationId }
      },
      include: {
        product: true,
        order: {
          select: { orderNumber: true, createdAt: true, isPriority: true }
        }
      },
      orderBy: [
        { order: { isPriority: 'desc' } },
        { createdAt: 'asc' }
      ]
    });
  }

  async updateItemStatus(itemId: string, status: string) {
    if (!['PENDING', 'PREPARING', 'READY', 'CANCELLED'].includes(status)) {
      throw new NotFoundException('Invalid status');
    }
    
    return await this.prisma.$transaction(async (prisma) => {
      const currentItem = await prisma.orderItem.findUnique({
        where: { id: itemId },
        select: { orderId: true }
      });
      if (!currentItem) throw new NotFoundException('Order item not found');

      // Runner-Claims sperren ebenfalls zuerst den Auftrag und danach Positionen.
      // Die einheitliche Reihenfolge verhindert Deadlocks bei parallelem Bereitstellen/Übernehmen.
      await prisma.order.update({
        where: { id: currentItem.orderId },
        data: { updatedAt: new Date() }
      });

      const updatedItem = await prisma.orderItem.update({
        where: { id: itemId },
        data: { status: status as any },
        include: { order: { include: { items: true } } }
      });

      const order = updatedItem.order;
      const newFulfillmentStatus = deriveFulfillmentStatus(order.items);

      if (newFulfillmentStatus !== order.fulfillmentStatus) {
        await prisma.order.update({
          where: { id: order.id },
          data: { fulfillmentStatus: newFulfillmentStatus }
        });
      }
      
      return updatedItem;
    });
  }
}
