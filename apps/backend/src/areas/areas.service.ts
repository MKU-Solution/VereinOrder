import {
  BadRequestException,
  Injectable,
  Inject,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, PrismaClient } from "@vereinorder/database";
import { PRISMA_CLIENT } from "../prisma/prisma.module";
import { RealtimeService } from "../realtime/realtime.service";
import {
  CreateAreaDto,
  FloorPlanElementDto,
  FloorPlanElementKind,
  SaveFloorPlanDto,
  UpdateAreaDto,
} from "./dto/area.dto";

const FLOOR_PLAN_WIDTH = 1000;
const FLOOR_PLAN_HEIGHT = 700;
const LONG_WAIT_MILLISECONDS = 20 * 60 * 1000;
const TABLE_KINDS = new Set<FloorPlanElementKind>([
  FloorPlanElementKind.TABLE_RECTANGLE,
  FloorPlanElementKind.TABLE_ROUND,
  FloorPlanElementKind.TABLE_STANDING,
]);

type TableStatus = "FREE" | "OCCUPIED" | "PREPARING" | "READY" | "LONG_WAIT";

@Injectable()
export class AreasService {
  constructor(
    @Inject(PRISMA_CLIENT) private prisma: PrismaClient,
    private readonly realtimeService: RealtimeService,
  ) {}

  async findAll(eventId: string) {
    return this.prisma.area.findMany({
      where: eventId ? { eventId } : undefined,
      orderBy: { sortOrder: "asc" },
    });
  }

  async create(data: CreateAreaDto) {
    const event = await this.prisma.event.findUnique({
      where: { id: data.eventId },
      select: { id: true },
    });
    if (!event) {
      throw new BadRequestException(
        "Die gewählte Veranstaltung existiert nicht.",
      );
    }
    return this.prisma.area.create({
      data: {
        name: data.name,
        sortOrder: data.sortOrder ?? 0,
        eventId: data.eventId,
      },
    });
  }

  async saveFloorPlan(id: string, data: SaveFloorPlanDto) {
    const area = await this.prisma.area.findUnique({
      where: { id },
      select: { id: true, eventId: true },
    });
    if (!area) throw new NotFoundException("Bereich nicht gefunden");

    this.assertFloorPlanSemantics(data.elements);
    const floorPlan: Prisma.InputJsonValue = {
      version: 1,
      width: FLOOR_PLAN_WIDTH,
      height: FLOOR_PLAN_HEIGHT,
      elements: data.elements.map((element) => ({ ...element })),
    };
    const updated = await this.prisma.area.update({
      where: { id },
      data: { floorPlan },
    });

    this.realtimeService.broadcast(area.eventId, "FLOOR_PLAN_UPDATED", {
      areaId: area.id,
    });
    return updated;
  }

