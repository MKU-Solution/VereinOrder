import { Injectable, Inject, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaClient, Prisma } from '@vereinorder/database';
import { PRISMA_CLIENT } from '../prisma/prisma.module';

interface CreateOrderDto {
  eventId: string;
  items: { 
    productId: string; 
    quantity: number;
    variantId?: string;
    variantName?: string;
    extras?: { id: string; name: string; price: number }[];
  }[];
  payments?: { amount: number, method: 'CASH' | 'CARD' | 'VOUCHER' }[];
  idempotencyKey?: string;
  tableName?: string;
}

@Injectable()
export class OrdersService {
  constructor(@Inject(PRISMA_CLIENT) private prisma: PrismaClient) {}

  private async dispatchPrintJobs(prisma: any, order: any, user?: any) {
    const event = await prisma.event.findUnique({ where: { id: order.eventId } });
    const defaultPrinter = await prisma.printer.findFirst({ where: { isActive: true } });
    const stations = await prisma.station.findMany({ 
      where: { eventId: order.eventId },
      include: { printer: true }
    });
    const stationMap = new Map(stations.map((s: any) => [s.id, s]));

    if (!defaultPrinter && stations.every((s: any) => !s.printer)) {
      return; // No printers configured
    }

    // 1. Group items by targetStation for STATION_TICKETS
    const itemsByStation = new Map<string, any[]>();
    for (const item of order.items) {
      const stationId = item.product?.targetStationId || 'NO_STATION';
      if (!itemsByStation.has(stationId)) {
        itemsByStation.set(stationId, []);
      }
      itemsByStation.get(stationId)!.push(item);
    }

    for (const [stationId, stationItems] of itemsByStation.entries()) {
      const station = stationMap.get(stationId) as any;
      const targetPrinter = station?.printer || defaultPrinter;
      if (targetPrinter && targetPrinter.isActive) {
        await prisma.printJob.create({
          data: {
            printerId: targetPrinter.id,
            jobType: 'STATION_TICKET',
            orderId: order.id,
            content: {
              title: 'ABHOL-/KÜCHENBON',
              stationName: station?.name || 'Zentrale Ausgabe',
              orderNumber: order.orderNumber,
              orderId: order.id,
              tableName: order.tableName || 'Theke / Ohne Tisch',
              waiterName: user?.name || user?.username || 'Kellner',
              isPriority: order.isPriority,
              createdAt: order.createdAt,
              items: stationItems.map(i => ({
                productName: i.product.name,
                quantity: i.quantity,
                variantName: i.variantName,
                extras: i.extras
              }))
            }
          }
        });
      }
    }

    // 2. Create Customer/Cashier RECEIPT
    if (defaultPrinter && defaultPrinter.isActive) {
      const totalPaid = order.payments?.reduce((sum: number, p: any) => sum + p.amount, 0) || 0;
      const changeAmount = Math.max(0, totalPaid - order.totalAmount);

      await prisma.printJob.create({
        data: {
          printerId: defaultPrinter.id,
          jobType: 'RECEIPT',
          orderId: order.id,
          content: {
            title: 'KASSENBELEG',
            eventName: event?.name || 'Vereinsfest',
            orderNumber: order.orderNumber,
            orderId: order.id,
            tableName: order.tableName || 'Theke',
            waiterName: user?.name || user?.username || 'Kellner',
            createdAt: order.createdAt,
            items: order.items.map((i: any) => ({
              productName: i.product.name,
              quantity: i.quantity,
              price: i.priceAtTime,
              variantName: i.variantName,
              extras: i.extras,
              totalPrice: i.priceAtTime * i.quantity
            })),
            totalAmount: order.totalAmount,
            payments: order.payments?.map((p: any) => ({
              amount: p.amount,
              method: p.method
            })) || [],
            changeAmount,
            rksvDisclaimer: 'VereinOrder ist keine RKSV-Registrierkasse.'
          }
        }
      });
    }
  }

  async createOrder(userId: string, dto: CreateOrderDto) {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Order must contain at least one item');
    }

