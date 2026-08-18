import { Injectable, Inject } from '@nestjs/common';
import { PrismaClient } from '@vereinorder/database';
import { PRISMA_CLIENT } from '../prisma/prisma.module';

@Injectable()
export class ProductsService {
  constructor(@Inject(PRISMA_CLIENT) private prisma: PrismaClient) {}

  async findAllActive() {
    return this.prisma.product.findMany({
      where: {
        availability: 'AVAILABLE',
        event: { status: 'ACTIVE' } // simplified for MVP, assume fetching for the active event
      },
      include: {
        category: true,
      },
      orderBy: [
        { category: { sortOrder: 'asc' } },
        { sortOrder: 'asc' }
      ]
    });
  }

  // --- ADMIN METHODS: PRODUCTS ---
  
  async findAllProductsAdmin(eventId: string) {
    return this.prisma.product.findMany({
      where: { eventId },
      include: { category: true, targetStation: true },
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