  async findFloorPlans(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, status: true, testMode: true },
    });
    if (!event)
      throw new BadRequestException(
        "Die gewählte Veranstaltung existiert nicht.",
      );

    const areas = await this.prisma.area.findMany({
      where: { eventId },
      orderBy: { sortOrder: "asc" },
    });
    const areaIds = areas.map((area) => area.id);
    const dataMode =
      event.status === "ACTIVE" && !event.testMode
        ? "LIVE"
        : event.status === "TEST_MODE" && event.testMode
          ? "TEST"
          : null;
    const orders =
      dataMode && areaIds.length > 0
        ? await this.prisma.order.findMany({
            where: {
              eventId,
              dataMode,
              areaId: { in: areaIds },
              tableName: { not: null },
              lifecycleStatus: { not: "CANCELLED" },
              OR: [
                { paymentStatus: { in: ["OPEN", "PARTIALLY_PAID"] } },
                { fulfillmentStatus: { not: "DELIVERED" } },
              ],
            },
            select: {
              areaId: true,
              tableName: true,
              fulfillmentStatus: true,
              createdAt: true,
            },
          })
        : [];

    const ordersByTable = new Map<string, typeof orders>();
    for (const order of orders) {
      if (!order.areaId || !order.tableName) continue;
      const key = `${order.areaId}\u0000${order.tableName.trim().toLocaleLowerCase("de")}`;
      const current = ordersByTable.get(key) ?? [];
      current.push(order);
      ordersByTable.set(key, current);
    }

    return areas.map((area) => {
      const plan = this.readStoredFloorPlan(area.floorPlan);
      return {
        id: area.id,
        name: area.name,
        sortOrder: area.sortOrder,
        floorPlan: {
          ...plan,
          elements: plan.elements.map((element) => {
            if (!TABLE_KINDS.has(element.kind) || !element.tableName)
              return element;
            const key = `${area.id}\u0000${element.tableName.trim().toLocaleLowerCase("de")}`;
            const tableOrders = ordersByTable.get(key) ?? [];
            return {
              ...element,
              status: this.deriveTableStatus(tableOrders),
              openOrderCount: tableOrders.length,
              oldestOrderCreatedAt:
                tableOrders.length > 0
                  ? tableOrders
                      .map((order) => order.createdAt)
                      .sort((a, b) => a.getTime() - b.getTime())[0]
                  : null,
            };
          }),
        },
      };
    });
  }

  private assertFloorPlanSemantics(elements: FloorPlanElementDto[]) {
    const ids = new Set<string>();
    const tableNames = new Set<string>();
    for (const element of elements) {
      if (ids.has(element.id))
        throw new BadRequestException(
          "Jedes Raumplanelement benötigt eine eindeutige ID.",
        );
      ids.add(element.id);

      if (
        element.x + element.width > FLOOR_PLAN_WIDTH ||
        element.y + element.height > FLOOR_PLAN_HEIGHT
      ) {
        throw new BadRequestException(
          `Das Element „${element.label}“ liegt außerhalb der Planfläche.`,
        );
      }

      if (TABLE_KINDS.has(element.kind)) {
        const tableName = element.tableName?.trim();
        if (!tableName)
          throw new BadRequestException(
            `Der Tisch „${element.label}“ benötigt eine Tischbezeichnung.`,
          );
        const normalized = tableName.toLocaleLowerCase("de");
        if (tableNames.has(normalized))
          throw new BadRequestException(
            `Die Tischbezeichnung „${tableName}“ ist im Bereich mehrfach vorhanden.`,
          );
        tableNames.add(normalized);
      } else if (element.tableName) {
        throw new BadRequestException(
          `Das Festelement „${element.label}“ darf keine Tischbezeichnung tragen.`,
        );
      }
    }
  }

  private readStoredFloorPlan(value: Prisma.JsonValue | null) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {
        version: 1,
        width: FLOOR_PLAN_WIDTH,
        height: FLOOR_PLAN_HEIGHT,
        elements: [] as (FloorPlanElementDto & { status?: TableStatus })[],
      };
    }
    const candidate = value as Record<string, unknown>;
    return {
      version: 1,
      width: FLOOR_PLAN_WIDTH,
      height: FLOOR_PLAN_HEIGHT,
      elements: Array.isArray(candidate.elements)
        ? (candidate.elements as FloorPlanElementDto[])
        : [],
    };
  }

  private deriveTableStatus(
    orders: {
      fulfillmentStatus: string;
      createdAt: Date;
    }[],
  ): TableStatus {
    if (orders.length === 0) return "FREE";
    const now = Date.now();
    if (
      orders.some(
        (order) =>
          order.fulfillmentStatus !== "DELIVERED" &&
          now - order.createdAt.getTime() >= LONG_WAIT_MILLISECONDS,
      )
    )
      return "LONG_WAIT";
    if (
      orders.some((order) =>
        ["READY", "PARTIALLY_READY"].includes(order.fulfillmentStatus),
      )
    )
      return "READY";
    if (
      orders.some((order) =>
        ["PREPARING", "PARTIALLY_DELIVERED"].includes(order.fulfillmentStatus),
      )
    )
      return "PREPARING";
    return "OCCUPIED";
  }

  async update(id: string, data: UpdateAreaDto) {
    const area = await this.prisma.area.findUnique({ where: { id } });
    if (!area) throw new NotFoundException("Area not found");

    return this.prisma.area.update({
      where: { id },
      data: {
        name: data.name !== undefined ? data.name : undefined,
        sortOrder: data.sortOrder !== undefined ? data.sortOrder : undefined,
      },
    });
  }

  async remove(id: string) {
    const area = await this.prisma.area.findUnique({ where: { id } });
    if (!area) throw new NotFoundException("Area not found");

    return this.prisma.area.delete({ where: { id } });
  }
}
