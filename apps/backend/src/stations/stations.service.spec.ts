import { StationsService } from "./stations.service";

// Issue #158: getPendingItems bekam nur die Stations-ID und filterte
// ausschliesslich nach Positionsstatus und Zielstation - weder Veranstaltung
// noch Betriebsart. Die Kuechenanzeige zeigte damit offene Positionen ueber
// alle Veranstaltungen und beide Betriebsarten hinweg. Die Station kennt ihre
// Veranstaltung selbst (Station.eventId); die Signatur des Endpunkts bleibt
// unveraendert, die Einschraenkung passiert serverseitig.
describe("StationsService – Betriebsartentrennung der Stationsanzeige (Issue #158)", () => {
  let service: StationsService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      station: { findUnique: jest.fn() },
      orderItem: { findMany: jest.fn() },
    };
    service = new StationsService(prisma);
  });

  it("schränkt die Positionen auf die Veranstaltung und Betriebsart der Station ein (LIVE)", async () => {
    prisma.station.findUnique.mockResolvedValue({
      eventId: "event-1",
      event: { status: "ACTIVE", testMode: false },
    });
    prisma.orderItem.findMany.mockResolvedValue([]);

    await service.getPendingItems("station-1");

    expect(prisma.orderItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          order: { eventId: "event-1", dataMode: "LIVE" },
        }),
      }),
    );
  });

  it("schränkt die Positionen auf die Veranstaltung und Betriebsart der Station ein (TEST)", async () => {
    prisma.station.findUnique.mockResolvedValue({
      eventId: "event-1",
      event: { status: "TEST_MODE", testMode: true },
    });
    prisma.orderItem.findMany.mockResolvedValue([]);

    await service.getPendingItems("station-1");

    expect(prisma.orderItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          order: { eventId: "event-1", dataMode: "TEST" },
        }),
      }),
    );
  });

  it("zeigt keine Position einer fremden Veranstaltung, weil die Abfrage an der eigenen Station hängt", async () => {
    prisma.station.findUnique.mockResolvedValue({
      eventId: "event-eigene",
      event: { status: "ACTIVE", testMode: false },
    });
    prisma.orderItem.findMany.mockResolvedValue([]);

    await service.getPendingItems("station-1");

    const call = prisma.orderItem.findMany.mock.calls[0][0];
    expect(call.where.order).toEqual({
      eventId: "event-eigene",
      dataMode: "LIVE",
    });
    expect(call.where.order.eventId).not.toBe("event-fremd");
  });

  it("liefert eine leere Liste, statt Positionen zu zeigen, wenn die Veranstaltung der Station nicht läuft", async () => {
    prisma.station.findUnique.mockResolvedValue({
      eventId: "event-1",
      event: { status: "PAUSED", testMode: false },
    });

    await expect(service.getPendingItems("station-1")).resolves.toEqual([]);
    expect(prisma.orderItem.findMany).not.toHaveBeenCalled();
  });

  it("liefert eine leere Liste, wenn die Station nicht existiert", async () => {
    prisma.station.findUnique.mockResolvedValue(null);

    await expect(service.getPendingItems("station-unbekannt")).resolves.toEqual(
      [],
    );
    expect(prisma.orderItem.findMany).not.toHaveBeenCalled();
  });
});
