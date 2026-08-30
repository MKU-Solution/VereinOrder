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
import { resolveOperationalDataMode } from "../common/operational-data-mode";
import { effectiveAvailability } from "../inventory/inventory.service";
import {
  CreateCategoryDto,
  CreateProductDto,
  UpdateCategoryDto,
  UpdateProductDto,
} from "./dto/product.dto";

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
const PRODUCT_CREATE_FIELD_KEYS = [
  "name",
  "shortName",
  "description",
  "price",
  "deposit",
  "taxRate",
  "color",
  "sortOrder",
  "imageUrl",
  "manualAvailability",
  "categoryId",
  "targetStationId",
  "eventId",
] as const;
const PRODUCT_UPDATE_FIELD_KEYS = [
  "name",
  "shortName",
  "description",
  "price",
  "deposit",
  "taxRate",
  "color",
  "sortOrder",
  "imageUrl",
  "manualAvailability",
  "categoryId",
  "targetStationId",
] as const;

function pickProductFields<T extends object, K extends readonly (keyof T)[]>(
  data: T,
  keys: K,
): Pick<T, K[number]> {
  const result = {} as Pick<T, K[number]>;
  for (const key of keys) {
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
const CATEGORY_CREATE_FIELD_KEYS = [
  "name",
  "sortOrder",
  "deposit",
  "eventId",
  "targetStationId",
] as const;
const CATEGORY_UPDATE_FIELD_KEYS = [
  "name",
  "sortOrder",
  "deposit",
  "targetStationId",
] as const;

function pickCategoryFields<T extends object, K extends readonly (keyof T)[]>(
  data: T,
  keys: K,
): Pick<T, K[number]> {
  const result = {} as Pick<T, K[number]>;
  for (const key of keys) {
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

  private inventoryFacade(product: any) {
    const mode = resolveOperationalDataMode(product.event);
    const stock =
      product.inventoryStocks?.find((item: any) => item.dataMode === mode) ??
      null;
    return {
      ...product,
      availability: effectiveAvailability(product.manualAvailability, stock),
      inventoryTracked: !!stock?.trackingEnabled,
      stockQuantity: stock?.trackingEnabled ? stock.stockQuantity : null,
      lowStockThreshold: stock?.trackingEnabled
        ? stock.lowStockThreshold
        : null,
      inventoryVersion: stock?.version ?? 0,
    };
  }

  async findAllActive() {
    const products = await this.prisma.product.findMany({
      where: {
        manualAvailability: { not: "DISABLED" },
        event: { status: { in: ["ACTIVE", "TEST_MODE"] } },
      },
      include: {
        event: { select: { status: true, testMode: true } },
        inventoryStocks: true,
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
    return products.map((product) => this.inventoryFacade(product));
  }

  async updateAvailability(
    id: string,
    availability: ProductAvailability,
    userId?: string,
  ) {
    // Bestand wird mitgeladen (nur so, wie inventoryFacade ihn ohnehin
    // braucht), damit die Rundmeldung unten dieselbe effektive
    // Verfuegbarkeit tragen kann wie jeder andere Meldeweg im Projekt.
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        event: { select: { status: true, testMode: true } },
        inventoryStocks: true,
      },
    });
    if (!product) throw new NotFoundException("Product not found");

    const updated = await this.prisma.product.update({
      where: { id },
      data: { manualAvailability: availability },
    });

    // An die Kassen geht die effektive Verfuegbarkeit, nicht der rohe
    // manuelle Override: ein bestandsgefuehrtes Produkt mit Menge 0 bleibt
    // OUT_OF_STOCK, unabhaengig davon, was die Verwaltung manuell setzt
    // (siehe effectiveAvailability in inventory.service.ts). Die Ableitung
    // der Betriebsart kommt aus der bereits vorhandenen inventoryFacade,
    // statt sie hier ein weiteres Mal nachzubauen.
    const effective = this.inventoryFacade({
      ...product,
      manualAvailability: updated.manualAvailability,
    });

    this.realtimeService.broadcast(
      product.eventId,
      "PRODUCT_AVAILABILITY_CHANGED",
      {
        productId: updated.id,
        productName: updated.name,
        availability: effective.availability,
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
            previousAvailability: product.manualAvailability,
            newAvailability: updated.manualAvailability,
          },
        },
      });
    }

    return updated;
  }

  // --- ADMIN METHODS: PRODUCTS ---

  async findAllProductsAdmin(eventId: string) {
    const products = await this.prisma.product.findMany({
      where: { eventId },
      include: {
        event: { select: { status: true, testMode: true } },
        inventoryStocks: true,
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
    return products.map((product) => this.inventoryFacade(product));
  }

  async findByStation(stationId: string) {
    const products = await this.prisma.product.findMany({
      where: productAtStationFilter(stationId),
      include: {
        category: true,
        event: { select: { status: true, testMode: true } },
        inventoryStocks: true,
      },
      orderBy: { sortOrder: "asc" },
    });
    return products.map((product) => this.inventoryFacade(product));
  }

  private async findProductAdmin(id: string) {
    return this.prisma.product.findUnique({
      where: { id },
      include: {
        // create/update liefern dieselbe effektive Inventar-Fassade wie die
        // Produktlisten. Dazu muss der Betriebsmodus des Events zusammen mit
        // allen getrennten TEST-/LIVE-Zählern geladen werden.
        event: { select: { status: true, testMode: true } },
        inventoryStocks: true,
        category: { include: { targetStation: true } },
        targetStation: true,
        optionGroups: {
          include: { options: { orderBy: OPTION_ORDER_BY } },
          orderBy: OPTION_ORDER_BY,
        },
      },
    });
  }

  async createProduct(data: CreateProductDto, userId?: string) {
    const { optionGroups, ...rest } = data;
    const productFields = pickProductFields(rest, PRODUCT_CREATE_FIELD_KEYS);

    if (!productFields.categoryId) {
      throw new BadRequestException(PRODUCT_CATEGORY_REQUIRED_MESSAGE);
    }

    await this.assertProductRelations(
      productFields.categoryId,
      productFields.targetStationId,
      productFields.eventId,
    );
    const product = await this.prisma.$transaction(async (tx) => {
      const created = await tx.product.create({ data: productFields });

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

    const detailed = await this.findProductAdmin(product.id);
    return detailed
      ? this.inventoryFacade(detailed)
      : this.inventoryFacade({ ...product, inventoryStocks: [] });
  }

  async updateProduct(id: string, data: UpdateProductDto, userId?: string) {
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Product not found");

    const { optionGroups, ...rest } = data;
    const productFields = pickProductFields(rest, PRODUCT_UPDATE_FIELD_KEYS);

    // categoryId ist Pflicht (Issue #84): ein Update darf das Feld nicht auf
    // leer setzen. Fehlt der Schlüssel ganz, wird die Kategorie schlicht
    // nicht angetastet, das ist erlaubt.
    if ("categoryId" in productFields && !productFields.categoryId) {
      throw new BadRequestException(PRODUCT_CATEGORY_REQUIRED_MESSAGE);
    }

    await this.assertProductRelations(
      productFields.categoryId,
      productFields.targetStationId,
      existing.eventId,
      existing.categoryId,
    );
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

    const detailed = await this.findProductAdmin(id);
    return detailed
      ? this.inventoryFacade(detailed)
      : this.inventoryFacade({ ...updated, inventoryStocks: [] });
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

  async createCategory(data: CreateCategoryDto) {
    const categoryFields = pickCategoryFields(data, CATEGORY_CREATE_FIELD_KEYS);

    if (!categoryFields.eventId) {
      throw new BadRequestException(
        "Eine Kategorie muss einer Veranstaltung zugeordnet sein.",
      );
    }
    const event = await this.prisma.event.findUnique({
      where: { id: categoryFields.eventId },
      select: { id: true },
    });
    if (!event) {
      throw new BadRequestException(
        "Die gewählte Veranstaltung existiert nicht.",
      );
    }
    if (categoryFields.targetStationId) {
      await this.assertStationBelongsToEvent(
        categoryFields.targetStationId,
        categoryFields.eventId,
      );
    }

    return this.prisma.productCategory.create({ data: categoryFields });
  }

  async updateCategory(id: string, data: UpdateCategoryDto) {
    const existing = await this.prisma.productCategory.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException("Kategorie nicht gefunden");

    const categoryFields = pickCategoryFields(data, CATEGORY_UPDATE_FIELD_KEYS);
    if (categoryFields.targetStationId) {
      await this.assertStationBelongsToEvent(
        categoryFields.targetStationId,
        existing.eventId,
      );
    }

    return this.prisma.productCategory.update({
      where: { id },
      data: categoryFields,
    });
  }

  private async assertProductRelations(
    categoryId: string | undefined,
    targetStationId: string | null | undefined,
    eventId: string,
    fallbackCategoryId?: string,
  ) {
    const resolvedCategoryId = categoryId ?? fallbackCategoryId;
    if (!resolvedCategoryId)
      throw new BadRequestException(PRODUCT_CATEGORY_REQUIRED_MESSAGE);
    const category = await this.prisma.productCategory.findUnique({
      where: { id: resolvedCategoryId },
      select: { eventId: true },
    });
    if (!category || category.eventId !== eventId)
      throw new BadRequestException(
        "Die gewählte Kategorie gehört nicht zu dieser Veranstaltung.",
      );
    if (targetStationId)
      await this.assertStationBelongsToEvent(targetStationId, eventId);
  }
}
