import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@vereinorder/database';
import { PRISMA_CLIENT } from '../prisma/prisma.module';

interface CreateOrderDto {
  eventId: string;
  items: { productId: string; quantity: number }[];
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

    return await this.prisma.$transaction(async (prisma) => {
      const order = await prisma.order.create({
        data: {
          totalAmount,
          status: 'PENDING',
          userId,
          eventId: dto.eventId,
          items: {
            create: orderItemsData
          }
        },
        include: {
          items: {
            include: {
              product: true
            }
          }
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
}
