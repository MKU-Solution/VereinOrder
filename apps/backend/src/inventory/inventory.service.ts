import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash } from "crypto";
import {
  OperationalDataMode,
  Prisma,
  PrismaClient,
  ProductAvailability,
} from "@vereinorder/database";
import { PRISMA_CLIENT } from "../prisma/prisma.module";
import { RealtimeService } from "../realtime/realtime.service";
import { resolveOperationalDataMode } from "../common/operational-data-mode";

export type StockLike = {
  trackingEnabled: boolean;
  stockQuantity: number;
  lowStockThreshold: number;
  manualBlocked: boolean;
  version: number;
} | null;

export type InventorySaleLine = {
  productId: string;
  quantity: number;
  productName: string;
  manualAvailability: ProductAvailability;
  // Issue #170: Gruppenschalter der Warengruppe (ProductCategory.isActive).
  // Optional und ausschliesslich als expliziter Ausschluss ausgewertet
  // (=== false), damit bestehende Aufrufer und Tests ohne dieses Feld
  // unveraendert als aktiv gelten - derselbe Grundsatz wie ueberall im
  // Projekt: eine manuelle Uebersteuerung schraenkt nur ein, sie erweitert
  // nie.
  categoryActive?: boolean;
};

export type ReservedInventorySale = {
  productId: string;
  quantity: number;
  quantityBefore: number;
  quantityAfter: number;
  lowStockThreshold: number;
  version: number;
  manualAvailability: ProductAvailability;
  productName: string;
};

export type InventoryChange = {
  productId: string;
  stockQuantity: number;
  lowStockThreshold: number;
  version: number;
  manualAvailability: ProductAvailability;
  // Issue #141, Fehler B: publishChanges traegt den Produktnamen in die
  // Realtime-Nutzlast (PRODUCT_INVENTORY_CHANGED), damit die Warnhinweise
  // in Dashboard.tsx ("... ist soeben AUSVERKAUFT!") nicht "undefined"
  // anzeigen. Der manuelle Verfuegbarkeitsweg (PRODUCT_AVAILABILITY_CHANGED,
  // products.service.ts) sendet ihn schon; der automatische Bestandsweg
  // brauchte ihn bislang nicht, weil ihn keine der drei Sendestellen kannte.
  productName: string;
};
export function effectiveAvailability(
  manual: ProductAvailability,
  stock: StockLike,
): ProductAvailability {
  if (manual === "DISABLED") return "DISABLED";
  if (manual === "OUT_OF_STOCK" || stock?.manualBlocked) return "OUT_OF_STOCK";
  if (stock?.trackingEnabled && stock.stockQuantity === 0)
    return "OUT_OF_STOCK";
  if (
    manual === "LOW_STOCK" ||
    (stock?.trackingEnabled && stock.stockQuantity <= stock.lowStockThreshold)
  )
    return "LOW_STOCK";
  return "AVAILABLE";
}
@Injectable()
export class InventoryService {
  constructor(
    @Inject(PRISMA_CLIENT) private prisma: PrismaClient,
    private realtime: RealtimeService,
  ) {}
  private fingerprint(value: unknown) {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
  }
  private async eventMode(
    tx: Prisma.TransactionClient,
    eventId: string,
    dataMode: OperationalDataMode,
  ) {
    const event = await tx.event.findUnique({
      where: { id: eventId },
      select: { status: true, testMode: true },
    });
    if (!event) throw new NotFoundException("Veranstaltung nicht gefunden");
    const actual = resolveOperationalDataMode(event);
    if (!actual || actual !== dataMode)
      throw new BadRequestException(
        "Betriebsmodus der Veranstaltung stimmt nicht mit dataMode überein.",
      );
  }
  private async product(
    tx: Prisma.TransactionClient,
    productId: string,
    eventId: string,
  ) {
    const product = await tx.product.findUnique({ where: { id: productId } });
    if (!product || product.eventId !== eventId)
      throw new NotFoundException(
        "Produkt gehört nicht zu dieser Veranstaltung.",
      );
    return product;
  }
  private async existing(
    tx: Prisma.TransactionClient,
    key: string,
    fingerprint: string,
  ) {
    const item = await tx.inventoryMovement.findUnique({
      where: { idempotencyKey: key },
    });
    if (!item) return null;
    if (item.requestFingerprint !== fingerprint)
      throw new ConflictException(
        "Idempotency-Key wurde bereits mit anderer Anfrage verwendet.",
      );
    return item;
  }
  private facade(
    product: { manualAvailability: ProductAvailability },
    stock: StockLike,
  ) {
    return {
      availability: effectiveAvailability(product.manualAvailability, stock),
      inventoryTracked: !!stock?.trackingEnabled,
      stockQuantity: stock?.trackingEnabled ? stock.stockQuantity : null,
      lowStockThreshold: stock?.trackingEnabled
        ? stock.lowStockThreshold
        : null,
      inventoryVersion: stock?.version ?? 0,
    };
  }

