import { Prisma } from "@vereinorder/database";
import { BadRequestException } from "@nestjs/common";
import { OrdersService } from "./orders.service";
import { createAuditServiceStub } from "./test-support/audit-service.stub";

// Issue #66, Stationskasse: createQuickSale bleibt die einzige Stelle, an
// der ein bezahlter Bonverkauf entsteht (docs/development/stationskasse.md,
// Abschnitt 2). Ein gesetztes stationId schaltet in den Stationsmodus:
// Sortiment auf die Station eingeschränkt, Abholnummer gezogen, Station auf
// der Bestellung vermerkt, nur Barzahlung. Diese Tests decken genau diesen
// Zweig ab; der zentrale Zweig (kein stationId) ist bereits durch
// orders.quick-sale.spec.ts abgedeckt und bleibt unverändert.
describe("OrdersService – Stationsverkauf für Issue #66", () => {
  let prisma: any;
  let service: OrdersService;

  const stationProduct = {
    id: "product-grill",
    name: "Grillhendl",
    price: 800,
    eventId: "event-1",
    categoryId: "category-food",
    category: {
      id: "category-food",
      name: "Essen",
      targetStationId: "station-grill",
    },
    targetStationId: null,
    availability: "AVAILABLE",
    optionGroups: [],
  };

  const activeStation = {
    id: "station-grill",
    isActive: true,
    eventId: "event-1",
  };

  function makePrisma() {
    const prisma: any = {
      $transaction: jest.fn((callback) => callback(prisma)),
      $queryRaw: jest.fn().mockImplementation((query: any) => {
        const sql = query?.strings?.join("") || "";
        if (sql.includes('FROM "Event"')) {
          return Promise.resolve([
            { id: "event-1", status: "TEST_MODE", testMode: true },
          ]);
        }
        if (sql.includes('FROM "CashierSession"')) {
          return Promise.resolve([{ id: "session-1", dataMode: "TEST" }]);
        }
        if (sql.includes('INSERT INTO "EventPickupCounter"')) {
          return Promise.resolve([{ lastNumber: 14 }]);
        }
        return Promise.resolve([]);
      }),
      event: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: "event-1", name: "Testfest" }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: "station-user-1",
          username: "grillstand",
          isActive: true,
        }),
      },
      product: {
        findMany: jest.fn().mockResolvedValue([stationProduct]),
      },
      station: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(activeStation),
      },
      order: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }: any) =>
          Promise.resolve({
            id: "order-station-1",
            orderNumber: 55,
            eventId: "event-1",
            userId: data.userId,
            totalAmount: data.totalAmount,
            dataMode: data.dataMode,
            tableName: null,
            isPriority: false,
            pickupNumber: data.pickupNumber ?? null,
            stationId: data.stationId ?? null,
            createdAt: new Date("2026-08-23T10:00:00Z"),
            items: [
              {
                id: "item-1",
                productId: stationProduct.id,
                quantity: 1,
                priceAtTime: 800,
                variantName: null,
                extras: null,
                product: stationProduct,
              },
            ],
            payments: [
              {
                amount: 800,
                method: "CASH",
                tenderedAmount: 1000,
                changeAmount: 200,
              },
            ],
          }),
        ),
      },
      productVoucher: {
        create: jest.fn().mockResolvedValue({
          code: "VOUCHER-STATION-1",
          issuedAt: new Date("2026-08-23T10:00:00Z"),
        }),
      },
      printer: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: "printer-1", isActive: true }),
      },
      printJob: {
        create: jest.fn().mockResolvedValue({}),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({}),
      },
    };
    return prisma;
  }

  beforeEach(() => {
    prisma = makePrisma();
    service = new OrdersService(prisma, createAuditServiceStub() as any);
  });

  const stationSaleDto = (overrides: Record<string, unknown> = {}) => ({
    eventId: "event-1",
    idempotencyKey: "station-sale-1234",
    items: [{ productId: stationProduct.id, quantity: 1 }],
    paymentMethod: "CASH" as const,
    tenderedAmount: 1000,
    stationId: "station-grill",
    ...overrides,
  });

  it("zieht eine Abholnummer und vermerkt Station und Nummer auf der Bestellung", async () => {
    const result = await service.createQuickSale(
      "station-user-1",
      stationSaleDto(),
    );

    expect(result).toMatchObject({ pickupNumber: 14 });
    expect(prisma.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          pickupNumber: 14,
          stationId: "station-grill",
        }),
      }),
    );
  });

  it("schreibt STATION_SALE_COMPLETED mit Station und Abholnummer im Audit", async () => {
    await service.createQuickSale("station-user-1", stationSaleDto());

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "STATION_SALE_COMPLETED",
        details: expect.objectContaining({
          stationId: "station-grill",
          pickupNumber: 14,
        }),
      }),
    });
  });

  it("gibt die Abholnummer in der Drucknutzlast von Arbeitsbon, Produktbon und Beleg weiter", async () => {
    await service.createQuickSale("station-user-1", stationSaleDto());

    const jobs = prisma.printJob.create.mock.calls.map(
      ([call]: any[]) => call.data,
    );
    const stationTicket = jobs.find(
      (job: any) => job.jobType === "STATION_TICKET",
    );
    const voucher = jobs.find((job: any) => job.jobType === "PRODUCT_VOUCHER");
    const receipt = jobs.find((job: any) => job.jobType === "RECEIPT");

    expect(stationTicket.content.pickupNumber).toBe(14);
    expect(voucher.content.pickupNumber).toBe(14);
    expect(receipt.content.pickupNumber).toBe(14);
  });

  it("lässt die Abholnummer bei einem Zentralverkauf ohne Station weg, ohne die Station zu prüfen", async () => {
    await service.createQuickSale(
      "station-user-1",
      stationSaleDto({ stationId: undefined }),
    );

    const jobs = prisma.printJob.create.mock.calls.map(
      ([call]: any[]) => call.data,
    );
    for (const job of jobs) {
      expect(job.content.pickupNumber).toBeUndefined();
    }
    expect(prisma.station.findUnique).not.toHaveBeenCalled();
    expect(prisma.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ pickupNumber: null, stationId: null }),
      }),
    );
  });

  it("erzwingt Barzahlung für den Stationsverkauf", async () => {
    await expect(
      service.createQuickSale(
        "station-user-1",
        stationSaleDto({ paymentMethod: "CARD", tenderedAmount: undefined }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it("weist eine unbekannte Station ab", async () => {
    prisma.station.findUnique.mockResolvedValue(null);

    await expect(
      service.createQuickSale(
        "station-user-1",
        stationSaleDto({ stationId: "station-unknown" }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it("weist eine inaktive Station ab", async () => {
    prisma.station.findUnique.mockResolvedValue({
      ...activeStation,
      isActive: false,
    });

    await expect(
      service.createQuickSale("station-user-1", stationSaleDto()),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it("weist eine Station einer fremden Veranstaltung ab", async () => {
    prisma.station.findUnique.mockResolvedValue({
      ...activeStation,
      eventId: "event-other",
    });

    await expect(
      service.createQuickSale("station-user-1", stationSaleDto()),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  // Rückmeldung der Projektleitung nach dem Durchspielen mit echten Daten:
  // vorher stand productAtStationFilter direkt in der where-Klausel der
  // Produktabfrage. Damit war ein Produkt einer anderen Station derselben
  // Veranstaltung im Ergebnis nicht von einem Produkt zu unterscheiden, das
  // es in dieser Veranstaltung gar nicht gibt - beide Fälle warfen dieselbe
  // Meldung ("gehört nicht zu dieser Veranstaltung"), was die Bedienung an
  // der Kasse in die falsche Richtung schickt. Die folgenden vier Tests
  // halten die beiden Fälle getrennt fest, jeweils auf den konkreten Text.
  it("weist ein Produkt einer anderen Station derselben Veranstaltung mit der neuen Meldung ab (eigene Zielstation)", async () => {
    prisma.product.findMany.mockResolvedValue([
      {
        ...stationProduct,
        targetStationId: "station-other",
        category: { ...stationProduct.category, targetStationId: null },
      },
    ]);

    await expect(
      service.createQuickSale("station-user-1", stationSaleDto()),
    ).rejects.toMatchObject({
      message:
        "Dieses Produkt gehört zum Sortiment einer anderen Station. Bitte die Station wechseln oder das Produkt dort verkaufen.",
    });
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it("weist ein Produkt einer anderen Station derselben Veranstaltung mit der neuen Meldung ab (von der Kategorie geerbte Zielstation)", async () => {
    prisma.product.findMany.mockResolvedValue([
      {
        ...stationProduct,
        targetStationId: null,
        category: {
          ...stationProduct.category,
          targetStationId: "station-other",
        },
      },
    ]);

    await expect(
      service.createQuickSale("station-user-1", stationSaleDto()),
    ).rejects.toMatchObject({
      message:
        "Dieses Produkt gehört zum Sortiment einer anderen Station. Bitte die Station wechseln oder das Produkt dort verkaufen.",
    });
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it("weist ein Produkt einer fremden Veranstaltung weiterhin mit der bisherigen Meldung ab", async () => {
    // Die Produktabfrage filtert nach eventId - ein Produkt einer anderen
    // Veranstaltung erscheint im Ergebnis gar nicht erst, unabhängig von
    // seiner Station.
    prisma.product.findMany.mockResolvedValue([]);

    await expect(
      service.createQuickSale("station-user-1", stationSaleDto()),
    ).rejects.toMatchObject({
      message:
        "Ein Produkt gehört nicht zu dieser Veranstaltung. Bitte die Auswahl aktualisieren und erneut versuchen.",
    });
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it("lädt Produkte für einen Stationsverkauf nur nach Veranstaltung gefiltert, nicht nach Station in der Datenbankabfrage", async () => {
    await service.createQuickSale("station-user-1", stationSaleDto());

    const call = prisma.product.findMany.mock.calls[0][0];
    // Kein OR/Stationsfilter mehr in der where-Klausel - die
    // Stationszugehörigkeit wird als zweiter, eigener Schritt mit
    // resolveTargetStationId geprüft (siehe orders.service.ts), damit ihre
    // Ablehnung eine eigene, präzise Meldung tragen kann.
    expect(call.where).toEqual({
      id: { in: [stationProduct.id] },
      eventId: "event-1",
    });
    // category wird für resolveTargetStationId mitgeladen.
    expect(call.include.category).toEqual({
      select: { targetStationId: true, deposit: true },
    });
  });

  it("lässt den zentralen Schnellverkauf ohne stationId unangetastet: kein Stationsfilter auf dem Sortiment", async () => {
    await service.createQuickSale(
      "station-user-1",
      stationSaleDto({ stationId: undefined }),
    );

    const call = prisma.product.findMany.mock.calls[0][0];
    expect(call.where.OR).toBeUndefined();
  });

  it("weist eine Wiederholung mit demselben Schlüssel, aber abweichender Station, zurück", async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: "order-existing",
      userId: "station-user-1",
      eventId: "event-1",
      totalAmount: 800,
      cashierSessionId: "session-1",
      stationId: "station-other",
      pickupNumber: 5,
      items: [
        {
          productId: stationProduct.id,
          variantId: null,
          quantity: 1,
          product: stationProduct,
        },
      ],
      payments: [{ method: "CASH", tenderedAmount: 1000, changeAmount: 200 }],
      vouchers: [{ id: "voucher-1" }],
    });

    await expect(
      service.createQuickSale("station-user-1", stationSaleDto()),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it("weist eine Wiederholung ab, wenn die Station passt, aber keine Abholnummer gespeichert ist", async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: "order-existing-corrupt",
      userId: "station-user-1",
      eventId: "event-1",
      totalAmount: 800,
      cashierSessionId: "session-1",
      stationId: "station-grill",
      pickupNumber: null,
      items: [
        {
          productId: stationProduct.id,
          variantId: null,
          quantity: 1,
          product: stationProduct,
        },
      ],
      payments: [{ method: "CASH", tenderedAmount: 1000, changeAmount: 200 }],
      vouchers: [{ id: "voucher-1" }],
    });

    await expect(
      service.createQuickSale("station-user-1", stationSaleDto()),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it("gibt bei passender Wiederholung die gespeicherte Abholnummer zurück, ohne eine zweite zu ziehen", async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: "order-existing-match",
      userId: "station-user-1",
      eventId: "event-1",
      totalAmount: 800,
      cashierSessionId: "session-1",
      stationId: "station-grill",
      pickupNumber: 9,
      items: [
        {
          productId: stationProduct.id,
          variantId: null,
          quantity: 1,
          product: stationProduct,
        },
      ],
      payments: [{ method: "CASH", tenderedAmount: 1000, changeAmount: 200 }],
      vouchers: [{ id: "voucher-1" }],
    });

    const result = await service.createQuickSale(
      "station-user-1",
      stationSaleDto(),
    );

    expect(result).toMatchObject({ idempotentReplay: true, pickupNumber: 9 });
    expect(prisma.order.create).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  // Regressionstest für die Normalisierung in der Wiederholungsprüfung
  // (orders.service.ts, resolveIdempotentQuickSale): existingOrder stammt
  // heute aus einem findUnique ohne select und liefert deshalb immer
  // stationId/pickupNumber als null, nie als undefined - aber die Prüfung
  // normalisiert trotzdem beide Seiten (?? null). Ohne diese Normalisierung
  // würde eine künftig verengte Projektion (die Abfrage lädt bereits
  // Positionen, Zahlungen und Gutscheine mit, ein select liegt nahe) jede
  // Wiederholung eines Zentralverkaufs als Abweichung werten
  // (undefined !== null). Dieser Test bildet genau dieses Zukunftsszenario
  // nach, indem die Attrappe stationId bewusst wegläßt (undefined statt
  // null) - er wird rot, sobald die Normalisierung entfernt wird.
  it("lässt eine Wiederholung des Zentralverkaufs durch, auch wenn die gespeicherte Bestellung stationId als undefined statt null trägt", async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: "order-existing-central-narrowed",
      userId: "station-user-1",
      eventId: "event-1",
      totalAmount: 800,
      cashierSessionId: "session-1",
      // Bewusst kein stationId/pickupNumber-Feld - simuliert eine künftig
      // verengte Projektion, bei der beide Spalten nicht select-iert wurden
      // und deshalb undefined statt null zurückkommen.
      items: [
        {
          productId: stationProduct.id,
          variantId: null,
          quantity: 1,
          product: stationProduct,
        },
      ],
      payments: [{ method: "CASH", tenderedAmount: 1000, changeAmount: 200 }],
      vouchers: [{ id: "voucher-1" }],
    });

    await expect(
      service.createQuickSale(
        "station-user-1",
        stationSaleDto({ stationId: undefined }),
      ),
    ).resolves.toMatchObject({ idempotentReplay: true });
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it("fängt P2002 auf idempotencyKey ab und liefert stattdessen die inzwischen angelegte Bestellung samt Abholnummer", async () => {
    const winningOrder = {
      id: "order-station-race",
      userId: "station-user-1",
      eventId: "event-1",
      totalAmount: 800,
      cashierSessionId: "session-1",
      stationId: "station-grill",
      pickupNumber: 21,
      items: [
        {
          productId: stationProduct.id,
          variantId: null,
          quantity: 1,
          product: stationProduct,
        },
      ],
      payments: [{ method: "CASH", tenderedAmount: 1000, changeAmount: 200 }],
      vouchers: [{ id: "voucher-1" }],
    };

    let call = 0;
    prisma.order.findUnique.mockImplementation(() => {
      call += 1;
      // Erster Aufruf (regulärer Kurzschluss): noch nichts vorhanden.
      // Zweiter Aufruf (nach dem P2002-Fang): der parallele Versuch hat
      // inzwischen committet.
      return Promise.resolve(call === 1 ? null : winningOrder);
    });
    prisma.order.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
        meta: { target: ["idempotencyKey"] },
      }),
    );

    const result = await service.createQuickSale(
      "station-user-1",
      stationSaleDto(),
    );

    expect(result).toMatchObject({ idempotentReplay: true, pickupNumber: 21 });
    expect(prisma.order.create).toHaveBeenCalledTimes(1);
  });

  it("reicht einen P2002-Fehler weiter, wenn die erneute Prüfung keine passende Bestellung findet", async () => {
    prisma.order.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
        meta: { target: ["idempotencyKey"] },
      }),
    );

    await expect(
      service.createQuickSale("station-user-1", stationSaleDto()),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});
