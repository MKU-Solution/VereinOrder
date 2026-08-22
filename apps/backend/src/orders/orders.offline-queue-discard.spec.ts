import { ConflictException, ForbiddenException } from "@nestjs/common";
import { OrdersService } from "./orders.service";

// Regressionstests fuer Issue #65, Abschnitt 8 Punkt 2 und Abschnitt 7
// ("Verwerfen"). Das Verwerfen einer lokalen Vormerkung darf serverseitig
// erst nach erneuter Pruefung geschehen (der Client hat schon vorher
// GET .../by-idempotency-key/:key abgefragt, das ersetzt diese Pruefung
// nicht) und muss die Entscheidungen der Projektleitung durchsetzen
// (Abschnitt 11, Punkte 2, 5 und 6): der erfassende Benutzer oder
// ADMINISTRATOR darf verwerfen, uebernommene Altbestaende nur
// ADMINISTRATOR/EVENT_MANAGER, und eine Vormerkung mit Zahlungen nur
// ADMINISTRATOR.
describe("OrdersService – POST /orders/offline-queue/discard für Issue #65", () => {
  const createPrisma = (existingOrder: { id: string } | null = null) => ({
    order: {
      findUnique: jest.fn().mockResolvedValue(existingOrder),
    },
  });

  const baseDto = {
    idempotencyKey: "offline-queue-key-1",
    reason: "Doppelerfassung",
    capturedByUserId: "waiter-1",
    eventId: "event-1",
  };

  it("erlaubt dem erfassenden Benutzer das Verwerfen einer Vormerkung ohne Zahlungen und schreibt das Audit-Ereignis", async () => {
    const prisma = createPrisma(null);
    const auditService = { log: jest.fn().mockResolvedValue({}) };
    const service = new OrdersService(prisma as any, auditService as any);

    const result = await service.discardOfflineQueueEntry(
      "waiter-1",
      "WAITER",
      baseDto,
    );

    expect(result).toEqual({ success: true });
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "OFFLINE_QUEUE_DISCARDED",
        entityType: "Order",
        entityId: "offline-queue-key-1",
        userId: "waiter-1",
        details: expect.objectContaining({
          reason: "Doppelerfassung",
          capturedByUserId: "waiter-1",
          legacy: false,
        }),
      }),
    );
  });

  it("erlaubt ADMINISTRATOR das Verwerfen einer fremden Vormerkung", async () => {
    const prisma = createPrisma(null);
    const auditService = { log: jest.fn().mockResolvedValue({}) };
    const service = new OrdersService(prisma as any, auditService as any);

    await expect(
      service.discardOfflineQueueEntry("admin-1", "ADMINISTRATOR", baseDto),
    ).resolves.toEqual({ success: true });
  });

  it("weist das Verwerfen durch einen anderen Benutzer als den erfassenden zurück", async () => {
    const prisma = createPrisma(null);
    const auditService = { log: jest.fn().mockResolvedValue({}) };
    const service = new OrdersService(prisma as any, auditService as any);

    await expect(
      service.discardOfflineQueueEntry("other-waiter", "WAITER", baseDto),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(auditService.log).not.toHaveBeenCalled();
  });

  it("weist das Verwerfen ab, wenn der Server die Bestellung bereits kennt (409)", async () => {
    const prisma = createPrisma({ id: "order-already-created" });
    const auditService = { log: jest.fn().mockResolvedValue({}) };
    const service = new OrdersService(prisma as any, auditService as any);

    await expect(
      service.discardOfflineQueueEntry("waiter-1", "WAITER", baseDto),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(auditService.log).not.toHaveBeenCalled();
  });

  it("beschränkt das Verwerfen übernommener Altbestände auf ADMINISTRATOR und EVENT_MANAGER", async () => {
    const prisma = createPrisma(null);
    const auditService = { log: jest.fn().mockResolvedValue({}) };
    const legacyDto = { ...baseDto, legacy: true };

    const waiterService = new OrdersService(prisma as any, auditService as any);
    await expect(
      waiterService.discardOfflineQueueEntry("waiter-1", "WAITER", legacyDto),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const managerService = new OrdersService(
      prisma as any,
      auditService as any,
    );
    await expect(
      managerService.discardOfflineQueueEntry(
        "manager-1",
        "EVENT_MANAGER",
        legacyDto,
      ),
    ).resolves.toEqual({ success: true });

    const adminService = new OrdersService(prisma as any, auditService as any);
    await expect(
      adminService.discardOfflineQueueEntry(
        "admin-1",
        "ADMINISTRATOR",
        legacyDto,
      ),
    ).resolves.toEqual({ success: true });
  });

  it("beschränkt das Verwerfen einer Vormerkung mit Zahlungen auf ADMINISTRATOR", async () => {
    const prisma = createPrisma(null);
    const auditService = { log: jest.fn().mockResolvedValue({}) };
    const dtoWithPayments = {
      ...baseDto,
      payments: [{ amount: 500, method: "CASH" as const }],
    };

    const waiterService = new OrdersService(prisma as any, auditService as any);
    await expect(
      waiterService.discardOfflineQueueEntry(
        "waiter-1",
        "WAITER",
        dtoWithPayments,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const managerService = new OrdersService(
      prisma as any,
      auditService as any,
    );
    await expect(
      managerService.discardOfflineQueueEntry(
        "manager-1",
        "EVENT_MANAGER",
        dtoWithPayments,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const adminService = new OrdersService(prisma as any, auditService as any);
    const result = await adminService.discardOfflineQueueEntry(
      "admin-1",
      "ADMINISTRATOR",
      dtoWithPayments,
    );
    expect(result).toEqual({ success: true });
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          payments: [{ amount: 500, method: "CASH" }],
        }),
      }),
    );
  });

  // Die Rangfolge zaehlt (Abschnitt 7 "Verwerfen": Audit zuerst, Loeschen
  // danach): scheitert das Schreiben des Audit-Ereignisses, muss die
  // Anfrage insgesamt scheitern. Ein optionales `auditService?.log(...)`
  // wuerde den Fehler verschlucken und faelschlich `{ success: true }`
  // liefern - genau das lautlose Verwerfen ohne Spur, das ausgeschlossen
  // sein muss.
  it("lässt das Verwerfen scheitern, wenn das Schreiben des Audit-Ereignisses fehlschlägt", async () => {
    const prisma = createPrisma(null);
    const auditFailure = new Error("audit log unavailable");
    const auditService = { log: jest.fn().mockRejectedValue(auditFailure) };
    const service = new OrdersService(prisma as any, auditService as any);

    await expect(
      service.discardOfflineQueueEntry("waiter-1", "WAITER", baseDto),
    ).rejects.toThrow("audit log unavailable");
    // Die Pruefung (kein bestehender Server-Datensatz, Autorisierung) lief
    // bereits durch das Audit-Ereignis wurde nur nicht geschrieben - die
    // Anfrage darf trotzdem nicht als Erfolg erscheinen.
    expect(auditService.log).toHaveBeenCalledTimes(1);
  });

  it("weist eine Anfrage ohne gültigen idempotencyKey oder ohne Begründung zurück, bevor der Server befragt wird", async () => {
    const prisma = createPrisma(null);
    const auditService = { log: jest.fn().mockResolvedValue({}) };
    const service = new OrdersService(prisma as any, auditService as any);

    await expect(
      service.discardOfflineQueueEntry("waiter-1", "WAITER", {
        ...baseDto,
        idempotencyKey: "short",
      }),
    ).rejects.toThrow();
    await expect(
      service.discardOfflineQueueEntry("waiter-1", "WAITER", {
        ...baseDto,
        reason: "",
      }),
    ).rejects.toThrow();
    expect(prisma.order.findUnique).not.toHaveBeenCalled();
    expect(auditService.log).not.toHaveBeenCalled();
  });
});