  /**
   * Zentrale Verkaufsreservierung innerhalb der Bestelltransaktion.
   *
   * Es wird absichtlich nicht mit Prisma `update` gearbeitet: die
   * Bedingung `stockQuantity >= requested` muss zusammen mit dem Write in
   * derselben SQL-Anweisung gelten. Die aufsteigende Produktsortierung ist
   * der globale Lockvertrag fuer parallele Kassen.
   */
  async reserveSale(
    tx: Prisma.TransactionClient,
    input: {
      eventId: string;
      dataMode: OperationalDataMode;
      lines: InventorySaleLine[];
    },
  ): Promise<ReservedInventorySale[]> {
    const quantities = new Map<string, InventorySaleLine>();
    for (const line of input.lines) {
      const current = quantities.get(line.productId);
      quantities.set(line.productId, {
        ...line,
        quantity: (current?.quantity ?? 0) + line.quantity,
      });
    }
    const productIds = [...quantities.keys()].sort();
    if (productIds.length === 0) return [];

    const stocks = await tx.$queryRaw<
      (StockLike & { productId: string })[]
    >(Prisma.sql`
      SELECT "productId", "trackingEnabled", "stockQuantity",
             "lowStockThreshold", "manualBlocked", "version"
      FROM "InventoryStock"
      WHERE "eventId" = ${input.eventId}
        AND "dataMode" = ${input.dataMode}::"OperationalDataMode"
        AND "productId" IN (${Prisma.join(productIds)})
      ORDER BY "productId" ASC
      FOR UPDATE
    `);
    const stockByProductId = new Map(
      stocks.map((stock) => [stock.productId, stock]),
    );
    const changes: ReservedInventorySale[] = [];

    for (const productId of productIds) {
      const line = quantities.get(productId)!;
      const stock = stockByProductId.get(productId) ?? null;
      if (
        line.manualAvailability === "DISABLED" ||
        line.manualAvailability === "OUT_OF_STOCK" ||
        stock?.manualBlocked ||
        // Issue #170: eine stillgelegte Warengruppe ist derselbe harte
        // Ausschluss wie manualAvailability "DISABLED", nicht ein
        // Bestandszustand - deshalb hier und nicht bei der
        // Mengenverfuegbarkeit unten geprueft.
        line.categoryActive === false
      ) {
        throw new ConflictException({
          code: "PRODUCT_UNAVAILABLE",
          product: { id: productId, name: line.productName },
          requested: line.quantity,
          available: stock?.trackingEnabled ? stock.stockQuantity : null,
        });
      }
      // Kein Bestandssatz und absichtlich nicht nachverfolgter Bestand sind
      // mengenmaessig unbegrenzt. Der manuelle Override oben gilt trotzdem.
      if (!stock?.trackingEnabled) continue;
      if (stock.stockQuantity < line.quantity) {
        throw new ConflictException({
          code: "INVENTORY_INSUFFICIENT",
          product: { id: productId, name: line.productName },
          requested: line.quantity,
          available: stock.stockQuantity,
        });
      }

      const updated = await tx.$queryRaw<
        {
          stockQuantity: number;
          lowStockThreshold: number;
          version: number;
        }[]
      >(Prisma.sql`
        UPDATE "InventoryStock"
        SET "stockQuantity" = "stockQuantity" - ${line.quantity},
            "version" = "version" + 1,
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE "productId" = ${productId}
          AND "eventId" = ${input.eventId}
          AND "dataMode" = ${input.dataMode}::"OperationalDataMode"
          AND "trackingEnabled" = true
          AND "manualBlocked" = false
          AND "stockQuantity" >= ${line.quantity}
        RETURNING "stockQuantity", "lowStockThreshold", "version"
      `);
      if (updated.length !== 1) {
        throw new ConflictException({
          code: "INVENTORY_INSUFFICIENT",
          product: { id: productId, name: line.productName },
          requested: line.quantity,
          available: stock.stockQuantity,
        });
      }
      changes.push({
        productId,
        quantity: line.quantity,
        quantityBefore: stock.stockQuantity,
        quantityAfter: updated[0].stockQuantity,
        lowStockThreshold: updated[0].lowStockThreshold,
        version: updated[0].version,
        manualAvailability: line.manualAvailability,
        productName: line.productName,
      });
    }
    return changes;
  }

