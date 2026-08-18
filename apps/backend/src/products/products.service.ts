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
}
