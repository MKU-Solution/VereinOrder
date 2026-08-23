import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@vereinorder/database";
import { ORDER_REJECTION_CODES } from "@vereinorder/shared";
import { OrdersService } from "./orders.service";
import { createAuditServiceStub } from "./test-support/audit-service.stub";

// Regressionstests fuer Issue #65, Abschnitt 8 Punkt 4 (Befund B5): die
// Idempotenzpruefung in createOrder liegt vor der Transaktion. Zwei
// gleichzeitige Versuche mit demselben Schluessel koennen beide daran
// vorbeikommen; die eindeutige Spalte "idempotencyKey" auf Order
// (schema.prisma) verhindert dann die Doppelbestellung in der Datenbank,
// meldet dem unterlegenen Versuch aber einen P2002-Fehler. Dieser muss als
// Wiederholung behandelt werden - durch dieselbe Pruefung wie der reguläre
// Kurzschluss (Besitz, Veranstaltung, Positionen, Zahlungen) - statt als
// unbehandelter 500 durchzuschlagen.
describe("OrdersService – P2002 auf idempotencyKey als Wiederholung für Issue #65", () => {
  const product = {
    id: "product-1",
    eventId: "event-1",
    name: "Saft",
    price: 350,
    availability: "AVAILABLE",
    optionGroups: [],
    categoryId: "category-1",
    category: { id: "category-1", name: "Getränke", targetStationId: null },
    targetStationId: null,
  };

  const winningOrder = {
    id: "order-winner",
    userId: "waiter-1",
    eventId: "event-1",
    items: [
      {
        productId: "product-1",
        quantity: 2,
        variantId: null,
        extras: null,
        product,
      },
    ],
    payments: [],
  };

  const makeP2002 = () => {
    const error = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed",
      {
        code: "P2002",
        clientVersion: "test",
        meta: { target: ["idempotencyKey"] },
      },
    );
    return error;
  };

  const createPrisma = (options: {
    findUniqueSequence: (typeof winningOrder | null)[];
  }) => {
    let call = 0;
    const prisma: any = {
      $transaction: jest.fn(async (callback) => {
        // Erster Aufruf verliert das Wettrennen, wirft P2002 aus dem
        // order.create heraus.
        return callback(prisma);
      }),
      $queryRaw: jest
        .fn()
        .mockResolvedValue([{ status: "TEST_MODE", testMode: true }]),
      product: { findMany: jest.fn().mockResolvedValue([product]) },
      area: { findFirst: jest.fn() },
      cashierSession: { findFirst: jest.fn().mockResolvedValue(null) },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: "waiter-1",
          username: "kellner1",
          isActive: true,
        }),
      },
      order: {
        findUnique: jest.fn().mockImplementation(() => {
          const result = options.findUniqueSequence[call];
          call += 1;
          return Promise.resolve(result ?? null);
        }),
        create: jest.fn().mockRejectedValue(makeP2002()),
      },
      event: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: "event-1", name: "Testfest" }),
      },
      printer: { findFirst: jest.fn().mockResolvedValue(null) },
      station: { findMany: jest.fn().mockResolvedValue([]) },
    };
    return prisma;
  };

  it("liefert nach P2002 die inzwischen angelegte Bestellung, wenn sie derselben Anfrage entspricht", async () => {
    // Erster findUnique (regulaerer Kurzschluss vor der Transaktion):
    // noch nichts vorhanden. Zweiter findUnique (nach dem P2002-Fang):
    // der parallele Versuch hat inzwischen committet.
    const prisma = createPrisma({ findUniqueSequence: [null, winningOrder] });
    const service = new OrdersService(prisma, createAuditServiceStub() as any);

    const result = await service.createOrder("waiter-1", {
      eventId: "event-1",
      idempotencyKey: "race-key",
      items: [{ productId: "product-1", quantity: 2 }],
    });

    expect(result).toBe(winningOrder);
    expect(prisma.order.create).toHaveBeenCalledTimes(1);
  });

  it("reicht den P2002-Fehler weiter, wenn die erneute Prüfung keine Bestellung findet", async () => {
    const prisma = createPrisma({ findUniqueSequence: [null, null] });
    const service = new OrdersService(prisma, createAuditServiceStub() as any);

    await expect(
      service.createOrder("waiter-1", {
        eventId: "event-1",
        idempotencyKey: "race-key",
        items: [{ productId: "product-1", quantity: 2 }],
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("reicht einen P2002-Fehler auf einer anderen Spalte unverändert weiter, statt ihn als Wiederholung zu behandeln", async () => {
    const prisma = createPrisma({ findUniqueSequence: [null] });
    prisma.order.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
        meta: { target: ["orderNumber"] },
      }),
    );
    const service = new OrdersService(prisma, createAuditServiceStub() as any);

    await expect(
      service.createOrder("waiter-1", {
        eventId: "event-1",
        idempotencyKey: "race-key",
        items: [{ productId: "product-1", quantity: 2 }],
      }),
    ).rejects.toMatchObject({ code: "P2002" });
    // Es wurde kein zweites findUnique fuer die Wiederholungspruefung
    // ausgeloest, weil der Fehler nicht die idempotencyKey-Spalte betrifft.
    expect(prisma.order.findUnique).toHaveBeenCalledTimes(1);
  });

  it("reicht andere Datenbankfehler unverändert weiter", async () => {
    const prisma = createPrisma({ findUniqueSequence: [null] });
    prisma.order.create.mockRejectedValue(new Error("connection lost"));
    const service = new OrdersService(prisma, createAuditServiceStub() as any);

    await expect(
      service.createOrder("waiter-1", {
        eventId: "event-1",
        idempotencyKey: "race-key",
        items: [{ productId: "product-1", quantity: 2 }],
      }),
    ).rejects.toThrow("connection lost");
  });

  it("weist die inzwischen angelegte fremde Bestellung nach P2002 zurück, statt sie preiszugeben", async () => {
    const foreignOrder = { ...winningOrder, userId: "other-user" };
    const prisma = createPrisma({ findUniqueSequence: [null, foreignOrder] });
    const service = new OrdersService(prisma, createAuditServiceStub() as any);

    const promise = service.createOrder("waiter-1", {
      eventId: "event-1",
      idempotencyKey: "race-key",
      items: [{ productId: "product-1", quantity: 2 }],
    });
    await expect(promise).rejects.toBeInstanceOf(BadRequestException);
    await expect(promise).rejects.toMatchObject({
      response: expect.objectContaining({
        code: ORDER_REJECTION_CODES.DUPLICATE_KEY_MISMATCH,
      }),
    });
  });
});
