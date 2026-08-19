import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { PrismaClient, ProductAvailability } from '@vereinorder/database';
import { PRISMA_CLIENT } from '../prisma/prisma.module';
import { RealtimeService } from '../realtime/realtime.service';

@Injectable()
export class ProductsService {
  constructor(
    @Inject(PRISMA_CLIENT) private prisma: PrismaClient,
    private realtimeService: RealtimeService
  ) {}

  async findAllActive() {
    return this.prisma.product.findMany({
      where: {
        availability: { not: 'DISABLED' },
        event: { status: { in: ['ACTIVE', 'TEST_MODE'] } } 
      },
      include: {
        category: true,
        variants: { orderBy: { sortOrder: 'asc' } },
        extras: { orderBy: { sortOrder: 'asc' } }
      },
      orderBy: [
        { category: { sortOrder: 'asc' } },
        { sortOrder: 'asc' }
      ]
    });
  }

  async updateAvailability(id: string, availability: ProductAvailability, userId?: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException('Product not found');

    const updated = await this.prisma.product.update({
      where: { id },
      data: { availability }
    });

    this.realtimeService.broadcast(product.eventId, 'PRODUCT_AVAILABILITY_CHANGED', {
      productId: updated.id,
      productName: updated.name,
      availability: updated.availability
    });

    if (userId) {
      await this.prisma.auditLog.create({
        data: {
          action: 'PRODUCT_AVAILABILITY_CHANGED',
          entityId: id,
          entityType: 'Product',
          userId,
          details: {
            productName: updated.name,
            previousAvailability: product.availability,
            newAvailability: updated.availability
          }
        }
      });
    }

    return updated;
  }

  // --- ADMIN METHODS: PRODUCTS ---
  
  async findAllProductsAdmin(eventId: string) {
    return this.prisma.product.findMany({
      where: { eventId },
      include: { category: true, targetStation: true },
      orderBy: { sortOrder: 'asc' }
    });
  }

  async findByStation(stationId: string) {
    return this.prisma.product.findMany({
      where: { targetStationId: stationId },
      include: { category: true },
      orderBy: { sortOrder: 'asc' }
    });
  }

  async createProduct(data: any) {
    return this.prisma.product.create({ data });
  }

  async updateProduct(id: string, data: any) {
    return this.prisma.product.update({ where: { id }, data });
  }

  // --- ADMIN METHODS: CATEGORIES ---

  async findAllCategoriesAdmin(eventId: string) {
    return this.prisma.productCategory.findMany({
      where: { eventId },
      orderBy: { sortOrder: 'asc' }
    });
  }

  async createCategory(data: any) {
    return this.prisma.productCategory.create({ data });
  }

  async updateCategory(id: string, data: any) {
    return this.prisma.productCategory.update({ where: { id }, data });
  }
}
