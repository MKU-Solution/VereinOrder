import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { PrismaClient, ProductAvailability } from "@vereinorder/database";
import { PRISMA_CLIENT } from "../prisma/prisma.module";
import { RealtimeService } from "../realtime/realtime.service";
import { GroupInput, saveOptionGroups } from "./product-option-groups";
import { productAtStationFilter } from "../common/target-station";

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

// Seit Issue #84 ist Product.categoryId Pflicht: ohne Kategorie waere die
// Zielstation unbestimmt (siehe target-station.ts). Anlegen ohne Kategorie
// und das nachtraegliche Leeren des Felds werden beide hier abgewiesen,
// bevor Prisma die Fremdschluesselregel (Restrict) ueberhaupt sieht.
const PRODUCT_CATEGORY_REQUIRED_MESSAGE =
  "Jedes Produkt braucht eine Kategorie. Bitte eine Kategorie auswählen.";

// Bekannte Kategoriefelder aus dem Prisma-Modell `ProductCategory`. Analog zu
// PRODUCT_FIELD_KEYS: die Nutzlast von createCategory/updateCategory wird auf
// diese Felder begrenzt, statt den Anfragekoerper ungefiltert an Prisma
// durchzureichen.
const CATEGORY_FIELD_KEYS = [
  "name",
  "sortOrder",
  "eventId",
  "targetStationId",
] as const;

function pickCategoryFields(data: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const key of CATEGORY_FIELD_KEYS) {
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
        // include statt bloßem true, damit die Zielstation der Kategorie
        // mitkommt (Issue #84): ohne sie kennt die Verwaltung nur die
        // Ausnahme am Produkt, nicht was ohne eigenen Eintrag gilt.
        category: { include: { targetStation: true } },
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
        category: { include: { targetStation: true } },
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
      where: productAtStationFilter(stationId),
      include: { category: true },
      orderBy: { sortOrder: "asc" },
    });
  }

  private async findProductAdmin(id: string) {
    return this.prisma.product.findUnique({
      where: { id },
      include: {
        category: { include: { targetStation: true } },
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

    if (!productFields.categoryId) {
      throw new BadRequestException(PRODUCT_CATEGORY_REQUIRED_MESSAGE);
    }

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

    // categoryId ist Pflicht (Issue #84): ein Update darf das Feld nicht auf
    // leer setzen. Fehlt der Schlüssel ganz, wird die Kategorie schlicht
    // nicht angetastet, das ist erlaubt.
    if ("categoryId" in productFields && !productFields.categoryId) {
      throw new BadRequestException(PRODUCT_CATEGORY_REQUIRED_MESSAGE);
    }

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

  // Prueft, dass eine als Zielstation gewaehlte Station zur selben
  // Veranstaltung gehoert wie die Kategorie. Ohne diese Pruefung koennte eine
  // Kategorie eine Station eines fremden Events tragen, deren Bon dann nie
  // an einer real existierenden Station des eigenen Events ankaeme.
  private async assertStationBelongsToEvent(
    stationId: string,
    eventId: string,
  ) {
    const station = await this.prisma.station.findUnique({
      where: { id: stationId },
      select: { eventId: true },
    });
    if (!station || station.eventId !== eventId) {
      throw new BadRequestException(
        "Die gewählte Station gehört nicht zu dieser Veranstaltung.",
      );
    }
  }

  async createCategory(data: any) {
    const categoryFields = pickCategoryFields(data ?? {});

    if (!categoryFields.eventId) {
      throw new BadRequestException(
        "Eine Kategorie muss einer Veranstaltung zugeordnet sein.",
      );
    }
    if (categoryFields.targetStationId) {
      await this.assertStationBelongsToEvent(
        categoryFields.targetStationId,
        categoryFields.eventId,
      );
    }

    return this.prisma.productCategory.create({ data: categoryFields as any });
  }

  async updateCategory(id: string, data: any) {
    const existing = await this.prisma.productCategory.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException("Kategorie nicht gefunden");

    const categoryFields = pickCategoryFields(data ?? {});
    if (categoryFields.targetStationId) {
      const eventId = categoryFields.eventId ?? existing.eventId;
      await this.assertStationBelongsToEvent(
        categoryFields.targetStationId,
        eventId,
      );
    }

    return this.prisma.productCategory.update({
      where: { id },
      data: categoryFields,
    });
  }
}