    if (dto.idempotencyKey) {
      const existingOrder = await this.prisma.order.findUnique({
        where: { idempotencyKey: dto.idempotencyKey },
        include: {
          items: { include: { product: true } },
          payments: true
        }
      });
      if (existingOrder) {
        return existingOrder;
      }
    }

    const productIds = dto.items.map(i => i.productId);
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      include: { variants: true, extras: true }
    });

    const productMap = new Map(products.map(p => [p.id, p]));
    
    let totalAmount = 0;
    const orderItemsData = dto.items.map(item => {
      const product = productMap.get(item.productId);
      if (!product) throw new BadRequestException(`Product ${item.productId} not found`);
      if (product.availability === 'OUT_OF_STOCK' || product.availability === 'DISABLED') {
        throw new BadRequestException(`Product ${product.name} is currently out of stock`);
      }
      
      let basePrice = product.price;
      
      if (item.variantId) {
        const variant = product.variants.find(v => v.id === item.variantId);
        if (variant) basePrice = variant.price;
      }
      
      let extrasCost = 0;
      if (item.extras && item.extras.length > 0) {
        for (const ext of item.extras) {
          const dbExtra = product.extras.find(e => e.id === ext.id);
          if (dbExtra) extrasCost += dbExtra.price;
        }
      }

      const finalItemPrice = basePrice + extrasCost;
      const itemTotal = finalItemPrice * item.quantity;
      totalAmount += itemTotal;

      return {
        productId: product.id,
        quantity: item.quantity,
        priceAtTime: finalItemPrice,
        status: 'PENDING' as any,
        variantId: item.variantId,
        variantName: item.variantName,
        extras: item.extras as any,
      };
    });

    const totalPaid = dto.payments?.reduce((sum, p) => sum + p.amount, 0) || 0;
    const initialPaymentStatus = totalPaid >= totalAmount ? 'PAID' : (totalPaid > 0 ? 'PARTIALLY_PAID' : 'OPEN');

    const user = userId ? await this.prisma.user.findUnique({ where: { id: userId } }) : null;
    const activeSession = userId ? await this.prisma.cashierSession.findFirst({
      where: { userId, eventId: dto.eventId, status: 'ACTIVE' }
    }) : null;
    const cashierSessionId = activeSession?.id || null;

    return await this.prisma.$transaction(async (prisma) => {
      const order = await prisma.order.create({
        data: {
          totalAmount,
          lifecycleStatus: 'SUBMITTED',
          paymentStatus: initialPaymentStatus,
          fulfillmentStatus: 'PENDING',
          userId,
          eventId: dto.eventId,
          idempotencyKey: dto.idempotencyKey,
          tableName: dto.tableName,
          cashierSessionId,
          items: {
            create: orderItemsData
          },
          payments: dto.payments && dto.payments.length > 0 ? {
            create: dto.payments.map(p => ({
              amount: p.amount,
              method: p.method,
              status: 'COMPLETED',
              cashierSessionId
            }))
          } : undefined
        },
        include: {
          items: {
            include: {
              product: true
            }
          },
          payments: true
        }
      });

      // Dispatch smart PrintJobs
      await this.dispatchPrintJobs(prisma, order, user);

      return order;
    });
  }

  async reprintOrder(orderId: string, userId?: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { product: true } },
        payments: true
      }
    });
    if (!order) throw new NotFoundException('Order not found');

    const user = userId ? await this.prisma.user.findUnique({ where: { id: userId } }) : null;

    await this.dispatchPrintJobs(this.prisma, order, user);
    return { success: true, message: 'Nachdruckaufträge erfolgreich in die Druckerwarteschlange eingereiht' };
  }

  async getUnpaidOrders(eventId: string) {
    return this.prisma.order.findMany({
      where: {
        eventId,
        paymentStatus: { in: ['OPEN', 'PARTIALLY_PAID'] },
        lifecycleStatus: { not: 'CANCELLED' }
      },
      include: {
        items: {
          include: {
            product: true
          }
        },
        payments: true
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  async addPaymentsToOrder(orderId: string, payments: { amount: number, method: 'CASH' | 'CARD' | 'VOUCHER' }[], userId: string) {
    if (!payments || payments.length === 0) {
      throw new BadRequestException('No payments provided');
    }

    return await this.prisma.$transaction(async (prisma) => {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { payments: true }
      });

      if (!order) throw new NotFoundException('Order not found');
      if (order.paymentStatus === 'PAID') throw new BadRequestException('Order is already fully paid');

      const currentPaid = order.payments.reduce((sum, p) => sum + p.amount, 0);
      const newPaid = payments.reduce((sum, p) => sum + p.amount, 0);
      const totalPaid = currentPaid + newPaid;

      const newPaymentStatus = totalPaid >= order.totalAmount ? 'PAID' : 'PARTIALLY_PAID';

      const activeSession = userId ? await prisma.cashierSession.findFirst({
        where: { userId, eventId: order.eventId, status: 'ACTIVE' }
      }) : null;
      const cashierSessionId = activeSession?.id || null;

      await prisma.payment.createMany({
        data: payments.map(p => ({
          orderId: order.id,
          amount: p.amount,
          method: p.method,
          status: 'COMPLETED',
          cashierSessionId
        }))
      });

      return await prisma.order.update({
        where: { id: orderId },
        data: { paymentStatus: newPaymentStatus },
        include: { items: { include: { product: true } }, payments: true }
      });
    });
  }

  async cancelOrder(orderId: string, reason: string, userId: string) {
    return await this.prisma.$transaction(async (prisma) => {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { items: true, payments: true }
      });

      if (!order) throw new NotFoundException('Order not found');
      if (order.lifecycleStatus === 'CANCELLED') throw new BadRequestException('Order is already cancelled');

      const updatedOrder = await prisma.order.update({
        where: { id: orderId },
        data: {
          lifecycleStatus: 'CANCELLED'
        },
        include: { items: true, payments: true }
      });

      await prisma.orderItem.updateMany({
        where: { orderId },
        data: { status: 'CANCELLED' }
      });

      await prisma.auditLog.create({
        data: {
          action: 'CANCEL_ORDER',
          entityId: orderId,
          entityType: 'Order',
          userId,
          details: {
            reason,
            totalAmount: order.totalAmount,
            paymentsCount: order.payments.length
          }
        }
      });

      return updatedOrder;
    });
  }

  async cancelOrderItem(orderItemId: string, reason: string, userId: string) {
    return await this.prisma.$transaction(async (prisma) => {
      const item = await prisma.orderItem.findUnique({
        where: { id: orderItemId },
        include: { order: { include: { items: true } } }
      });

      if (!item) throw new NotFoundException('OrderItem not found');
      if (item.status === 'CANCELLED') throw new BadRequestException('Item is already cancelled');

      const updatedItem = await prisma.orderItem.update({
        where: { id: orderItemId },
        data: { status: 'CANCELLED' }
      });

      const order = item.order;
      const remainingItems = order.items.filter(i => i.id !== orderItemId && i.status !== 'CANCELLED');
      
      const newTotal = remainingItems.reduce((sum, i) => sum + (i.priceAtTime * i.quantity), 0);
      const isAllCancelled = remainingItems.length === 0;

      await prisma.order.update({
        where: { id: order.id },
        data: {
          totalAmount: newTotal,
          lifecycleStatus: isAllCancelled ? 'CANCELLED' : order.lifecycleStatus
        }
      });

      await prisma.auditLog.create({
        data: {
          action: 'CANCEL_ORDER_ITEM',
          entityId: orderItemId,
          entityType: 'OrderItem',
          userId,
          details: {
            reason,
            orderId: order.id,
            productId: item.productId,
            itemPrice: item.priceAtTime,
            quantity: item.quantity
          }
        }
      });

      return updatedItem;
    });
  }

  async updatePriority(orderId: string, isPriority: boolean) {
    return this.prisma.order.update({
      where: { id: orderId },
      data: { isPriority }
    });
  }
}
