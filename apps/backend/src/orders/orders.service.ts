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
      if (product.availability !== 'AVAILABLE') throw new BadRequestException(`Product ${product.name} is not available`);
      
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
          items: {
            create: orderItemsData
          },
          payments: dto.payments && dto.payments.length > 0 ? {
            create: dto.payments.map(p => ({
              amount: p.amount,
              method: p.method,
              status: 'COMPLETED'
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

      // Automatically create a PrintJob for the MVP (using the first active printer)
      const printer = await prisma.printer.findFirst({ where: { isActive: true } });
      if (printer) {
        await prisma.printJob.create({
          data: {
            printerId: printer.id,
            orderId: order.id,
            content: {
              orderNumber: order.id,
              totalAmount: order.totalAmount,
              items: order.items.map(item => ({
                productName: item.product.name,
                quantity: item.quantity,
                price: item.priceAtTime,
                variantName: item.variantName,
                extras: item.extras
              }))
            }
          }
        });
      }

      return order;
    });
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

  async addPaymentsToOrder(orderId: string, payments: { amount: number, method: 'CASH' | 'CARD' | 'VOUCHER' }[]) {
    if (!payments || payments.length === 0) {
      throw new BadRequestException('No payments provided');
    }

    return await this.prisma.$transaction(async (prisma) => {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { payments: true }
      });

      if (!order) throw new BadRequestException('Order not found');
      if (order.paymentStatus === 'PAID') throw new BadRequestException('Order is already fully paid');
      if (order.lifecycleStatus === 'CANCELLED') throw new BadRequestException('Order is cancelled');

      // Add new payments
      await prisma.payment.createMany({
        data: payments.map(p => ({
          orderId: order.id,
          amount: p.amount,
          method: p.method,
          status: 'COMPLETED'
        }))
      });

      // Calculate total paid now
      const existingPaymentsTotal = order.payments.reduce((sum, p) => sum + p.amount, 0);
      const newPaymentsTotal = payments.reduce((sum, p) => sum + p.amount, 0);
      const totalPaid = existingPaymentsTotal + newPaymentsTotal;

      let newPaymentStatus: any = order.paymentStatus;
      if (totalPaid >= order.totalAmount) {
        newPaymentStatus = 'PAID';
      } else if (totalPaid > 0) {
        newPaymentStatus = 'PARTIALLY_PAID';
      }

      await prisma.order.update({
        where: { id: order.id },
        data: { paymentStatus: newPaymentStatus as any }
      });

      return prisma.order.findUnique({
        where: { id: orderId },
        include: {
          items: { include: { product: true } },
          payments: true
        }
      });
    });
  }

  async cancelOrder(orderId: string, userId: string, reason?: string) {
    return await this.prisma.$transaction(async (prisma) => {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { items: true, payments: true }
      });

      if (!order) throw new NotFoundException('Order not found');
      if (order.lifecycleStatus === 'CANCELLED') throw new BadRequestException('Order is already cancelled');

      // Set non-delivered items to CANCELLED
      await prisma.orderItem.updateMany({
        where: { 
          orderId, 
          status: { notIn: ['DELIVERED', 'CANCELLED'] } 
        },
        data: { status: 'CANCELLED' }
      });

      // Issue refund if there were payments
      const totalPaid = order.payments.reduce((sum, p) => sum + p.amount, 0);
      if (totalPaid > 0) {
        // Create a negative payment representing the refund
        await prisma.payment.create({
          data: {
            orderId: order.id,
            amount: -totalPaid,
            method: 'REFUND',
            status: 'COMPLETED'
          }
        });
      }

      const updatedOrder = await prisma.order.update({
        where: { id: orderId },
        data: {
          lifecycleStatus: 'CANCELLED',
          paymentStatus: totalPaid > 0 ? 'REFUNDED' : 'OPEN',
          fulfillmentStatus: 'PENDING'
        },
        include: { items: { include: { product: true } }, payments: true }
      });

      await prisma.auditLog.create({
        data: {
          action: 'ORDER_CANCELLED',
          entityId: orderId,
          entityType: 'Order',
          userId,
          details: { reason, refundedAmount: totalPaid }
        }
      });

      return updatedOrder;
    });
  }

  async cancelOrderItem(orderItemId: string, userId: string, reason?: string) {
    return await this.prisma.$transaction(async (prisma) => {
      const item = await prisma.orderItem.findUnique({
        where: { id: orderItemId },
        include: { order: { include: { payments: true, items: true } } }
      });

      if (!item) throw new NotFoundException('Order item not found');
      if (item.status === 'CANCELLED') throw new BadRequestException('Item is already cancelled');
      if (item.order.lifecycleStatus === 'CANCELLED') throw new BadRequestException('Order is fully cancelled');

      const itemTotalCost = item.priceAtTime * item.quantity;
      const order = item.order;

      // Mark item as CANCELLED
      await prisma.orderItem.update({
        where: { id: orderItemId },
        data: { status: 'CANCELLED' }
      });

      // Recalculate order total amount
      const newTotalAmount = order.totalAmount - itemTotalCost;
      
      const totalPaid = order.payments.reduce((sum, p) => sum + p.amount, 0);
      
      let newPaymentStatus = order.paymentStatus;
      if (totalPaid > newTotalAmount) {
        // Refund the difference
        const refundAmount = totalPaid - newTotalAmount;
        await prisma.payment.create({
          data: {
            orderId: order.id,
            amount: -refundAmount,
            method: 'REFUND',
            status: 'COMPLETED'
          }
        });
        newPaymentStatus = 'PAID';
      } else if (totalPaid === newTotalAmount) {
        newPaymentStatus = 'PAID';
      } else if (totalPaid > 0 && totalPaid < newTotalAmount) {
        newPaymentStatus = 'PARTIALLY_PAID';
      } else if (totalPaid === 0 && newTotalAmount === 0) {
        newPaymentStatus = 'OPEN'; // Or paid, but no money changed hands
      }

      // Check if all items are cancelled
      const allItemsCancelled = order.items.every(i => i.id === orderItemId || i.status === 'CANCELLED');
      const newLifecycleStatus = allItemsCancelled ? 'CANCELLED' : 'PARTIALLY_CANCELLED';

      const updatedOrder = await prisma.order.update({
        where: { id: order.id },
        data: {
          totalAmount: newTotalAmount,
          paymentStatus: newPaymentStatus as any,
          lifecycleStatus: newLifecycleStatus as any
        },
        include: { items: { include: { product: true } }, payments: true }
      });

      await prisma.auditLog.create({
        data: {
          action: 'ITEM_CANCELLED',
          entityId: orderItemId,
          entityType: 'OrderItem',
          userId,
          details: { reason, refundedAmount: totalPaid > newTotalAmount ? totalPaid - newTotalAmount : 0, originalOrderTotal: order.totalAmount, newOrderTotal: newTotalAmount }
        }
      });

      return updatedOrder;
    });
  }
}
