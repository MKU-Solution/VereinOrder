import {
  Injectable,
  Inject,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { PrismaClient } from "@vereinorder/database";
import { PRISMA_CLIENT } from "../prisma/prisma.module";
import { deriveFulfillmentStatus } from "../orders/fulfillment-status";
import { productAtStationFilter } from "../common/target-station";
import {
  CreateStationDto,
  MutableStationItemStatus,
  UpdateStationDto,
} from "./dto/station.dto";

const STATION_CREATE_KEYS = [
  "name",
  "shortName",
  "color",
  "sortOrder",
  "isActive",
  "eventId",
  "printerId",
] as const;
const STATION_UPDATE_KEYS = [
  "name",
  "shortName",
  "color",
  "sortOrder",
  "isActive",
  "printerId",
] as const;

function pickStationFields<T extends object, K extends readonly (keyof T)[]>(
  data: T,
  keys: K,
): Pick<T, K[number]> {
  const result = {} as Pick<T, K[number]>;
  for (const key of keys) {
    if (key in data) result[key] = data[key];
  }
  return result;
}

@Injectable()
export class StationsService {
  constructor(@Inject(PRISMA_CLIENT) private prisma: PrismaClient) {}

  async findAllActive() {
    return this.prisma.station.findMany({
      where: {
        isActive: true,
        event: { status: "ACTIVE" }, // simplified for MVP
      },
      orderBy: { sortOrder: "asc" },
    });
  }

  // --- ADMIN METHODS: STATIONS ---

  async findAllAdmin(eventId: string) {
    return this.prisma.station.findMany({
      where: { eventId },
      orderBy: { sortOrder: "asc" },
    });
  }

  async create(data: CreateStationDto) {
    const station = pickStationFields(data, STATION_CREATE_KEYS);
    await this.assertEventExists(station.eventId);
    await this.assertPrinterExists(station.printerId);
    return this.prisma.station.create({ data: station });
  }

  async update(id: string, data: UpdateStationDto) {
    const existing = await this.prisma.station.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Station nicht gefunden");
    const station = pickStationFields(data, STATION_UPDATE_KEYS);
    if ("printerId" in station)
      await this.assertPrinterExists(station.printerId);
    return this.prisma.station.update({ where: { id }, data: station });
  }

  private async assertPrinterExists(printerId?: string | null) {
    if (!printerId) return;
    const printer = await this.prisma.printer.findUnique({
      where: { id: printerId },
      select: { id: true },
    });
    if (!printer)
      throw new BadRequestException("Der gewählte Drucker existiert nicht.");
  }

  private async assertEventExists(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true },
    });
    if (!event)
      throw new BadRequestException(
        "Die gewählte Veranstaltung existiert nicht.",
      );
  }
  async getPendingItems(stationId: string) {
    return this.prisma.orderItem.findMany({
      where: {
        status: { in: ["PENDING", "PREPARING"] },
        product: productAtStationFilter(stationId),
      },
      include: {
        product: true,
        order: {
          select: { orderNumber: true, createdAt: true, isPriority: true },
        },
      },
      orderBy: [{ order: { isPriority: "desc" } }, { createdAt: "asc" }],
    });
  }

  async updateItemStatus(itemId: string, status: MutableStationItemStatus) {
    if (!["PENDING", "PREPARING", "READY", "CANCELLED"].includes(status)) {
      throw new NotFoundException("Invalid status");
    }

    return await this.prisma.$transaction(async (prisma) => {
      const currentItem = await prisma.orderItem.findUnique({
        where: { id: itemId },
        select: { orderId: true },
      });
      if (!currentItem) throw new NotFoundException("Order item not found");

      // Runner-Claims sperren ebenfalls zuerst den Auftrag und danach Positionen.
      // Die einheitliche Reihenfolge verhindert Deadlocks bei parallelem Bereitstellen/Übernehmen.
      await prisma.order.update({
        where: { id: currentItem.orderId },
        data: { updatedAt: new Date() },
      });

      const updatedItem = await prisma.orderItem.update({
        where: { id: itemId },
        data: { status },
        include: { order: { include: { items: true } } },
      });

      const order = updatedItem.order;
      const newFulfillmentStatus = deriveFulfillmentStatus(order.items);

      if (newFulfillmentStatus !== order.fulfillmentStatus) {
        await prisma.order.update({
          where: { id: order.id },
          data: { fulfillmentStatus: newFulfillmentStatus },
        });
      }

      return updatedItem;
    });
  }
}
