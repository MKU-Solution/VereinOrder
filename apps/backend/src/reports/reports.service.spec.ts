import { BadRequestException, NotFoundException } from "@nestjs/common";
import { ReportsService } from "./reports.service";

const eventId = "f9fca940-9b5f-4cc9-a9a7-a3450bbc6e1f";

function createService(options?: {
  event?: unknown;
  products?: unknown[];
  stocks?: unknown[];
  movements?: unknown[];
}) {
  const prisma = {
    event: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          options && Object.prototype.hasOwnProperty.call(options, "event")
            ? options.event
            : { status: "ACTIVE", testMode: false },
        ),
    },
    product: { findMany: jest.fn().mockResolvedValue(options?.products ?? []) },
    inventoryStock: {
      findMany: jest.fn().mockResolvedValue(options?.stocks ?? []),
    },
    inventoryMovement: {
      findMany: jest.fn().mockResolvedValue(options?.movements ?? []),
    },
  };
  return { prisma, service: new ReportsService(prisma as any) };
}

describe("ReportsService – Bestandsbericht (Issue #141)", () => {
  it("bilanziert Verkauf, Stornierung und positive wie negative Korrekturen ausschließlich aus dem Ledger", async () => {
    const { service, prisma } = createService({
      products: [
        { id: "p1", name: "Limo", manualAvailability: "AVAILABLE" },
        { id: "p2", name: "Bier", manualAvailability: "AVAILABLE" },
      ],
      stocks: [
        {
          productId: "p1",
          trackingEnabled: true,
          initialQuantity: 999,
          stockQuantity: 8,
          lowStockThreshold: 8,
          manualBlocked: false,
        },
        {
          productId: "p2",
          trackingEnabled: true,
          initialQuantity: 999,
          stockQuantity: 5,
          lowStockThreshold: 1,
          manualBlocked: false,
        },
      ],
      movements: [
        { productId: "p1", type: "INITIALIZATION", quantityDelta: 10 },
        { productId: "p1", type: "SALE", quantityDelta: -3 },
        { productId: "p1", type: "CANCELLATION", quantityDelta: 1 },
        { productId: "p1", type: "CORRECTION", quantityDelta: 2 },
        { productId: "p1", type: "CORRECTION", quantityDelta: -2 },
        { productId: "p2", type: "INITIALIZATION", quantityDelta: 4 },
        { productId: "p2", type: "CORRECTION", quantityDelta: 1 },
      ],
    });

    await expect(service.getInventoryReport(eventId, "LIVE")).resolves.toEqual([
      {
        productId: "p1",
        name: "Limo",
        inventoryTracked: true,
        initialQuantity: 10,
        grossSales: 3,
        cancellations: 1,
        correctionDelta: 0,
        expectedQuantity: 8,
        actualQuantity: 8,
        difference: 0,
        lowStockThreshold: 8,
        effectiveAvailability: "LOW_STOCK",
      },
      {
        productId: "p2",
        name: "Bier",
        inventoryTracked: true,
        initialQuantity: 4,
        grossSales: 0,
        cancellations: 0,
        correctionDelta: 1,
        expectedQuantity: 4,
        actualQuantity: 5,
        difference: 1,
        lowStockThreshold: 1,
        effectiveAvailability: "AVAILABLE",
      },
    ]);
    expect(prisma.inventoryMovement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { eventId, dataMode: "LIVE" } }),
    );
  });

  it("gibt unverwaltete Produkte ausdrücklich ohne erfundene Mengen zurück", async () => {
    const { service } = createService({
      products: [
        { id: "p3", name: "Kuchen", manualAvailability: "OUT_OF_STOCK" },
      ],
    });

    await expect(service.getInventoryReport(eventId, "LIVE")).resolves.toEqual([
      {
        productId: "p3",
        name: "Kuchen",
        inventoryTracked: false,
        initialQuantity: null,
        grossSales: null,
        cancellations: null,
        correctionDelta: null,
        expectedQuantity: null,
        actualQuantity: null,
        difference: null,
        lowStockThreshold: null,
        effectiveAvailability: "OUT_OF_STOCK",
      },
    ]);
  });

  it("sperrt fremden Datenmodus und unbekannte Veranstaltungen", async () => {
    const wrongMode = createService({
      event: { status: "TEST_MODE", testMode: true },
    });
    await expect(
      wrongMode.service.getInventoryReport(eventId, "LIVE"),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(wrongMode.prisma.product.findMany).not.toHaveBeenCalled();

    const unknown = createService({ event: null });
    await expect(
      unknown.service.getInventoryReport(eventId, "TEST"),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      unknown.service.getInventoryReport(eventId, "OTHER" as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      unknown.service.getInventoryReport("keine-uuid", "TEST"),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("exportiert denselben strikt gefilterten Bestand als deutsches CSV", async () => {
    const { service } = createService({
      products: [
        { id: "p1", name: 'Limo; "Zitrone"', manualAvailability: "AVAILABLE" },
      ],
      stocks: [
        {
          productId: "p1",
          trackingEnabled: true,
          initialQuantity: 9,
          stockQuantity: 7,
          lowStockThreshold: 2,
          manualBlocked: false,
        },
      ],
      movements: [
        { productId: "p1", type: "INITIALIZATION", quantityDelta: 9 },
        { productId: "p1", type: "SALE", quantityDelta: -2 },
      ],
    });

    await expect(service.exportCsv("inventory", eventId, "LIVE")).resolves.toBe(
      '\uFEFFProdukt-ID;Produkt;Bestandsführung aktiv;Anfangsbestand;Verkäufe (Abgänge);Stornierungen;Korrektur-Differenz;Sollbestand;Istbestand;Differenz;Mindestbestand;Effektive Verfügbarkeit\r\np1;"Limo; ""Zitrone""";Ja;9;2;0;0;7;7;0;2;AVAILABLE',
    );
  });
});