  /** Schreibt die unveränderlichen SALE-Zeilen erst nachdem die Positionen IDs haben. */
  async recordSales(
    tx: Prisma.TransactionClient,
    input: {
      eventId: string;
      dataMode: OperationalDataMode;
      orderId: string;
      actorUserId: string;
      reservations: ReservedInventorySale[];
      items: { id: string; productId: string; quantity: number }[];
    },
  ): Promise<InventoryChange[]> {
    const reservations = new Map(
      input.reservations.map((reservation) => [
        reservation.productId,
        reservation,
      ]),
    );
    const nextQuantity = new Map(
      input.reservations.map((reservation) => [
        reservation.productId,
        reservation.quantityBefore,
      ]),
    );
    for (const item of [...input.items].sort((left, right) =>
      left.id.localeCompare(right.id),
    )) {
      const reservation = reservations.get(item.productId);
      if (!reservation) continue;
      const before = nextQuantity.get(item.productId)!;
      const after = before - item.quantity;
      await tx.inventoryMovement.create({
        data: {
          type: "SALE",
          quantityDelta: -item.quantity,
          quantityBefore: before,
          quantityAfter: after,
          productId: item.productId,
          eventId: input.eventId,
          dataMode: input.dataMode,
          orderId: input.orderId,
          orderItemId: item.id,
          actorUserId: input.actorUserId,
          idempotencyKey: `inventory:sale:${item.id}`,
          requestFingerprint: this.fingerprint({
            type: "SALE",
            orderId: input.orderId,
            orderItemId: item.id,
            productId: item.productId,
            quantity: item.quantity,
          }),
        },
      });
      nextQuantity.set(item.productId, after);
    }
    return input.reservations.map((reservation) => ({
      productId: reservation.productId,
      stockQuantity: reservation.quantityAfter,
      lowStockThreshold: reservation.lowStockThreshold,
      version: reservation.version,
      manualAvailability: reservation.manualAvailability,
      productName: reservation.productName,
    }));
  }

