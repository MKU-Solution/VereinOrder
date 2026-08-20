import {
  Injectable,
  Inject,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { PrismaClient, Prisma } from "@vereinorder/database";
import { PRISMA_CLIENT } from "../prisma/prisma.module";
import { randomBytes } from "crypto";

interface CreateOrderDto {
  eventId: string;
  items: {
    productId: string;
    quantity: number;
    variantId?: string;
    variantName?: string;
    extras?: { id: string; name: string; price: number }[];
  }[];
  payments?: { amount: number; method: "CASH" | "CARD" | "VOUCHER" }[];
  idempotencyKey?: string;
  tableName?: string;
  areaId?: string;
}

interface QuickSaleDto {
  eventId: string;
  idempotencyKey: string;
  items: {
    productId: string;
    quantity: number;
    variantId?: string;
  }[];
  paymentMethod: "CASH" | "CARD";
  tenderedAmount?: number;
}

interface PrintOptions {
  receiptTitle?: string;
  tenderedAmount?: number;
  changeAmount?: number;
  vouchers?: {
    code: string;
    orderItemId: string;
    productId: string;
    productName: string;
    variantName?: string | null;
    stationId?: string | null;
    issuedAt: Date;
  }[];
}

@Injectable()
export class OrdersService {
  constructor(@Inject(PRISMA_CLIENT) private prisma: PrismaClient) {}

  async getQuickSaleContext(userId: string) {
    const [events, sessions, activePrinter] = await Promise.all([
      this.prisma.event.findMany({
        where: { status: { in: ["ACTIVE", "TEST_MODE"] } },
        select: {
          id: true,
          name: true,
          status: true,
          testMode: true,
          products: {
            where: { availability: { not: "DISABLED" } },
            select: {
              id: true,
              name: true,
              shortName: true,
              price: true,
              color: true,
              sortOrder: true,
              availability: true,
              category: { select: { id: true, name: true, sortOrder: true } },
              variants: {
                select: { id: true, name: true, price: true, sortOrder: true },
                orderBy: { sortOrder: "asc" },
              },
            },
            orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }],
          },
        },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.cashierSession.findMany({
        where: { userId, status: "ACTIVE" },
        select: {
          id: true,
          eventId: true,
          startingBalance: true,
          startTime: true,
        },
      }),
      this.prisma.printer.findFirst({
        where: { isActive: true },
        select: { id: true },
      }),
    ]);
    const sessionsByEvent = new Map(
      sessions.map((session) => [session.eventId, session]),
    );

    return events.map((event) => ({
      ...event,
      activeSession: sessionsByEvent.get(event.id) || null,
      printingReady: Boolean(activePrinter),
    }));
  }

  async createQuickSale(userId: string, dto: QuickSaleDto) {
    if (!userId)
      throw new BadRequestException("Authenticated user is required");
    if (!dto?.eventId) throw new BadRequestException("eventId is required");
    if (
      typeof dto.idempotencyKey !== "string" ||
      dto.idempotencyKey.length < 8 ||
      dto.idempotencyKey.length > 128
    ) {
      throw new BadRequestException("A valid idempotencyKey is required");
    }
    if (
      !Array.isArray(dto.items) ||
      dto.items.length === 0 ||
      dto.items.length > 50
    ) {
      throw new BadRequestException(
        "Quick sale must contain between 1 and 50 positions",
      );
    }
    if (!["CASH", "CARD"].includes(dto.paymentMethod)) {
      throw new BadRequestException(
        "Only CASH and CARD are supported for quick sales",
      );
    }

    const totalQuantity = dto.items.reduce((sum, item) => {
      if (
        !item?.productId ||
        !Number.isInteger(item.quantity) ||
        item.quantity < 1 ||
        item.quantity > 100
      ) {
        throw new BadRequestException(
          "Every position needs a quantity between 1 and 100",
        );
      }
      return sum + item.quantity;
    }, 0);
    if (totalQuantity > 100) {
      throw new BadRequestException(
        "A quick sale cannot issue more than 100 product vouchers",
      );
    }

    const result = await this.prisma.$transaction(async (prisma) => {
      const existingOrder = await prisma.order.findUnique({
        where: { idempotencyKey: dto.idempotencyKey },
        include: {
          items: { include: { product: true } },
          payments: true,
          vouchers: true,
        },
      });
      if (existingOrder) {
        const payment = existingOrder.payments[0];
        const requestedItems = dto.items
          .map(
            (item) =>
              `${item.productId}:${item.variantId || ""}:${item.quantity}`,
          )
          .sort();
        const storedItems = existingOrder.items
          .map(
            (item) =>
              `${item.productId}:${item.variantId || ""}:${item.quantity}`,
          )
          .sort();
        const sameTenderedAmount =
          dto.paymentMethod === "CASH"
            ? payment?.tenderedAmount === dto.tenderedAmount
            : dto.tenderedAmount === undefined ||
              dto.tenderedAmount === existingOrder.totalAmount;
        if (
          existingOrder.userId !== userId ||
          existingOrder.eventId !== dto.eventId ||
          !existingOrder.cashierSessionId ||
          existingOrder.vouchers.length === 0 ||
          existingOrder.payments.length !== 1 ||
          payment?.method !== dto.paymentMethod ||
          !sameTenderedAmount ||
          requestedItems.length !== storedItems.length ||
          requestedItems.some((item, index) => item !== storedItems[index])
        ) {
          throw new BadRequestException("idempotencyKey is already in use");
        }
        return {
          order: existingOrder,
          vouchersIssued: existingOrder.vouchers.length,
          tenderedAmount: payment?.tenderedAmount || existingOrder.totalAmount,
          changeAmount: payment?.changeAmount || 0,
          idempotentReplay: true,
        };
      }

      const event = await prisma.event.findFirst({
        where: { id: dto.eventId, status: { in: ["ACTIVE", "TEST_MODE"] } },
        select: { id: true },
      });
      if (!event)
        throw new BadRequestException("Event is not active for sales");

      const activePrinter = await prisma.printer.findFirst({
        where: { isActive: true },
        select: { id: true },
      });
      if (!activePrinter) {
        throw new BadRequestException(
          "Für den Bonverkauf ist ein aktiver Drucker erforderlich.",
        );
      }

      const activeSessions = await prisma.$queryRaw<
        { id: string }[]
      >(Prisma.sql`
        SELECT "id"
        FROM "CashierSession"
        WHERE "userId" = ${userId}
          AND "eventId" = ${dto.eventId}
          AND "status" = 'ACTIVE'
        ORDER BY "startTime" DESC
        LIMIT 1
        FOR UPDATE
      `);
      const cashierSessionId = activeSessions[0]?.id;
      if (!cashierSessionId) {
        throw new BadRequestException(
          "Für diesen Verkauf ist eine aktive Kassensitzung erforderlich.",
        );
      }

      const productIds = [...new Set(dto.items.map((item) => item.productId))];
      const products = await prisma.product.findMany({
        where: { id: { in: productIds }, eventId: dto.eventId },
        include: { variants: true },
      });
      const productsById = new Map(
        products.map((product) => [product.id, product]),
      );

      let totalAmount = 0;
      const orderItemsData = dto.items.map((item) => {
        const product = productsById.get(item.productId);
        if (!product)
          throw new BadRequestException(
            "Product does not belong to the selected event",
          );
        if (
          product.availability === "OUT_OF_STOCK" ||
          product.availability === "DISABLED"
        ) {
          throw new BadRequestException(
            `Product ${product.name} is currently out of stock`,
          );
        }

        const variant = item.variantId
          ? product.variants.find(
              (candidate) => candidate.id === item.variantId,
            )
          : null;
        if (item.variantId && !variant) {
          throw new BadRequestException(
            "Variant does not belong to the selected product",
          );
        }
        const priceAtTime = variant?.price ?? product.price;
        if (!Number.isInteger(priceAtTime) || priceAtTime < 0) {
          throw new BadRequestException("Product price is invalid");
        }
        totalAmount += priceAtTime * item.quantity;

        return {
          productId: product.id,
          quantity: item.quantity,
          priceAtTime,
          status: "PENDING" as const,
          variantId: variant?.id,
          variantName: variant?.name,
        };
      });
      if (
        !Number.isSafeInteger(totalAmount) ||
        totalAmount <= 0 ||
        totalAmount > 2_147_483_647
      ) {
        throw new BadRequestException("Quick-sale total is invalid");
      }

      let tenderedAmount: number;
      let changeAmount = 0;
      if (dto.paymentMethod === "CASH") {
        tenderedAmount = dto.tenderedAmount as number;
        if (
          !Number.isInteger(tenderedAmount) ||
          tenderedAmount < totalAmount ||
          tenderedAmount > 2_147_483_647
        ) {
          throw new BadRequestException(
            "Tendered cash must cover the total amount",
          );
        }
        changeAmount = tenderedAmount - totalAmount;
      } else {
        if (
          dto.tenderedAmount !== undefined &&
          dto.tenderedAmount !== totalAmount
        ) {
          throw new BadRequestException(
            "Card payment must match the total amount",
          );
        }
        tenderedAmount = totalAmount;
      }

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user?.isActive) throw new BadRequestException("User is not active");

      const order = await prisma.order.create({
        data: {
          totalAmount,
          lifecycleStatus: "SUBMITTED",
          paymentStatus: "PAID",
          fulfillmentStatus: "PENDING",
          userId,
          eventId: dto.eventId,
          idempotencyKey: dto.idempotencyKey,
          tableName: null,
          areaId: null,
          cashierSessionId,
          items: { create: orderItemsData },
          payments: {
            create: {
              amount: totalAmount,
              method: dto.paymentMethod,
              status: "COMPLETED",
              cashierSessionId,
              tenderedAmount:
                dto.paymentMethod === "CASH" ? tenderedAmount : null,
              changeAmount,
            },
          },
        },
        include: {
          items: { include: { product: true } },
          payments: true,
        },
      });

      const vouchers: PrintOptions["vouchers"] = [];
      for (const item of order.items) {
        for (let unit = 0; unit < item.quantity; unit += 1) {
          const voucher = await prisma.productVoucher.create({
            data: {
              code: randomBytes(12).toString("hex").toUpperCase(),
              eventId: dto.eventId,
              productId: item.productId,
              orderId: order.id,
              orderItemId: item.id,
              issuedByUserId: userId,
              cashierSessionId,
            },
          });
          vouchers.push({
            code: voucher.code,
            orderItemId: item.id,
            productId: item.productId,
            productName: item.product.name,
            variantName: item.variantName,
            stationId: item.product.targetStationId,
            issuedAt: voucher.issuedAt,
          });
        }
      }

      await this.dispatchPrintJobs(prisma, order, user, {
        receiptTitle: "INTERNER ZAHLUNGSNACHWEIS",
        tenderedAmount,
        changeAmount,
        vouchers,
      });

      await prisma.auditLog.create({
        data: {
          action: "QUICK_SALE_COMPLETED",
          entityId: order.id,
          entityType: "Order",
          userId,
          details: {
            eventId: dto.eventId,
            cashierSessionId,
            paymentMethod: dto.paymentMethod,
            totalAmount,
            tenderedAmount,
            changeAmount,
            vouchersIssued: vouchers.length,
            idempotencyKey: dto.idempotencyKey,
          },
        },
      });

      return {
        order,
        vouchersIssued: vouchers.length,
        tenderedAmount,
        changeAmount,
        idempotentReplay: false,
      };
    });

    return result;
  }

  private async dispatchPrintJobs(
    prisma: any,
    order: any,
    user?: any,
    options: PrintOptions = {},
  ) {
    const event = await prisma.event.findUnique({
      where: { id: order.eventId },
    });
    const defaultPrinter = await prisma.printer.findFirst({
      where: { isActive: true },
    });
    const stations = await prisma.station.findMany({
      where: { eventId: order.eventId },
      include: { printer: true },
    });
    const stationMap = new Map(stations.map((s: any) => [s.id, s]));

    if (!defaultPrinter && stations.every((s: any) => !s.printer?.isActive)) {
      return; // No printers configured
    }

    // 1. Group items by targetStation for STATION_TICKETS
    const itemsByStation = new Map<string, any[]>();
    for (const item of order.items) {
      const stationId = item.product?.targetStationId || "NO_STATION";
      if (!itemsByStation.has(stationId)) {
        itemsByStation.set(stationId, []);
      }
      itemsByStation.get(stationId)!.push(item);
    }

    for (const [stationId, stationItems] of itemsByStation.entries()) {
      const station = stationMap.get(stationId) as any;
      const targetPrinter = station?.printer?.isActive
        ? station.printer
        : defaultPrinter;
      if (targetPrinter) {
        await prisma.printJob.create({
          data: {
            printerId: targetPrinter.id,
            jobType: "STATION_TICKET",
            orderId: order.id,
            content: {
              title: "ABHOL-/KÜCHENBON",
              stationName: station?.name || "Zentrale Ausgabe",
              orderNumber: order.orderNumber,
              orderId: order.id,
              tableName: order.tableName || "Theke / Ohne Tisch",
              waiterName: user?.name || user?.username || "Kellner",
              isPriority: order.isPriority,
              createdAt: order.createdAt,
              items: stationItems.map((i) => ({
                productName: i.product.name,
                quantity: i.quantity,
                variantName: i.variantName,
                extras: i.extras,
              })),
            },
          },
        });
      }
    }

    for (const voucher of options.vouchers || []) {
      const station = voucher.stationId
        ? (stationMap.get(voucher.stationId) as any)
        : null;
      const targetPrinter = station?.printer?.isActive
        ? station.printer
        : defaultPrinter;
      if (!targetPrinter) continue;

      await prisma.printJob.create({
        data: {
          printerId: targetPrinter.id,
          jobType: "PRODUCT_VOUCHER",
          orderId: order.id,
          content: {
            title: "PRODUKTBON",
            eventName: event?.name || "Vereinsfest",
            orderNumber: order.orderNumber,
            voucherCode: voucher.code,
            productName: voucher.productName,
            variantName: voucher.variantName,
            quantity: 1,
            stationName: station?.name || "Zentrale Ausgabe",
            issuedAt: voucher.issuedAt,
            rksvDisclaimer: "VereinOrder ist keine RKSV-Registrierkasse.",
          },
        },
      });
    }

    // 2. Create Customer/Cashier RECEIPT
    if (defaultPrinter && defaultPrinter.isActive) {
      const totalPaid =
        order.payments?.reduce((sum: number, p: any) => sum + p.amount, 0) || 0;
      const changeAmount =
        options.changeAmount ?? Math.max(0, totalPaid - order.totalAmount);

      await prisma.printJob.create({
        data: {
          printerId: defaultPrinter.id,
          jobType: "RECEIPT",
          orderId: order.id,
          content: {
            title: options.receiptTitle || "KASSENBELEG",
            eventName: event?.name || "Vereinsfest",
            orderNumber: order.orderNumber,
            orderId: order.id,
            tableName: order.tableName || "Theke",
            waiterName: user?.name || user?.username || "Kellner",
            createdAt: order.createdAt,
            items: order.items.map((i: any) => ({
              productName: i.product.name,
              quantity: i.quantity,
              price: i.priceAtTime,
              variantName: i.variantName,
              extras: i.extras,
              totalPrice: i.priceAtTime * i.quantity,
            })),
            totalAmount: order.totalAmount,
            payments:
              order.payments?.map((p: any) => ({
                amount: p.amount,
                method: p.method,
                tenderedAmount: p.tenderedAmount,
                changeAmount: p.changeAmount,
              })) || [],
            tenderedAmount: options.tenderedAmount,
            changeAmount,
            rksvDisclaimer: "VereinOrder ist keine RKSV-Registrierkasse.",
          },
        },
      });
    }
  }

  async createOrder(userId: string, dto: CreateOrderDto) {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException("Order must contain at least one item");
    }

    if (dto.idempotencyKey) {
      const existingOrder = await this.prisma.order.findUnique({
        where: { idempotencyKey: dto.idempotencyKey },
        include: {
          items: { include: { product: true } },
          payments: true,
        },
      });
      if (existingOrder) {
        return existingOrder;
      }
    }

    const productIds = dto.items.map((i) => i.productId);
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      include: { variants: true, extras: true },
    });

    const productMap = new Map(products.map((p) => [p.id, p]));

    let totalAmount = 0;
    const orderItemsData = dto.items.map((item) => {
      const product = productMap.get(item.productId);
      if (!product)
        throw new BadRequestException(`Product ${item.productId} not found`);
      if (
        product.availability === "OUT_OF_STOCK" ||
        product.availability === "DISABLED"
      ) {
        throw new BadRequestException(
          `Product ${product.name} is currently out of stock`,
        );
      }

      let basePrice = product.price;

      if (item.variantId) {
        const variant = product.variants.find((v) => v.id === item.variantId);
        if (variant) basePrice = variant.price;
      }

      let extrasCost = 0;
      if (item.extras && item.extras.length > 0) {
        for (const ext of item.extras) {
          const dbExtra = product.extras.find((e) => e.id === ext.id);
          if (dbExtra) extrasCost += dbExtra.price;
        }
      }

      const finalItemPrice = basePrice + extrasCost;
      const itemTotal = finalItemPrice * item.quantity;
      totalAmount += itemTotal;

      return {
        productId: product.id,
        quantity: item.quantity,
        priceAtTime: finalItemPrice,
        status: "PENDING" as any,
        variantId: item.variantId,
        variantName: item.variantName,
        extras: item.extras as any,
      };
    });

    const totalPaid = dto.payments?.reduce((sum, p) => sum + p.amount, 0) || 0;
    const initialPaymentStatus =
      totalPaid >= totalAmount
        ? "PAID"
        : totalPaid > 0
          ? "PARTIALLY_PAID"
          : "OPEN";

    const user = userId
      ? await this.prisma.user.findUnique({ where: { id: userId } })
      : null;
    const activeSession = userId
      ? await this.prisma.cashierSession.findFirst({
          where: { userId, eventId: dto.eventId, status: "ACTIVE" },
        })
      : null;
    const cashierSessionId = activeSession?.id || null;

    if (dto.areaId) {
      const area = await this.prisma.area.findFirst({
        where: { id: dto.areaId, eventId: dto.eventId },
        select: { id: true },
      });
      if (!area)
        throw new BadRequestException(
          "Area does not belong to the selected event",
        );
    }

    return await this.prisma.$transaction(async (prisma) => {
      const order = await prisma.order.create({
        data: {
          totalAmount,
          lifecycleStatus: "SUBMITTED",
          paymentStatus: initialPaymentStatus,
          fulfillmentStatus: "PENDING",
          userId,
          eventId: dto.eventId,
          idempotencyKey: dto.idempotencyKey,
          tableName: dto.tableName,
          areaId: dto.areaId,
          cashierSessionId,
          items: {
            create: orderItemsData,
          },
          payments:
            dto.payments && dto.payments.length > 0
              ? {
                  create: dto.payments.map((p) => ({
                    amount: p.amount,
                    method: p.method,
                    status: "COMPLETED",
                    cashierSessionId,
                  })),
                }
              : undefined,
        },
        include: {
          items: {
            include: {
              product: true,
            },
          },
          payments: true,
        },
      });

      // Dispatch smart PrintJobs
      await this.dispatchPrintJobs(prisma, order, user);

      return order;
    });
  }

  async reprintOrder(orderId: string, userId?: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { product: true } },
        payments: true,
      },
    });
    if (!order) throw new NotFoundException("Order not found");

    const user = userId
      ? await this.prisma.user.findUnique({ where: { id: userId } })
      : null;

    await this.dispatchPrintJobs(this.prisma, order, user);

    if (userId) {
      await this.prisma.auditLog.create({
        data: {
          action: "REPRINT_ORDER",
          entityId: orderId,
          entityType: "Order",
          userId,
          details: {
            orderNumber: order.orderNumber,
            totalAmount: order.totalAmount,
          },
        },
      });
    }

    return {
      success: true,
      message:
        "Nachdruckaufträge erfolgreich in die Druckerwarteschlange eingereiht",
    };
  }

  async getUnpaidOrders(eventId: string) {
    return this.prisma.order.findMany({
      where: {
        eventId,
        paymentStatus: { in: ["OPEN", "PARTIALLY_PAID"] },
        lifecycleStatus: { not: "CANCELLED" },
      },
      include: {
        items: {
          include: {
            product: true,
          },
        },
        payments: true,
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async addPaymentsToOrder(
    orderId: string,
    payments: { amount: number; method: "CASH" | "CARD" | "VOUCHER" }[],
    userId: string,
  ) {
    if (!payments || payments.length === 0) {
      throw new BadRequestException("No payments provided");
    }

    return await this.prisma.$transaction(async (prisma) => {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { payments: true },
      });

      if (!order) throw new NotFoundException("Order not found");
      if (order.paymentStatus === "PAID")
        throw new BadRequestException("Order is already fully paid");

      const currentPaid = order.payments.reduce((sum, p) => sum + p.amount, 0);
      const newPaid = payments.reduce((sum, p) => sum + p.amount, 0);
      const totalPaid = currentPaid + newPaid;

      const newPaymentStatus =
        totalPaid >= order.totalAmount ? "PAID" : "PARTIALLY_PAID";

      const activeSession = userId
        ? await prisma.cashierSession.findFirst({
            where: { userId, eventId: order.eventId, status: "ACTIVE" },
          })
        : null;
      const cashierSessionId = activeSession?.id || null;

      await prisma.payment.createMany({
        data: payments.map((p) => ({
          orderId: order.id,
          amount: p.amount,
          method: p.method,
          status: "COMPLETED",
          cashierSessionId,
        })),
      });

      const updatedOrder = await prisma.order.update({
        where: { id: orderId },
        data: { paymentStatus: newPaymentStatus },
        include: { items: { include: { product: true } }, payments: true },
      });

      if (userId) {
        await prisma.auditLog.create({
          data: {
            action: "PAYMENT_RECEIVED",
            entityId: orderId,
            entityType: "Order",
            userId,
            details: {
              orderNumber: order.orderNumber,
              paymentsCount: payments.length,
              amountPaid: newPaid,
              totalAmount: order.totalAmount,
              newPaymentStatus,
            },
          },
        });
      }

      return updatedOrder;
    });
  }

  async cancelOrder(orderId: string, reason: string, userId: string) {
    return await this.prisma.$transaction(async (prisma) => {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { items: true, payments: true },
      });

      if (!order) throw new NotFoundException("Order not found");
      if (order.lifecycleStatus === "CANCELLED")
        throw new BadRequestException("Order is already cancelled");

      const updatedOrder = await prisma.order.update({
        where: { id: orderId },
        data: {
          lifecycleStatus: "CANCELLED",
        },
        include: { items: true, payments: true },
      });

      await prisma.orderItem.updateMany({
        where: { orderId },
        data: { status: "CANCELLED" },
      });

      const cancelledVouchers = await prisma.productVoucher.updateMany({
        where: { orderId, status: "ISSUED" },
        data: { status: "CANCELLED" },
      });

      await prisma.auditLog.create({
        data: {
          action: "CANCEL_ORDER",
          entityId: orderId,
          entityType: "Order",
          userId,
          details: {
            reason,
            totalAmount: order.totalAmount,
            paymentsCount: order.payments.length,
            vouchersCancelled: cancelledVouchers.count,
          },
        },
      });

      return updatedOrder;
    });
  }

  async cancelOrderItem(orderItemId: string, reason: string, userId: string) {
    return await this.prisma.$transaction(async (prisma) => {
      const item = await prisma.orderItem.findUnique({
        where: { id: orderItemId },
        include: { order: { include: { items: true } } },
      });

      if (!item) throw new NotFoundException("OrderItem not found");
      if (item.status === "CANCELLED")
        throw new BadRequestException("Item is already cancelled");

      const updatedItem = await prisma.orderItem.update({
        where: { id: orderItemId },
        data: { status: "CANCELLED" },
      });

      const cancelledVouchers = await prisma.productVoucher.updateMany({
        where: { orderItemId, status: "ISSUED" },
        data: { status: "CANCELLED" },
      });

      const order = item.order;
      const remainingItems = order.items.filter(
        (i) => i.id !== orderItemId && i.status !== "CANCELLED",
      );

      const newTotal = remainingItems.reduce(
        (sum, i) => sum + i.priceAtTime * i.quantity,
        0,
      );
      const isAllCancelled = remainingItems.length === 0;

      await prisma.order.update({
        where: { id: order.id },
        data: {
          totalAmount: newTotal,
          lifecycleStatus: isAllCancelled ? "CANCELLED" : order.lifecycleStatus,
        },
      });

      await prisma.auditLog.create({
        data: {
          action: "CANCEL_ORDER_ITEM",
          entityId: orderItemId,
          entityType: "OrderItem",
          userId,
          details: {
            reason,
            orderId: order.id,
            productId: item.productId,
            itemPrice: item.priceAtTime,
            quantity: item.quantity,
            vouchersCancelled: cancelledVouchers.count,
          },
        },
      });

      return updatedItem;
    });
  }

  async updatePriority(orderId: string, isPriority: boolean) {
    return this.prisma.order.update({
      where: { id: orderId },
      data: { isPriority },
    });
  }
}
