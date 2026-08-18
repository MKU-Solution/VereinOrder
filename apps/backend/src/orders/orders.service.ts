import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@vereinorder/database';
import { PRISMA_CLIENT } from '../prisma/prisma.module';

interface CreateOrderDto {
  eventId: string;
  items: { productId: string; quantity: number }[];
  payments?: { amount: number, method: 'CASH' | 'CARD' | 'VOUCHER' }[];
}

@Injectable()
export class OrdersService {
  constructor(@Inject(PRISMA_CLIENT) private prisma: PrismaClient) {}

  async createOrder(userId: string, dto: CreateOrderDto) {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Order must contain at least one item');
    }

    const productIds = dto.items.map(i => i.productId);
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } }
    });

    const productMap = new Map(products.map(p => [p.id, p]));
    
    let totalAmount = 0;
    const orderItemsData = dto.items.map(item => {
      const product = productMap.get(item.productId);
      if (!product) throw new BadRequestException(`Product ${item.productId} not found`);
      if (product.availability !== 'AVAILABLE') throw new BadRequestException(`Product ${product.name} is not available`);
      
      const itemTotal = product.price * item.quantity;
      totalAmount += itemTotal;

      return {
        productId: product.id,
        quantity: item.quantity,
        priceAtTime: product.price,
        status: 'PENDING' as any
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
