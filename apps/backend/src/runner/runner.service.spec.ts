import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { RunnerService } from "./runner.service";

type OrderStatus = "READY" | "PARTIALLY_DELIVERED" | "DELIVERED";

const runner = { id: "runner-1", role: "RUNNER" };
const secondRunner = { id: "runner-2", role: "RUNNER" };
const administrator = { id: "admin-1", role: "ADMINISTRATOR" };
const waiter = { id: "waiter-1", role: "WAITER" };

function readyOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-1",
    eventId: "event-1",
    areaId: "area-zelt",
    tableName: "Tisch 7",
    fulfillmentStatus: "READY" as OrderStatus,
    claimedByUserId: null,
    claimedAt: null,
    area: { id: "area-zelt", name: "Zelt" },
    items: [{ id: "item-ready", status: "READY" }],
    ...overrides,
  };
}

describe("RunnerService – Wächtertests für Issue #50", () => {
  let service: RunnerService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn((callback) => callback(prisma)),
      event: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
      },
      order: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        updateMany: jest.fn(),
        update: jest.fn(),
      },
      orderItem: {
        updateMany: jest.fn(),
      },
      auditLog: {
        create: jest.fn(),
      },
    };
    // Issue #158: listOrders/listMine leiten die Betriebsart der
    // Veranstaltung ab, um die Warteschlange darauf einzuschränken. Die
    // meisten Tests hier prüfen anderes Verhalten und laufen im Echtbetrieb.
    prisma.event.findUnique.mockResolvedValue({
      id: "event-1",
      status: "ACTIVE",
      testMode: false,
    });
    service = new RunnerService(prisma);
  });

  it("liefert nur READY-Bestellungen des angefragten Events und gibt Bereich sowie Tisch zurück", async () => {
    prisma.order.findMany.mockResolvedValue([readyOrder()]);

    await expect(
      service.listOrders(runner, "event-1", "area-zelt"),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "order-1",
        area: expect.objectContaining({ name: "Zelt" }),
        tableName: "Tisch 7",
        fulfillmentStatus: "READY",
      }),
    ]);
    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          eventId: "event-1",
          areaId: "area-zelt",
          items: { some: { status: "READY" } },
        }),
      }),
    );
  });

  it("grenzt die READY-Liste gegen andere Veranstaltungen ab", async () => {
    prisma.order.findMany.mockResolvedValue([]);

    await service.listOrders(runner, "event-1");

    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ eventId: "event-1" }),
      }),
    );
  });

  it("übernimmt atomar genau einmal und nur eine noch nicht übernommene READY-Bestellung", async () => {
    prisma.order.updateMany.mockResolvedValue({ count: 1 });
    prisma.orderItem.updateMany.mockResolvedValue({ count: 1 });
    prisma.order.findFirst.mockResolvedValue(
      readyOrder({
        claimedByUserId: runner.id,
        fulfillmentStatus: "PARTIALLY_DELIVERED",
        items: [{ id: "item-in-delivery", status: "IN_DELIVERY" }],
      }),
    );

    await expect(service.claimOrder(runner, "order-1")).resolves.toMatchObject({
      claimedByUserId: runner.id,
      fulfillmentStatus: "PARTIALLY_DELIVERED",
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "order-1",
          items: { some: { status: "READY" } },
          OR: [{ claimedByUserId: null }, { claimedByUserId: runner.id }],
        }),
        data: expect.objectContaining({
          claimedByUserId: runner.id,
          claimedAt: expect.any(Date),
          fulfillmentStatus: "PARTIALLY_DELIVERED",
        }),
      }),
    );
    expect(prisma.orderItem.updateMany).toHaveBeenCalledWith({
      where: { orderId: "order-1", status: "READY" },
      data: { status: "IN_DELIVERY" },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "RUNNER_ORDER_CLAIMED",
          entityId: "order-1",
          entityType: "Order",
          userId: runner.id,
        }),
      }),
    );
  });

  it("weist einen anderen Runner bei bereits übernommener Bestellung zurück", async () => {
    prisma.order.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.claimOrder(secondRunner, "order-1"),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it("verbietet das Übernehmen durch fremde Rollen im Backend", async () => {
    await expect(service.claimOrder(waiter, "order-1")).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("erlaubt Administratoren dieselbe Runner-Aktion", async () => {
    prisma.order.updateMany.mockResolvedValue({ count: 1 });
    prisma.orderItem.updateMany.mockResolvedValue({ count: 1 });
    prisma.order.findFirst.mockResolvedValue(
      readyOrder({ claimedByUserId: administrator.id }),
    );

    await expect(
      service.claimOrder(administrator, "order-1"),
    ).resolves.toMatchObject({
      claimedByUserId: administrator.id,
    });
  });

  it("liefert ausschließlich dem Claim-Eigentümer die übernommenen Positionen aus", async () => {
    prisma.order.findFirst.mockResolvedValue(
      readyOrder({
        claimedByUserId: runner.id,
        items: [{ id: "item-in-delivery", status: "IN_DELIVERY" }],
      }),
    );
    prisma.orderItem.updateMany.mockResolvedValue({ count: 1 });
    prisma.order.update.mockResolvedValue(
      readyOrder({ fulfillmentStatus: "DELIVERED" }),
    );

    await expect(
      service.deliverOrder(runner, "order-1"),
    ).resolves.toMatchObject({
      fulfillmentStatus: "DELIVERED",
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.orderItem.updateMany).toHaveBeenCalledWith({
      where: { orderId: "order-1", status: "IN_DELIVERY" },
      data: { status: "DELIVERED" },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "RUNNER_ORDER_DELIVERED",
          entityId: "order-1",
          entityType: "Order",
          userId: runner.id,
        }),
      }),
    );
  });

  it("behält den Claim bei Teilauslieferung bis alle aktiven Positionen zugestellt sind", async () => {
    prisma.order.findFirst.mockResolvedValue(
      readyOrder({
        claimedByUserId: runner.id,
        fulfillmentStatus: "PARTIALLY_DELIVERED",
        items: [
          { id: "item-in-delivery", status: "IN_DELIVERY" },
          { id: "item-pending", status: "PENDING" },
        ],
      }),
    );
    prisma.orderItem.updateMany.mockResolvedValue({ count: 1 });
    prisma.order.update.mockResolvedValue(
      readyOrder({
        claimedByUserId: runner.id,
        fulfillmentStatus: "PARTIALLY_DELIVERED",
      }),
    );

    await service.deliverOrder(runner, "order-1");

    expect(prisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "order-1" },
        data: expect.objectContaining({
          fulfillmentStatus: "PARTIALLY_DELIVERED",
        }),
      }),
    );
    expect(prisma.order.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ claimedByUserId: null }),
      }),
    );
  });

  it("lässt den Claim-Eigentümer später READY gewordene Positionen idempotent nachclaimen", async () => {
    prisma.order.updateMany.mockResolvedValue({ count: 1 });
    prisma.orderItem.updateMany.mockResolvedValue({ count: 1 });
    prisma.order.findFirst.mockResolvedValue(
      readyOrder({
        claimedByUserId: runner.id,
        items: [{ id: "item-late-ready", status: "READY" }],
      }),
    );

    await expect(service.claimOrder(runner, "order-1")).resolves.toMatchObject({
      claimedByUserId: runner.id,
    });

    expect(prisma.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "order-1",
          items: { some: { status: "READY" } },
          OR: [{ claimedByUserId: null }, { claimedByUserId: runner.id }],
        }),
      }),
    );
    expect(prisma.orderItem.updateMany).toHaveBeenCalledWith({
      where: { orderId: "order-1", status: "READY" },
      data: { status: "IN_DELIVERY" },
    });
  });

  it("verbietet Zustellung durch einen anderen Runner, ohne Positionen zu ändern", async () => {
    prisma.order.findFirst.mockResolvedValue(
      readyOrder({ claimedByUserId: runner.id }),
    );

    await expect(
      service.deliverOrder(secondRunner, "order-1"),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.orderItem.updateMany).not.toHaveBeenCalled();
  });

  // Issue #158: Der Runner leitete keine Betriebsart ab und zeigte damit
  // TEST- und LIVE-Bestellungen desselben Events ungetrennt nebeneinander.
  describe("Betriebsartentrennung (Issue #158)", () => {
    it("schränkt die READY-Warteschlange auf die Betriebsart der Veranstaltung ein", async () => {
      prisma.event.findUnique.mockResolvedValue({
        id: "event-1",
        status: "ACTIVE",
        testMode: false,
      });
      prisma.order.findMany.mockResolvedValue([]);

      await service.listOrders(runner, "event-1");

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            eventId: "event-1",
            dataMode: "LIVE",
          }),
        }),
      );
    });

    it("schränkt die Übernahme-Liste (listMine) ebenfalls auf die Betriebsart der Veranstaltung ein", async () => {
      prisma.event.findUnique.mockResolvedValue({
        id: "event-1",
        status: "TEST_MODE",
        testMode: true,
      });
      prisma.order.findMany.mockResolvedValue([]);

      await service.listMine(runner, "event-1");

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            eventId: "event-1",
            dataMode: "TEST",
          }),
        }),
      );
    });

    it("liefert eine leere READY-Warteschlange, statt Bestellungen einer nicht laufenden Veranstaltung zu zeigen", async () => {
      prisma.event.findUnique.mockResolvedValue({
        id: "event-1",
        status: "PAUSED",
        testMode: false,
      });

      await expect(service.listOrders(runner, "event-1")).resolves.toEqual([]);
      expect(prisma.order.findMany).not.toHaveBeenCalled();
    });

    it("liefert eine leere Übernahme-Liste, statt Bestellungen einer nicht laufenden Veranstaltung zu zeigen", async () => {
      prisma.event.findUnique.mockResolvedValue({
        id: "event-1",
        status: "COMPLETED",
        testMode: false,
      });

      await expect(service.listMine(runner, "event-1")).resolves.toEqual([]);
      expect(prisma.order.findMany).not.toHaveBeenCalled();
    });
  });
});
