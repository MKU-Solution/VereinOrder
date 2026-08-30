import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, PrismaClient } from "@vereinorder/database";
import { PRISMA_CLIENT } from "../prisma/prisma.module";
import { deriveFulfillmentStatus } from "../orders/fulfillment-status";
import { resolveOperationalDataMode } from "../common/operational-data-mode";

interface RunnerPrincipal {
  id?: string;
  userId?: string;
  role?: string;
}

const operationalEvent = Prisma.validator<Prisma.EventWhereInput>()({
  status: { in: ["ACTIVE", "TEST_MODE"] },
});

const queueInclude = Prisma.validator<Prisma.OrderInclude>()({
  area: { select: { id: true, name: true } },
  claimedBy: { select: { id: true, username: true } },
  items: {
    include: {
      product: { select: { id: true, name: true, shortName: true } },
    },
    orderBy: { createdAt: "asc" as const },
  },
});

@Injectable()
export class RunnerService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  private requireRunner(user: RunnerPrincipal): string {
    if (user?.role !== "RUNNER" && user?.role !== "ADMINISTRATOR") {
      throw new ForbiddenException("Runner permission required");
    }
    const userId = user.userId || user.id;
    if (!userId) throw new ForbiddenException("Authenticated user required");
    return userId;
  }

  private async resolveEvent(eventId?: string) {
    const event = await this.prisma.event.findFirst({
      where: {
        ...(eventId ? { id: eventId } : {}),
        ...operationalEvent,
      },
      select: { id: true, name: true, status: true, testMode: true },
      orderBy: { updatedAt: "desc" },
    });
    if (!event) throw new NotFoundException("No active event found");
    return event;
  }

  async getContext(eventId?: string) {
    const event = await this.resolveEvent(eventId);
    const areas = await this.prisma.area.findMany({
      where: { eventId: event.id },
      select: { id: true, name: true, sortOrder: true },
      orderBy: { sortOrder: "asc" },
    });
    return { event, areas };
  }

  // Issue #158: die Warteschlangen duerfen Test- und Echtbetrieb nicht
  // vermischen. Die Betriebsart wird ausschliesslich ueber
  // resolveOperationalDataMode aus der aufgeloesten Veranstaltung abgeleitet
  // (einzige Ableitung im Backend, Issue #152) - niemals ueber eine eigene
  // Kopie der Formel. Laeuft die Veranstaltung nicht, liefert die Funktion
  // null; die Warteschlange ist dann leer, statt ungefiltert ueber beide
  // Betriebsarten zu lesen.
  private async resolveQueueDataMode(eventId?: string) {
    const event = eventId
      ? await this.prisma.event.findUnique({
          where: { id: eventId },
          select: { id: true, status: true, testMode: true },
        })
      : await this.resolveEvent();
    const dataMode = resolveOperationalDataMode(event);
    if (!dataMode || !event) return null;
    return { eventId: event.id, dataMode };
  }

  async listOrders(user: RunnerPrincipal, eventId?: string, areaId?: string) {
    this.requireRunner(user);
    const context = await this.resolveQueueDataMode(eventId);
    if (!context) return [];
    return this.prisma.order.findMany({
      where: {
        eventId: context.eventId,
        dataMode: context.dataMode,
        ...(areaId ? { areaId } : {}),
        claimedByUserId: null,
        lifecycleStatus: { not: "CANCELLED" },
        items: { some: { status: "READY" } },
      },
      include: queueInclude,
      orderBy: [{ isPriority: "desc" }, { createdAt: "asc" }],
    });
  }

  async listMine(user: RunnerPrincipal, eventId?: string, areaId?: string) {
    const userId = this.requireRunner(user);
    const context = await this.resolveQueueDataMode(eventId);
    if (!context) return [];
    return this.prisma.order.findMany({
      where: {
        eventId: context.eventId,
        dataMode: context.dataMode,
        ...(areaId ? { areaId } : {}),
        claimedByUserId: userId,
        lifecycleStatus: { not: "CANCELLED" },
        items: { some: { status: { in: ["READY", "IN_DELIVERY"] } } },
      },
      include: queueInclude,
      orderBy: [{ claimedAt: "asc" }, { createdAt: "asc" }],
    });
  }

  async claimOrder(user: RunnerPrincipal, orderId: string) {
    const userId = this.requireRunner(user);
    return this.prisma.$transaction(async (tx) => {
      const claimedAt = new Date();
      const claimed = await tx.order.updateMany({
        where: {
          id: orderId,
          OR: [{ claimedByUserId: null }, { claimedByUserId: userId }],
          lifecycleStatus: { not: "CANCELLED" },
          event: operationalEvent,
          items: { some: { status: "READY" } },
        },
        data: {
          claimedByUserId: userId,
          claimedAt,
          fulfillmentStatus: "PARTIALLY_DELIVERED",
        },
      });

      if (claimed.count === 0) {
        const existing = await tx.order.findFirst({
          where: {
            id: orderId,
            claimedByUserId: userId,
            event: operationalEvent,
          },
          include: queueInclude,
        });
        if (existing && !existing.items.some((item) => item.status === "READY"))
          return existing;
        throw new NotFoundException("Ready order is no longer available");
      }

      const movedItems = await tx.orderItem.updateMany({
        where: { orderId, status: "READY" },
        data: { status: "IN_DELIVERY" },
      });
      if (movedItems.count === 0)
        throw new NotFoundException("No ready items available");

      await tx.auditLog.create({
        data: {
          action: "RUNNER_ORDER_CLAIMED",
          entityId: orderId,
          entityType: "Order",
          userId,
          details: {
            itemCount: movedItems.count,
            claimedAt: claimedAt.toISOString(),
          },
        },
      });

      const order = await tx.order.findFirst({
        where: { id: orderId, claimedByUserId: userId },
        include: queueInclude,
      });
      if (!order) throw new NotFoundException("Claimed order not found");
      return order;
    });
  }

  async deliverOrder(user: RunnerPrincipal, orderId: string) {
    const userId = this.requireRunner(user);
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: { id: orderId, event: operationalEvent },
        include: { items: true },
      });
      if (!order) throw new NotFoundException("Claimed order not found");
      if (order.claimedByUserId !== userId) {
        throw new ForbiddenException(
          "Only the claiming runner can deliver this order",
        );
      }

      const inDeliveryItems = order.items.filter(
        (item) => item.status === "IN_DELIVERY",
      );
      if (inDeliveryItems.length === 0) {
        if (order.fulfillmentStatus === "DELIVERED") return order;
        throw new BadRequestException("No items are currently in delivery");
      }

      const delivered = await tx.orderItem.updateMany({
        where: { orderId, status: "IN_DELIVERY" },
        data: { status: "DELIVERED" },
      });
      if (delivered.count === 0)
        throw new NotFoundException("Delivery was already updated");

      const projectedItems = order.items.map((item) =>
        item.status === "IN_DELIVERY" ? { ...item, status: "DELIVERED" } : item,
      );
      const fulfillmentStatus = deriveFulfillmentStatus(projectedItems);

      const updated = await tx.order.update({
        where: { id: orderId },
        data: { fulfillmentStatus },
        include: queueInclude,
      });

      await tx.auditLog.create({
        data: {
          action: "RUNNER_ORDER_DELIVERED",
          entityId: orderId,
          entityType: "Order",
          userId,
          details: {
            itemCount: delivered.count,
            itemIds: inDeliveryItems.map((item) => item.id),
            previousFulfillmentStatus: order.fulfillmentStatus,
            fulfillmentStatus,
          },
        },
      });

      return updated;
    });
  }
}
