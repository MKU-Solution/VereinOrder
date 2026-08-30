import { BadRequestException } from "@nestjs/common";
import { AreasService } from "./areas.service";
import { FloorPlanElementKind, type SaveFloorPlanDto } from "./dto/area.dto";

const table = (
  overrides: Partial<SaveFloorPlanDto["elements"][number]> = {},
) => ({
  id: "c86eb907-b93e-4c8c-b062-e42fd3b31f40",
  kind: FloorPlanElementKind.TABLE_RECTANGLE,
  label: "Tisch 1",
  tableName: "1",
  x: 100,
  y: 100,
  width: 140,
  height: 90,
  rotation: 0,
  ...overrides,
});

describe("AreasService – grafischer Raumplan (Issue #138)", () => {
  it("speichert einen validierten Plan atomar und meldet die Änderung", async () => {
    const prisma = {
      area: {
        findUnique: jest.fn().mockResolvedValue({
          id: "area-1",
          eventId: "event-1",
        }),
        update: jest.fn().mockResolvedValue({ id: "area-1" }),
      },
    };
    const realtime = { broadcast: jest.fn() };
    const service = new AreasService(prisma as any, realtime as any);

    await service.saveFloorPlan("area-1", { elements: [table()] });

    expect(prisma.area.update).toHaveBeenCalledWith({
      where: { id: "area-1" },
      data: {
        floorPlan: expect.objectContaining({
          version: 1,
          width: 1000,
          height: 700,
          elements: [expect.objectContaining({ tableName: "1" })],
        }),
      },
    });
    expect(realtime.broadcast).toHaveBeenCalledWith(
      "event-1",
      "FLOOR_PLAN_UPDATED",
      { areaId: "area-1" },
    );
  });

  it("weist doppelte Tischbezeichnungen vor jedem Schreibzugriff ab", async () => {
    const prisma = {
      area: {
        findUnique: jest.fn().mockResolvedValue({
          id: "area-1",
          eventId: "event-1",
        }),
        update: jest.fn(),
      },
    };
    const service = new AreasService(
      prisma as any,
      { broadcast: jest.fn() } as any,
    );

    await expect(
      service.saveFloorPlan("area-1", {
        elements: [
          table(),
          table({
            id: "4ce37659-57eb-43f7-9c5c-00ecb2aa6bee",
            label: "Tisch Eins",
            tableName: " 1 ",
          }),
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.area.update).not.toHaveBeenCalled();
  });

  it("berechnet Status nur aus der zur Veranstaltung gehörenden Test-Betriebsart", async () => {
    const old = new Date(Date.now() - 25 * 60 * 1000);
    const prisma = {
      event: {
        findUnique: jest.fn().mockResolvedValue({
          id: "event-1",
          status: "TEST_MODE",
          testMode: true,
        }),
      },
      area: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "area-1",
            name: "Zelt",
            sortOrder: 0,
            floorPlan: {
              version: 1,
              width: 1000,
              height: 700,
              elements: [table()],
            },
          },
        ]),
      },
      order: {
        findMany: jest.fn().mockResolvedValue([
          {
            areaId: "area-1",
            tableName: "1",
            fulfillmentStatus: "PREPARING",
            createdAt: old,
          },
        ]),
      },
    };
    const service = new AreasService(
      prisma as any,
      { broadcast: jest.fn() } as any,
    );

    const result = await service.findFloorPlans("event-1");

    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ dataMode: "TEST" }),
      }),
    );
    expect(result[0].floorPlan.elements[0]).toEqual(
      expect.objectContaining({
        status: "LONG_WAIT",
        openOrderCount: 1,
        oldestOrderCreatedAt: old,
      }),
    );
  });

  // Issue #152: vor der zentralen Ableitung (resolveOperationalDataMode)
  // fiel eine unmoegliche status/testMode-Kombination hier still auf
  // dataMode=null zurueck - dieselbe Behandlung wie eine Veranstaltung, die
  // gerade nicht laeuft. areaIds.length > 0 && !dataMode liess die
  // Bestellabfrage aus, und jeder Tisch erschien als frei, obwohl offene
  // Bestellungen existieren koennten. Der Raumplan muss diesen Zustand
  // jetzt laut ablehnen statt jeden Tisch als frei zu zeigen.
  it("weist eine unmögliche status/testMode-Kombination ab, statt jeden Tisch als frei zu zeigen", async () => {
    const prisma = {
      event: {
        findUnique: jest.fn().mockResolvedValue({
          id: "event-1",
          status: "ACTIVE",
          testMode: true,
        }),
      },
      area: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "area-1",
            name: "Zelt",
            sortOrder: 0,
            floorPlan: {
              version: 1,
              width: 1000,
              height: 700,
              elements: [table()],
            },
          },
        ]),
      },
      order: { findMany: jest.fn() },
    };
    const service = new AreasService(
      prisma as any,
      { broadcast: jest.fn() } as any,
    );

    await expect(service.findFloorPlans("event-1")).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.order.findMany).not.toHaveBeenCalled();
  });
});
