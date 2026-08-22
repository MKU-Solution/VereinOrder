import { Injectable, Inject, NotFoundException } from "@nestjs/common";
import { PrismaClient, ProductAvailability } from "@vereinorder/database";
import { PRISMA_CLIENT } from "../prisma/prisma.module";
import { RealtimeService } from "../realtime/realtime.service";
import { GroupInput, saveOptionGroups } from "./product-option-groups";

// Sortierung laut docs/development/produktoptionen-datenmodell.md
// ("Sortierung"): sortOrder, dann name, dann id, jeweils aufsteigend.
const OPTION_ORDER_BY = [
  { sortOrder: "asc" as const },
  { name: "asc" as const },
  { id: "asc" as const },
];

// Bekannte Produktfelder aus dem Prisma-Modell `Product`. Die Nutzlast von
// createProduct/updateProduct wird ausdruecklich auf diese Felder begrenzt,
// damit `optionGroups` (verschachtelte Pflege, Issue #75) nicht ungefiltert
// an Prisma durchgereicht wird.
const PRODUCT_FIELD_KEYS = [
  "name",
  "shortName",
  "description",
  "price",
  "taxRate",
  "color",
  "sortOrder",
  "imageUrl",
  "availability",
  "categoryId",
  "targetStationId",
  "eventId",
] as const;

function pickProductFields(data: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const key of PRODUCT_FIELD_KEYS) {
    if (key in data) {
      result[key] = data[key];
    }
  }
  return result;
}

@Injectable()
export class ProductsService {
  constructor(
    @Inject(PRISMA_CLIENT) private prisma: PrismaClient,
    private realtimeService: RealtimeService,
  ) {}

  async findAllActive() {
    return this.prisma.product.findMany({
      where: {
        availability: { not: "DISABLED" },
        event: { status: { in: ["ACTIVE", "TEST_MODE"] } },
      },
      include: {
        category: true,
        optionGroups: {
          include: {
            options: {
              where: { isActive: true },
              orderBy: OPTION_ORDER_BY,
            },
          },
          orderBy: OPTION_ORDER_BY,
        },
      },
      orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }],
    });
  }

  async updateAvailability(
    id: string,
    availability: ProductAvailability,
    userId?: string,
  ) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException("Product not found");

    const updated = await this.prisma.product.update({
      where: { id },
      data: { availability },
    });

    this.realtimeService.broadcast(
      product.eventId,
      "PRODUCT_AVAILABILITY_CHANGED",
      {
        productId: updated.id,
        productName: updated.name,
        availability: updated.availability,
      },
    );

    if (userId) {
      await this.prisma.auditLog.create({
        data: {
          action: "PRODUCT_AVAILABILITY_CHANGED",
          entityId: id,
          entityType: "Product",
          userId,
          details: {
            productName: updated.name,
            previousAvailability: product.availability,
            newAvailability: updated.availability,
          },
        },
      });
    }

    return updated;
  }

  // --- ADMIN METHODS: PRODUCTS ---

  async findAllProductsAdmin(eventId: string) {
    return this.prisma.product.findMany({
      where: { eventId },
      include: {
        category: true,
        targetStation: true,
        // Admin-Ansicht liefert ALLE Optionen, auch inaktive, sonst kann
        // die Verwaltung eine inaktive Antwort nie wieder aktivieren.
        optionGroups: {
          include: { options: { orderBy: OPTION_ORDER_BY } },
          orderBy: OPTION_ORDER_BY,
        },
      },
      orderBy: { sortOrder: "asc" },
    });
  }

  async findByStation(stationId: string) {
    return this.prisma.product.findMany({
      where: { targetStationId: stationId },
      include: { category: true },
      orderBy: { sortOrder: "asc" },
    });
  }

  private async findProductAdmin(id: string) {
    return this.prisma.product.findUnique({
      where: { id },
      include: {
        category: true,
        targetStation: true,
        optionGroups: {
          include: { options: { orderBy: OPTION_ORDER_BY } },
          orderBy: OPTION_ORDER_BY,
        },
      },
    });
  }

  async createProduct(data: any, userId?: string) {
    const { optionGroups, ...rest } = data ?? {};
    const productFields = pickProductFields(rest);

    const product = await this.prisma.$transaction(async (tx) => {
      const created = await tx.product.create({ data: productFields as any });

      if (optionGroups !== undefined) {
        await saveOptionGroups(tx, created.id, optionGroups as GroupInput[]);
      }

      if (userId) {
        await tx.auditLog.create({
          data: {
            action: "PRODUCT_CREATED",
            entityId: created.id,
            entityType: "Product",
            userId,
            details: {
              name: created.name,
              price: created.price,
              eventId: created.eventId,
            },
          },
        });
      }

      return created;
    });

    return (await this.findProductAdmin(product.id)) ?? product;
  }

  async updateProduct(id: string, data: any, userId?: string) {
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Product not found");

    const { optionGroups, ...rest } = data ?? {};
    const productFields = pickProductFields(rest);

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.product.update({
        where: { id },
        data: productFields,
      });

      if (optionGroups !== undefined) {
        await saveOptionGroups(tx, id, optionGroups as GroupInput[]);
      }

      if (userId) {
        const isPriceChanged =
          productFields.price !== undefined &&
          productFields.price !== existing.price;
        await tx.auditLog.create({
          data: {
            action: isPriceChanged ? "PRICE_CHANGED" : "PRODUCT_UPDATED",
            entityId: id,
            entityType: "Product",
            userId,
            details: {
              name: result.name,
              previousPrice: existing.price,
              newPrice: result.price,
              changedFields: Object.keys(productFields),
            },
          },
        });
      }

      return result;
    });

    return (await this.findProductAdmin(id)) ?? updated;
  }

  // --- ADMIN METHODS: CATEGORIES ---

  async findAllCategoriesAdmin(eventId: string) {
    return this.prisma.productCategory.findMany({
      where: { eventId },
      orderBy: { sortOrder: "asc" },
    });
  }

  async createCategory(data: any) {
    return this.prisma.productCategory.create({ data });
  }

  async updateCategory(id: string, data: any) {
    return this.prisma.productCategory.update({ where: { id }, data });
  }
}
