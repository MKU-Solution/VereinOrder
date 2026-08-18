import { Injectable, Inject } from '@nestjs/common';
import { PrismaClient } from '@vereinorder/database';
import { PRISMA_CLIENT } from '../prisma/prisma.module';

@Injectable()
export class ReportsService {
  constructor(@Inject(PRISMA_CLIENT) private prisma: PrismaClient) {}

  async getSummary() {
    // For MVP we just sum up everything that is not CANCELLED
    const aggregations = await this.prisma.order.aggregate({
      _sum: { totalAmount: true },
      _count: { id: true },
      where: {
        status: { not: 'CANCELLED' }
      }
    });

    return {
      totalAmount: aggregations._sum.totalAmount || 0,
      orderCount: aggregations._count.id || 0
    };
  }

  async getProductsSummary() {
    const items = await this.prisma.orderItem.findMany({
      where: {
        status: { not: 'CANCELLED' },
        order: { status: { not: 'CANCELLED' } }
      },
      include: { product: true }
    });

    // Aggregate by product
    const productMap = new Map<string, { id: string, name: string, quantity: number, revenue: number }>();
    
    for (const item of items) {
      if (!productMap.has(item.productId)) {
        productMap.set(item.productId, {
          id: item.productId,
          name: item.product.name,
          quantity: 0,
          revenue: 0
        });
      }
      const entry = productMap.get(item.productId)!;
      entry.quantity += item.quantity;
      entry.revenue += (item.quantity * item.priceAtTime);
    }

    return Array.from(productMap.values()).sort((a, b) => b.quantity - a.quantity);
  }

  async getUsersSummary() {
    const orders = await this.prisma.order.findMany({
      where: { status: { not: 'CANCELLED' } },
      include: { user: true }
    });

    const userMap = new Map<string, { id: string, username: string, orderCount: number, revenue: number }>();

    for (const order of orders) {
      if (!userMap.has(order.userId)) {
        userMap.set(order.userId, {
          id: order.userId,
          username: order.user.username,
          orderCount: 0,
          revenue: 0
        });
      }
      const entry = userMap.get(order.userId)!;
      entry.orderCount += 1;
      entry.revenue += order.totalAmount;
    }

    return Array.from(userMap.values()).sort((a, b) => b.revenue - a.revenue);
  }
}
