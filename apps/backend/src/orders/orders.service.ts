import {
  Injectable,
  Inject,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { PrismaClient, Prisma } from "@vereinorder/database";
import { PRISMA_CLIENT } from "../prisma/prisma.module";
import { randomBytes } from "crypto";
import { resolveTargetStationId } from "../common/target-station";

interface CreateOrderDto {
  eventId: string;
  items: {
    productId: string;
    quantity: number;
    optionIds?: string[];
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
    optionIds?: string[];
  }[];
  paymentMethod: "CASH" | "CARD";
  tenderedAmount?: number;
}

// Snapshot einer aufgeloesten Bestellposition. variantId/variantName/extras
// entsprechen exakt den gleichnamigen OrderItem-Spalten (unveraendert seit
// Issue #75, siehe docs/development/produktoptionen-datenmodell.md,
// "OrderItem bleibt unveraendert").
interface ResolvedOrderItemPricing {
  priceAtTime: number;
  variantId?: string;
  variantName?: string;
  extras: {
    id: string;
    name: string;
    price: number;
    groupId: string;
    groupName: string;
  }[];
}

type ProductWithOptionGroups = {
  id: string;
  name: string;
  price: number;
  optionGroups: {
    id: string;
    name: string;
    minSelect: number;
    maxSelect: number | null;
    priceMode: "ABSOLUTE" | "SURCHARGE";
    options: {
      id: string;
      name: string;
      priceEffect: number;
      isActive: boolean;
    }[];
  }[];
};

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
              // Volle Gruppenliste, dieselben Felder und dieselbe Sortierung
              // wie GET /products (findAllActive). Der Schnellverkauf
              // entscheidet selbst anhand von quickSaleTiles UND der
              // uebrigen Pflichtgruppen, ob und wie ein Produkt angeboten
              // wird (docs/development/produktoptionen-datenmodell.md,
              // "Schnellverkauf") -- ein auf die Kachelgruppe verengtes
              // Feld traegt diese Entscheidung nicht. Verbindlich berechnet
              // wird ohnehin erst bei der Bestellannahme in
              // resolveOrderItemPricing; hier sind Kachelpreise reine
              // Anzeige.
              optionGroups: {
                select: {
                  id: true,
                  name: true,
                  selectionType: true,
                  isRequired: true,
                  minSelect: true,
                  maxSelect: true,
                  priceMode: true,
                  quickSaleTiles: true,
                  sortOrder: true,
                  options: {
                    where: { isActive: true },
                    select: {
                      id: true,
                      name: true,
                      priceEffect: true,
                      isActive: true,
                      sortOrder: true,
                    },
                    orderBy: [
                      { sortOrder: "asc" },
                      { name: "asc" },
                      { id: "asc" },
                    ],
                  },
                },
                orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }],
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

  /**
   * Loest die gewaehlten optionIds einer Bestellposition gegen das Produkt
   * auf und berechnet den Preis nach
   * docs/development/produktoptionen-datenmodell.md
   * ("Preisberechnung einer Bestellposition") sowie
   * docs/development/produktoptionen-schnittstelle.md ("Bestellannahme").
   * Wird von createOrder und createQuickSale gleichermassen verwendet, damit
   * beide dieselben Regeln durchsetzen.
   */
  private resolveOrderItemPricing(
    product: ProductWithOptionGroups,
    optionIds: string[],
  ): ResolvedOrderItemPricing {
    const optionsById = new Map<
      string,
      {
        option: ProductWithOptionGroups["optionGroups"][number]["options"][number];
        group: ProductWithOptionGroups["optionGroups"][number];
      }
    >();
    for (const group of product.optionGroups) {
      for (const option of group.options) {
        optionsById.set(option.id, { option, group });
      }
    }

    const selectedByGroup = new Map<
      string,
      {
        group: ProductWithOptionGroups["optionGroups"][number];
        options: ProductWithOptionGroups["optionGroups"][number]["options"];
      }
    >();
    const seenOptionIds = new Set<string>();
    for (const optionId of optionIds) {
      // Eine doppelt angegebene Kennung deutet auf einen Fehler beim
      // Aufrufer hin (Doppelklick, kaputter Warenkorb-Zustand). Stilles
      // Entdoppeln wuerde diesen Fehler verdecken und in einer
      // MULTIPLE-Gruppe ohne maxSelect den Aufpreis verdoppeln, ohne dass
      // die Auswahl das rechtfertigt. Der Vertrag macht die Backend-Pruefung
      // zur Zusage, deshalb wird abgewiesen statt still repariert.
      if (seenOptionIds.has(optionId)) {
        throw new BadRequestException(
          `Die Antwort ${optionId} wurde für ${product.name} mehrfach angegeben.`,
        );
      }
      seenOptionIds.add(optionId);

      const found = optionsById.get(optionId);
      if (!found || !found.option.isActive) {
        throw new BadRequestException(
          `Die Antwort ${optionId} gehört zu keiner aktiven Auswahlgruppe von ${product.name}.`,
        );
      }
      const entry = selectedByGroup.get(found.group.id) ?? {
        group: found.group,
        options: [],
      };
      entry.options.push(found.option);
      selectedByGroup.set(found.group.id, entry);
    }

    for (const group of product.optionGroups) {
      const selectedCount = selectedByGroup.get(group.id)?.options.length ?? 0;
      if (selectedCount < group.minSelect) {
        throw new BadRequestException(
          `Die Auswahlgruppe „${group.name}" von ${product.name} braucht mindestens ${group.minSelect} Antwort(en).`,
        );
      }
      if (group.maxSelect !== null && selectedCount > group.maxSelect) {
        throw new BadRequestException(
          `Die Auswahlgruppe „${group.name}" von ${product.name} erlaubt höchstens ${group.maxSelect} Antwort(en).`,
        );
      }
    }

    let basePrice = product.price;
    let variantId: string | undefined;
    let variantName: string | undefined;
    const extras: ResolvedOrderItemPricing["extras"] = [];

    for (const entry of selectedByGroup.values()) {
      if (entry.group.priceMode === "ABSOLUTE") {
        const option = entry.options[0];
        basePrice = option.priceEffect;
        variantId = option.id;
        variantName = option.name;
      } else {
        for (const option of entry.options) {
          extras.push({
            id: option.id,
            name: option.name,
            price: option.priceEffect,
            groupId: entry.group.id,
            groupName: entry.group.name,
          });
        }
      }
    }

    const surcharge = extras.reduce((sum, extra) => sum + extra.price, 0);
    const priceAtTime = basePrice + surcharge;
    if (!Number.isInteger(priceAtTime) || priceAtTime < 0) {
      throw new BadRequestException(
        `Der Endpreis für ${product.name} darf nicht negativ sein.`,
      );
    }

    return { priceAtTime, variantId, variantName, extras };
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
        // Idempotenzschluessel nach docs/development/produktoptionen-schnittstelle.md
        // ("Idempotenz des Schnellverkaufs"): alle gewaehlten Antwortkennungen
        // gehen aufsteigend sortiert ein, sonst gelten zwei verschiedene
        // Zusammenstellungen desselben Produkts als Wiederholung derselben
        // Bestellung.
        const requestedItems = dto.items
          .map((item) => {
            const optionIds = [...(item.optionIds ?? [])].sort();
            return `${item.productId}:${item.quantity}:${optionIds.join(",")}`;
          })
          .sort();
        const storedItems = existingOrder.items
          .map((item) => {
            const extras = Array.isArray(item.extras)
              ? (item.extras as { id: string }[])
              : [];
            const optionIds = [
              ...(item.variantId ? [item.variantId] : []),
              ...extras.map((extra) => extra.id),
            ].sort();
            return `${item.productId}:${item.quantity}:${optionIds.join(",")}`;
          })
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

      const eventRows = await prisma.$queryRaw<
        { id: string; status: string; testMode: boolean }[]
      >(Prisma.sql`
        SELECT "id", "status", "testMode" FROM "Event" WHERE "id" = ${dto.eventId} FOR UPDATE
      `);
      const event = eventRows[0];
      const dataMode =
        event?.status === "ACTIVE" && !event.testMode
          ? "LIVE"
          : event?.status === "TEST_MODE" && event.testMode
            ? "TEST"
            : null;
      if (!dataMode)
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
        { id: string; dataMode: "TEST" | "LIVE" }[]
      >(Prisma.sql`
        SELECT "id", "dataMode"
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
      if (activeSessions[0].dataMode !== dataMode)
        throw new ConflictException(
          "Die aktive Kassensitzung gehört zu einem anderen Betriebsmodus.",
        );

      const productIds = [...new Set(dto.items.map((item) => item.productId))];
      const products = await prisma.product.findMany({
        where: { id: { in: productIds }, eventId: dto.eventId },
        include: { optionGroups: { include: { options: true } } },
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

        const { priceAtTime, variantId, variantName, extras } =
          this.resolveOrderItemPricing(product, item.optionIds ?? []);
        totalAmount += priceAtTime * item.quantity;

        return {
          productId: product.id,
          quantity: item.quantity,
          priceAtTime,
          status: "PENDING" as const,
          variantId,
          variantName,
          extras: extras.length > 0 ? (extras as any) : undefined,
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
          dataMode,
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
          items: {
            include: {
              product: { include: { category: true } },
            },
          },
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
            stationId: resolveTargetStationId(item.product),
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
      const stationId =
        (item.product && resolveTargetStationId(item.product)) || "NO_STATION";
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
      where: { id: { in: productIds }, eventId: dto.eventId },
      include: { optionGroups: { include: { options: true } } },
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

      const { priceAtTime, variantId, variantName, extras } =
        this.resolveOrderItemPricing(product, item.optionIds ?? []);
      totalAmount += priceAtTime * item.quantity;

      return {
        productId: product.id,
        quantity: item.quantity,
        priceAtTime,
        status: "PENDING" as any,
        variantId,
        variantName,
        extras: extras.length > 0 ? (extras as any) : undefined,
      };
    });

    const totalPaid = dto.payments?.reduce((sum, p) => sum + p.amount, 0) || 0;
    const initialPaymentStatus =
      totalPaid >= totalAmount
        ? "PAID"
        : totalPaid > 0
          ? "PARTIALLY_PAID"
          : "OPEN";

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
      const eventRows = await prisma.$queryRaw<
        { status: string; testMode: boolean }[]
      >(
        Prisma.sql`SELECT "status", "testMode" FROM "Event" WHERE "id" = ${dto.eventId} FOR UPDATE`,
      );
      const event = eventRows[0];
      const orderDataMode =
        event?.status === "ACTIVE" && !event.testMode
          ? "LIVE"
          : event?.status === "TEST_MODE" && event.testMode
            ? "TEST"
            : null;
      if (!orderDataMode)
        throw new BadRequestException("Event is not active for orders");
      const activeSession = userId
        ? await prisma.cashierSession.findFirst({
            where: { userId, eventId: dto.eventId, status: "ACTIVE" },
          })
        : null;
      if (activeSession && activeSession.dataMode !== orderDataMode)
        throw new ConflictException(
          "Die aktive Kassensitzung gehört zu einem anderen Betriebsmodus.",
        );
      const cashierSessionId = activeSession?.id || null;
      const user = userId
        ? await prisma.user.findUnique({ where: { id: userId } })
        : null;
      if (!user?.isActive) {
        throw new BadRequestException("User is not active");
      }
      const order = await prisma.order.create({
        data: {
          totalAmount,
          lifecycleStatus: "SUBMITTED",
          paymentStatus: initialPaymentStatus,
          fulfillmentStatus: "PENDING",
          userId,
          eventId: dto.eventId,
          dataMode: orderDataMode,
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
              product: { include: { category: true } },
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
        items: { include: { product: { include: { category: true } } } },
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
