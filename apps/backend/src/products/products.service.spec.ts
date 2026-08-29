import { BadRequestException } from "@nestjs/common";
import { PrismaClient } from "@vereinorder/database";
import { ProductsService } from "./products.service";
import { UpdateProductDto } from "./dto/product.dto";

describe("ProductsService – Eventgrenzen und Allowlists", () => {
  const eventId = "11111111-1111-4111-8111-111111111111";
  const foreignEventId = "22222222-2222-4222-8222-222222222222";
  const product = {
    id: "product",
    eventId,
    categoryId: "category-own",
    manualAvailability: "AVAILABLE",
  };
  const productId = product.id;
  const userId = "33333333-3333-4333-8333-333333333333";

  function createService(categoryEventId = eventId) {
    const tx = {
      product: {
        update: jest
          .fn()
          .mockResolvedValue({ id: "product", name: "Wasser", price: 300 }),
      },
      auditLog: { create: jest.fn() },
    };
    const prisma = {
      product: {
        findUnique: jest.fn().mockResolvedValue({
          id: "product",
          eventId,
          categoryId: "category-own",
          price: 300,
        }),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      productCategory: {
        findUnique: jest.fn().mockResolvedValue({ eventId: categoryEventId }),
      },
      station: { findUnique: jest.fn() },
      auditLog: { create: jest.fn() },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const realtime = { broadcast: jest.fn() };
    return {
      service: new ProductsService(
        prisma as unknown as PrismaClient,
        realtime as never,
      ),
      prisma,
      realtime,
      tx,
    };
  }

  it("weist beim Produktupdate eine Kategorie einer fremden Veranstaltung vor dem Write ab", async () => {
    const { service, tx } = createService(foreignEventId);

    await expect(
      service.updateProduct(
        "product",
        { categoryId: "33333333-3333-4333-8333-333333333333" },
        "user",
      ),
    ).rejects.toEqual(expect.any(BadRequestException));

    expect(tx.product.update).not.toHaveBeenCalled();
  });

  it("reicht eventId aus einer manipulierten Update-Nutzlast nicht an Prisma weiter", async () => {
    const { service, tx } = createService();
    const manipulatedPayload = {
      name: "Wasser still",
      eventId: foreignEventId,
    } as unknown as UpdateProductDto;

    await service.updateProduct("product", manipulatedPayload);

    expect(tx.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { name: "Wasser still" },
      }),
    );
  });

  it("liefert nach Anlegen die vollständige Inventar-Fassade statt eines rohen Produktdatensatzes", async () => {
    const { service, prisma } = createService();
    const created = {
      id: "created",
      eventId,
      categoryId: "category-own",
      name: "Wasser",
      manualAvailability: "AVAILABLE",
    };
    const detailed = {
      ...created,
      event: { status: "ACTIVE", testMode: false },
      inventoryStocks: [
        {
          dataMode: "LIVE",
          trackingEnabled: true,
          stockQuantity: 4,
          lowStockThreshold: 2,
          version: 1,
          manualBlocked: false,
        },
      ],
    };
    prisma.$transaction.mockImplementation(
      (callback: (client: any) => unknown) =>
        callback({
          product: { create: jest.fn().mockResolvedValue(created) },
          auditLog: { create: jest.fn() },
        }),
    );
    prisma.product.findUnique.mockResolvedValue(detailed);

    const result = await service.createProduct({
      eventId,
      categoryId: "category-own",
      name: "Wasser",
      price: 300,
    } as any);

    expect(result).toEqual(
      expect.objectContaining({
        manualAvailability: "AVAILABLE",
        availability: "AVAILABLE",
        inventoryTracked: true,
        stockQuantity: 4,
        lowStockThreshold: 2,
        inventoryVersion: 1,
      }),
    );
  });

  it("berechnet die Produktliste aus dem aktuellen Betriebsbestand, ohne den automatischen Wert zu persistieren", async () => {
    const { service, prisma } = createService();
    prisma.product.findMany = jest.fn().mockResolvedValue([
      {
        ...product,
        event: { status: "ACTIVE", testMode: false },
        inventoryStocks: [
          {
            dataMode: "LIVE",
            trackingEnabled: true,
            stockQuantity: 0,
            lowStockThreshold: 2,
            manualBlocked: false,
            version: 3,
          },
        ],
      },
    ]);

    const [listed] = await service.findAllActive();

    expect(listed).toEqual(
      expect.objectContaining({
        manualAvailability: "AVAILABLE",
        availability: "OUT_OF_STOCK",
        stockQuantity: 0,
        inventoryVersion: 3,
      }),
    );
    expect(prisma.product.update).not.toHaveBeenCalled();
  });

  it("liefert für Update, Verwaltung und Station dieselbe effektive Inventar-Fassade", async () => {
    const { service, prisma, tx } = createService();
    const detailed = {
      ...product,
      name: "Wasser",
      event: { status: "TEST_MODE", testMode: true },
      inventoryStocks: [
        {
          dataMode: "LIVE",
          trackingEnabled: true,
          stockQuantity: 12,
          lowStockThreshold: 2,
          manualBlocked: false,
          version: 7,
        },
        {
          dataMode: "TEST",
          trackingEnabled: true,
          stockQuantity: 0,
          lowStockThreshold: 2,
          manualBlocked: false,
          version: 8,
        },
      ],
    };
    tx.product.update.mockResolvedValue(detailed);
    prisma.product.findUnique
      .mockResolvedValueOnce({ ...product, price: 300 })
      .mockResolvedValueOnce(detailed);
    prisma.product.findMany.mockResolvedValue([detailed]);

    const updated = await service.updateProduct(productId, { name: "Wasser" });
    const [admin] = await service.findAllProductsAdmin(eventId);
    const [station] = await service.findByStation("station-id");

    for (const result of [updated, admin, station]) {
      expect(result).toEqual(
        expect.objectContaining({
          manualAvailability: "AVAILABLE",
          availability: "OUT_OF_STOCK",
          inventoryTracked: true,
          stockQuantity: 0,
          lowStockThreshold: 2,
          inventoryVersion: 8,
        }),
      );
    }
    expect(tx.product.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { name: "Wasser" } }),
    );
    expect(prisma.product.update).not.toHaveBeenCalled();
  });

  it("speichert eine alte manuelle Statusänderung ausschließlich als manualAvailability", async () => {
    const { service, prisma } = createService();
    prisma.product.findUnique.mockResolvedValue({
      ...product,
      name: "Wasser",
      manualAvailability: "AVAILABLE",
    });
    prisma.product.update.mockResolvedValue({
      ...product,
      name: "Wasser",
      manualAvailability: "DISABLED",
    });

    await service.updateAvailability(productId, "DISABLED", userId);

    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: productId },
      data: { manualAvailability: "DISABLED" },
    });
    expect((prisma as any).inventoryStock).toBeUndefined();
  });

  /**
   * Offener Befund zu #141 (bewusst rot, wird nicht von der Testrolle
   * behoben): jede andere Rundmeldung zum Bestand sendet die effektive
   * Verfuegbarkeit (inventory.service.ts, effectiveAvailability). Nur
   * updateAvailability sendet den rohen manuellen Override.
   *
   * effectiveAvailability laesst den manuellen Wert ausschliesslich
   * einschraenken: ein bestandsgefuehrtes Produkt mit Menge 0 bleibt
   * OUT_OF_STOCK. Genau diese Regel umgeht die Rundmeldung. Die in #141
   * ergaenzten Listener in QuickSaleDashboard.tsx und
   * StationSaleDashboard.tsx uebernehmen payload.data.availability
   * ungeprueft, sodass alle Kassen anschliessend ein Produkt anbieten, das
   * OrdersService beim Bonieren mit INVENTORY_INSUFFICIENT ablehnt.
   */
  it("meldet fuer ein bestandsgefuehrtes Produkt mit Bestand 0 nicht AVAILABLE an die Kassen", async () => {
    const { service, prisma, realtime } = createService();
    const stock = {
      dataMode: "LIVE",
      trackingEnabled: true,
      stockQuantity: 0,
      lowStockThreshold: 2,
      manualBlocked: false,
      version: 5,
    };
    const soldOut = {
      ...product,
      name: "Wasser",
      manualAvailability: "OUT_OF_STOCK",
      event: { status: "ACTIVE", testMode: false },
      inventoryStocks: [stock],
    };
    prisma.product.findUnique.mockResolvedValue(soldOut);
    prisma.product.update.mockResolvedValue({
      ...soldOut,
      manualAvailability: "AVAILABLE",
    });
    // Der Bestand ist ueber jeden plausiblen Lesepfad erreichbar; der Test
    // schreibt der Umsetzung damit keine bestimmte Loesung vor.
    (prisma as any).inventoryStock = {
      findUnique: jest.fn().mockResolvedValue(stock),
      findFirst: jest.fn().mockResolvedValue(stock),
      findMany: jest.fn().mockResolvedValue([stock]),
    };

    await service.updateAvailability(productId, "AVAILABLE", userId);

    expect(realtime.broadcast).toHaveBeenCalledWith(
      eventId,
      "PRODUCT_AVAILABILITY_CHANGED",
      expect.objectContaining({
        productId,
        // Bei Bestand 0 bleibt die effektive Verfuegbarkeit OUT_OF_STOCK,
        // egal was die Verwaltung manuell setzt.
        availability: "OUT_OF_STOCK",
      }),
    );
  });
});
