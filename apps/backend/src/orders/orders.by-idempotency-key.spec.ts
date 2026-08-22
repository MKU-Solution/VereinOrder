import { NotFoundException } from "@nestjs/common";
import { OrdersService } from "./orders.service";
import { createAuditServiceStub } from "./test-support/audit-service.stub";

// Regressionstests fuer Issue #65, Abschnitt 8 Punkt 1: die schmale
// Auskunft ueber eine Bestellung anhand ihres idempotencyKey darf nicht
// zur Auskunft ueber fremde Schluessel werden. Ein fremder Schluessel muss
// sich fuer den Aufrufer nicht von einem unbekannten unterscheiden - in
// beiden Faellen 404, nie 403 (ein 403 wuerde bereits verraten, dass der
// Schluessel existiert).
describe("OrdersService – GET /orders/by-idempotency-key/:key für Issue #65", () => {
  const order = {
    id: "order-1",
    orderNumber: 42,
    createdAt: new Date("2026-08-20T10:00:00Z"),
    totalAmount: 900,
    eventId: "event-1",
    dataMode: "TEST",
    paymentStatus: "PAID",
    userId: "waiter-1",
  };

  const createPrisma = (found: typeof order | null) => ({
    order: {
      findUnique: jest.fn().mockResolvedValue(found),
    },
  });

  it("liefert dem erfassenden Benutzer die schmale Auskunft ohne userId", async () => {
    const prisma = createPrisma(order);
    const service = new OrdersService(
      prisma as any,
      createAuditServiceStub() as any,
    );

    const result = await service.getOrderByIdempotencyKey(
      "waiter-1",
      "WAITER",
      "same-request-key",
    );

    expect(result).toEqual({
      id: "order-1",
      orderNumber: 42,
      createdAt: order.createdAt,
      totalAmount: 900,
      eventId: "event-1",
      dataMode: "TEST",
      paymentStatus: "PAID",
    });
    expect(result).not.toHaveProperty("userId");
  });

  it("liefert ADMINISTRATOR und EVENT_MANAGER auch eine fremde Bestellung", async () => {
    const prisma = createPrisma(order);
    const adminService = new OrdersService(
      prisma as any,
      createAuditServiceStub() as any,
    );
    const managerService = new OrdersService(
      prisma as any,
      createAuditServiceStub() as any,
    );

    await expect(
      adminService.getOrderByIdempotencyKey(
        "someone-else",
        "ADMINISTRATOR",
        "same-request-key",
      ),
    ).resolves.toMatchObject({ id: "order-1" });
    await expect(
      managerService.getOrderByIdempotencyKey(
        "someone-else",
        "EVENT_MANAGER",
        "same-request-key",
      ),
    ).resolves.toMatchObject({ id: "order-1" });
  });

  it("meldet 404, wenn der Schlüssel unbekannt ist", async () => {
    const prisma = createPrisma(null);
    const service = new OrdersService(
      prisma as any,
      createAuditServiceStub() as any,
    );

    await expect(
      service.getOrderByIdempotencyKey("waiter-1", "WAITER", "unknown-key"),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each(["WAITER", "CASHIER"] as const)(
    "meldet für einen fremden Schlüssel ebenfalls 404, nicht 403 (Rolle %s)",
    async (role) => {
      const prisma = createPrisma(order);
      const service = new OrdersService(
        prisma as any,
        createAuditServiceStub() as any,
      );

      await expect(
        service.getOrderByIdempotencyKey(
          "other-user",
          role,
          "same-request-key",
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    },
  );

  it("liefert für unbekannten und fremden Schlüssel exakt dieselbe Antwort", async () => {
    const unknownPrisma = createPrisma(null);
    const foreignPrisma = createPrisma(order);
    const unknownService = new OrdersService(
      unknownPrisma as any,
      createAuditServiceStub() as any,
    );
    const foreignService = new OrdersService(
      foreignPrisma as any,
      createAuditServiceStub() as any,
    );

    const unknownError = await unknownService
      .getOrderByIdempotencyKey("other-waiter", "WAITER", "unknown-key")
      .catch((error) => error);
    const foreignError = await foreignService
      .getOrderByIdempotencyKey("other-waiter", "WAITER", "same-request-key")
      .catch((error) => error);

    expect(unknownError).toBeInstanceOf(NotFoundException);
    expect(foreignError).toBeInstanceOf(NotFoundException);
    expect((unknownError as NotFoundException).getStatus()).toBe(
      (foreignError as NotFoundException).getStatus(),
    );
    expect((unknownError as Error).message).toBe(
      (foreignError as Error).message,
    );
  });

  it("STATION darf keine fremde Bestellung sehen", async () => {
    const prisma = createPrisma(order);
    const service = new OrdersService(
      prisma as any,
      createAuditServiceStub() as any,
    );

    await expect(
      service.getOrderByIdempotencyKey(
        "other-station-user",
        "STATION",
        "same-request-key",
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