  /**
   * Bucht nur vorhandene SALE-Zeilen zurueck. Nach dem Sperren wird erneut
   * gelesen; dadurch sieht ein zweiter, wartender Storno die bereits
   * geschriebene Umkehrbewegung und kann den Bestand nicht erneut erhoehen.
   */
  async reverseSales(
    tx: Prisma.TransactionClient,
    input: {
      eventId: string;
      dataMode: OperationalDataMode;
      orderId: string;
      orderItemIds: string[];
      actorUserId: string;
      reason: string;
    },
  ): Promise<InventoryChange[]> {
    if (input.orderItemIds.length === 0) return [];
    const initialSales = await tx.inventoryMovement.findMany({
      where: {
        orderItemId: { in: input.orderItemIds },
        eventId: input.eventId,
        dataMode: input.dataMode,
        type: "SALE",
      },
      select: { productId: true },
    });
    const productIds = [
      ...new Set(initialSales.map((sale) => sale.productId)),
    ].sort();
    if (productIds.length === 0) return [];
    await tx.$queryRaw(Prisma.sql`
      SELECT "productId"
      FROM "InventoryStock"
      WHERE "eventId" = ${input.eventId}
        AND "dataMode" = ${input.dataMode}::"OperationalDataMode"
        AND "productId" IN (${Prisma.join(productIds)})
      ORDER BY "productId" ASC
      FOR UPDATE
    `);
    const sales = await tx.inventoryMovement.findMany({
      where: {
        orderItemId: { in: input.orderItemIds },
        eventId: input.eventId,
        dataMode: input.dataMode,
        type: "SALE",
        reversals: { none: {} },
      },
      orderBy: [{ productId: "asc" }, { orderItemId: "asc" }, { id: "asc" }],
    });
    if (sales.length === 0) return [];
    const stockByProductId = new Map(
      (
        await tx.inventoryStock.findMany({
          where: {
            eventId: input.eventId,
            dataMode: input.dataMode,
            productId: {
              in: [...new Set(sales.map((sale) => sale.productId))],
            },
          },
        })
      ).map((stock) => [stock.productId, stock]),
    );
    const changeByProduct = new Map<string, InventoryChange>();
    for (const sale of sales) {
      const stock = stockByProductId.get(sale.productId);
      if (!stock || !stock.trackingEnabled) continue;
      const quantity = -sale.quantityDelta;
      const updated = await tx.inventoryStock.update({
        where: {
          productId_eventId_dataMode: {
            productId: sale.productId,
            eventId: input.eventId,
            dataMode: input.dataMode,
          },
        },
        data: {
          stockQuantity: { increment: quantity },
          version: { increment: 1 },
        },
      });
      await tx.inventoryMovement.create({
        data: {
          type: "CANCELLATION",
          quantityDelta: quantity,
          quantityBefore: stock.stockQuantity,
          quantityAfter: stock.stockQuantity + quantity,
          productId: sale.productId,
          eventId: input.eventId,
          dataMode: input.dataMode,
          orderId: input.orderId,
          orderItemId: sale.orderItemId,
          reversesMovementId: sale.id,
          actorUserId: input.actorUserId,
          reason: input.reason,
          idempotencyKey: `inventory:cancellation:${sale.id}`,
          requestFingerprint: this.fingerprint({
            type: "CANCELLATION",
            saleMovementId: sale.id,
            orderId: input.orderId,
            orderItemId: sale.orderItemId,
            quantity,
          }),
        },
      });
      stockByProductId.set(sale.productId, updated);
      changeByProduct.set(sale.productId, {
        productId: sale.productId,
        stockQuantity: updated.stockQuantity,
        lowStockThreshold: updated.lowStockThreshold,
        version: updated.version,
        // Der finale Status wird beim Broadcast gegen den aktuellen
        // manuellen Override aufgeloest; hier reicht ein Platzhalter nicht.
        manualAvailability: "AVAILABLE",
        // Platzhalter wie oben bei manualAvailability - der echte Name kommt
        // erst mit der Produktabfrage unten (Issue #141, Fehler B).
        productName: "",
      });
    }
    const products = await tx.product.findMany({
      where: {
        id: { in: [...changeByProduct.keys()] },
        eventId: input.eventId,
      },
      select: { id: true, name: true, manualAvailability: true },
    });
    for (const product of products) {
      const change = changeByProduct.get(product.id);
      if (change) {
        change.manualAvailability = product.manualAvailability;
        change.productName = product.name;
      }
    }
    return [...changeByProduct.values()];
  }

