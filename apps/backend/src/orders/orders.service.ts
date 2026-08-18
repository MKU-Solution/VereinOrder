import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@vereinorder/database';
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
    const initialStatus = totalPaid >= totalAmount ? 'PAID' : 'PENDING';

    return await this.prisma.$transaction(async (prisma) => {
      const order = await prisma.order.create({
        data: {
          totalAmount,
          status: initialStatus,
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
                price: item.priceAtTime
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
        status: 'PENDING'
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
      if (order.status === 'PAID') throw new BadRequestException('Order is already fully paid');

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

      if (totalPaid >= order.totalAmount) {
        await prisma.order.update({
          where: { id: order.id },
          data: { status: 'PAID' }
        });
      }

      return prisma.order.findUnique({
        where: { id: orderId },
        include: {
          items: { include: { product: true } },
          payments: true
        }
      });
    });
  }
}