  publishChanges(
    eventId: string,
    dataMode: OperationalDataMode,
    changes: InventoryChange[],
  ) {
    for (const change of changes) {
      this.realtime.broadcast(eventId, "PRODUCT_INVENTORY_CHANGED", {
        eventId,
        dataMode,
        productId: change.productId,
        // Issue #141, Fehler B: ohne productName setzte Dashboard.tsx den
        // Warnhinweis ("... ist soeben AUSVERKAUFT!") mit "undefined" statt
        // dem Produktnamen zusammen, weil diese Nutzlast das Feld nie trug.
        productName: change.productName,
        stockQuantity: change.stockQuantity,
        lowStockThreshold: change.lowStockThreshold,
        availability: effectiveAvailability(change.manualAvailability, {
          trackingEnabled: true,
          stockQuantity: change.stockQuantity,
          lowStockThreshold: change.lowStockThreshold,
          manualBlocked: false,
          version: change.version,
        }),
        version: change.version,
      });
    }
  }
  async detail(
    productId: string,
    eventId: string,
    dataMode: OperationalDataMode,
  ) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: { event: { select: { status: true, testMode: true } } },
    });
    if (!product || product.eventId !== eventId)
      throw new NotFoundException("Produkt nicht gefunden");
    if (resolveOperationalDataMode(product.event) !== dataMode)
      throw new BadRequestException(
        "Betriebsmodus der Veranstaltung stimmt nicht mit dataMode überein.",
      );
    const stock = await this.prisma.inventoryStock.findUnique({
      where: { productId_eventId_dataMode: { productId, eventId, dataMode } },
    });
    return {
      productId,
      eventId,
      dataMode,
      ...this.facade(product, stock),
      manualAvailability: product.manualAvailability,
      stock,
    };
  }
  async history(
    productId: string,
    eventId: string,
    dataMode: OperationalDataMode,
  ) {
    await this.detail(productId, eventId, dataMode);
    return this.prisma.inventoryMovement.findMany({
      where: { productId, eventId, dataMode },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
  }
  private async mutate(
    productId: string,
    input: any,
    userId: string,
    type: "INITIALIZATION" | "CORRECTION",
  ) {
    const fingerprint = this.fingerprint({ productId, ...input, type });
    const result = await this.prisma.$transaction(
      async (tx) => {
        await this.eventMode(tx, input.eventId, input.dataMode);
        const product = await this.product(tx, productId, input.eventId);
        const replay = await this.existing(
          tx,
          input.idempotencyKey,
          fingerprint,
        );
        if (replay) {
          const stock = await tx.inventoryStock.findUnique({
            where: {
              productId_eventId_dataMode: {
                productId,
                eventId: input.eventId,
                dataMode: input.dataMode,
              },
            },
          });
          return { product, stock, replay: true };
        }
        let stock = await tx.inventoryStock.findUnique({
          where: {
            productId_eventId_dataMode: {
              productId,
              eventId: input.eventId,
              dataMode: input.dataMode,
            },
          },
        });
        if (type === "INITIALIZATION") {
          if (stock)
            throw new ConflictException("Bestand wurde bereits initialisiert.");
          stock = await tx.inventoryStock.create({
            data: {
              productId,
              eventId: input.eventId,
              dataMode: input.dataMode,
              trackingEnabled: input.trackingEnabled ?? true,
              initialQuantity: input.quantity,
              stockQuantity: input.quantity,
              lowStockThreshold: input.lowStockThreshold,
              manualBlocked: input.manualBlocked ?? false,
              version: 1,
            },
          });
          await tx.inventoryMovement.create({
            data: {
              type: "INITIALIZATION",
              productId,
              eventId: input.eventId,
              dataMode: input.dataMode,
              quantityDelta: input.quantity,
              quantityBefore: 0,
              quantityAfter: input.quantity,
              actorUserId: userId,
              idempotencyKey: input.idempotencyKey,
              requestFingerprint: fingerprint,
            },
          });
        } else {
          if (!stock)
            throw new ConflictException(
              "Bestand ist noch nicht initialisiert.",
            );
          const before = stock.stockQuantity;
          stock = await tx.inventoryStock.update({
            where: {
              productId_eventId_dataMode: {
                productId,
                eventId: input.eventId,
                dataMode: input.dataMode,
              },
            },
            data: {
              stockQuantity: input.quantity,
              version: { increment: 1 },
            },
          });
          await tx.inventoryMovement.create({
            data: {
              type: "CORRECTION",
              productId,
              eventId: input.eventId,
              dataMode: input.dataMode,
              quantityDelta: input.quantity - before,
              quantityBefore: before,
              quantityAfter: input.quantity,
              reason: input.reason,
              actorUserId: userId,
              idempotencyKey: input.idempotencyKey,
              requestFingerprint: fingerprint,
            },
          });
        }
        await tx.auditLog.create({
          data: {
            action: `INVENTORY_${type}`,
            entityType: "Product",
            entityId: productId,
            userId,
            details: {
              eventId: input.eventId,
              dataMode: input.dataMode,
              idempotencyKey: input.idempotencyKey,
            },
          },
        });
        return { product, stock, replay: false };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    if (!result.replay && result.stock)
      this.realtime.broadcast(input.eventId, "PRODUCT_INVENTORY_CHANGED", {
        eventId: input.eventId,
        dataMode: input.dataMode,
        productId,
        // Issue #141, Fehler B: siehe publishChanges weiter oben - derselbe
        // Ereignistyp, deshalb dieselbe Luecke ohne productName.
        productName: result.product.name,
        stockQuantity: result.stock.stockQuantity,
        lowStockThreshold: result.stock.lowStockThreshold,
        availability: effectiveAvailability(
          result.product.manualAvailability,
          result.stock,
        ),
        version: result.stock.version,
      });
    return {
      productId,
      eventId: input.eventId,
      dataMode: input.dataMode,
      ...this.facade(result.product, result.stock),
    };
  }
  initialize(productId: string, input: any, userId: string) {
    return this.mutate(productId, input, userId, "INITIALIZATION");
  }
  async settings(productId: string, input: any, userId: string) {
    // Einstellungen sind zustandsidempotent: derselbe gewünschte Zustand
    // erzeugt weder eine weitere Version noch ein zweites Realtime-Ereignis.
    // Anders als Initialisierung/Korrektur gibt es dafür kein Ledger und
    // folglich auch keinen dauerhaften Idempotency-Key-Vertrag.
    const result = await this.prisma.$transaction(
      async (tx) => {
        await this.eventMode(tx, input.eventId, input.dataMode);
        const product = await this.product(tx, productId, input.eventId);
        const stock = await tx.inventoryStock.findUnique({
          where: {
            productId_eventId_dataMode: {
              productId,
              eventId: input.eventId,
              dataMode: input.dataMode,
            },
          },
        });
        if (!stock)
          throw new ConflictException("Bestand ist noch nicht initialisiert.");

        const lowStockThreshold =
          input.lowStockThreshold ?? stock.lowStockThreshold;
        const manualBlocked = input.manualBlocked ?? stock.manualBlocked;
        if (
          lowStockThreshold === stock.lowStockThreshold &&
          manualBlocked === stock.manualBlocked
        )
          return { product, stock, changed: false };

        const updated = await tx.inventoryStock.update({
          where: {
            productId_eventId_dataMode: {
              productId,
              eventId: input.eventId,
              dataMode: input.dataMode,
            },
          },
          data: {
            lowStockThreshold,
            manualBlocked,
            version: { increment: 1 },
          },
        });
        await tx.auditLog.create({
          data: {
            action: "INVENTORY_SETTINGS",
            entityType: "Product",
            entityId: productId,
            userId,
            details: {
              eventId: input.eventId,
              dataMode: input.dataMode,
              previousLowStockThreshold: stock.lowStockThreshold,
              lowStockThreshold,
              previousManualBlocked: stock.manualBlocked,
              manualBlocked,
            },
          },
        });
        return { product, stock: updated, changed: true };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    if (result.changed)
      this.realtime.broadcast(input.eventId, "PRODUCT_INVENTORY_CHANGED", {
        eventId: input.eventId,
        dataMode: input.dataMode,
        productId,
        // Issue #141, Fehler B: siehe publishChanges weiter oben - derselbe
        // Ereignistyp, deshalb dieselbe Luecke ohne productName.
        productName: result.product.name,
        stockQuantity: result.stock.stockQuantity,
        lowStockThreshold: result.stock.lowStockThreshold,
        availability: effectiveAvailability(
          result.product.manualAvailability,
          result.stock,
        ),
        version: result.stock.version,
      });
    return {
      productId,
      eventId: input.eventId,
      dataMode: input.dataMode,
      ...this.facade(result.product, result.stock),
    };
  }
  correction(productId: string, input: any, userId: string) {
    return this.mutate(productId, input, userId, "CORRECTION");
  }
}
