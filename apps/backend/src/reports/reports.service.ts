import {
  Injectable,
  Inject,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import {
  OperationalDataMode,
  PrismaClient,
  ProductAvailability,
} from "@vereinorder/database";
import { isUUID } from "class-validator";
import { PRISMA_CLIENT } from "../prisma/prisma.module";
import { resolveOperationalDataMode } from "../common/operational-data-mode";

@Injectable()
export class ReportsService {
  constructor(@Inject(PRISMA_CLIENT) private prisma: PrismaClient) {}

  private getEventFilter(eventId?: string) {
    return eventId ? { eventId } : {};
  }

  private availability(
    manualAvailability: ProductAvailability,
    stock: {
      trackingEnabled: boolean;
      stockQuantity: number;
      lowStockThreshold: number;
      manualBlocked: boolean;
    } | null,
  ): ProductAvailability {
    if (manualAvailability === "DISABLED") return "DISABLED";
    if (manualAvailability === "OUT_OF_STOCK" || stock?.manualBlocked)
      return "OUT_OF_STOCK";
    if (stock?.trackingEnabled && stock.stockQuantity === 0)
      return "OUT_OF_STOCK";
    if (
      manualAvailability === "LOW_STOCK" ||
      (stock?.trackingEnabled && stock.stockQuantity <= stock.lowStockThreshold)
    )
      return "LOW_STOCK";
    return "AVAILABLE";
  }

  /**
   * Erstellt den mengenbasierten Bestandsbericht ausschliesslich aus dem
   * unveraenderlichen Ledger. Historische Bestellungen werden bewusst nicht
   * nachtraeglich als Bewegungen interpretiert.
   */
  async getInventoryReport(eventId: string, dataMode: OperationalDataMode) {
    if (!eventId || !dataMode)
      throw new BadRequestException("eventId und dataMode sind erforderlich.");
    if (!isUUID(eventId, "4"))
      throw new BadRequestException(
        "eventId muss eine UUID der Version 4 sein.",
      );
    if (!Object.values(OperationalDataMode).includes(dataMode))
      throw new BadRequestException("Ungültiger dataMode.");

    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { status: true, testMode: true },
    });
    if (!event) throw new NotFoundException("Veranstaltung nicht gefunden.");
    if (resolveOperationalDataMode(event) !== dataMode)
      throw new BadRequestException(
        "Betriebsmodus der Veranstaltung stimmt nicht mit dataMode überein.",
      );

    const [products, stocks, movements] = await Promise.all([
      this.prisma.product.findMany({
        where: { eventId },
        select: { id: true, name: true, manualAvailability: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }],
      }),
      this.prisma.inventoryStock.findMany({
        where: { eventId, dataMode },
        select: {
          productId: true,
          trackingEnabled: true,
          initialQuantity: true,
          stockQuantity: true,
          lowStockThreshold: true,
          manualBlocked: true,
        },
      }),
      this.prisma.inventoryMovement.findMany({
        where: { eventId, dataMode },
        select: { productId: true, type: true, quantityDelta: true },
      }),
    ]);

    const stockByProduct = new Map(
      stocks.map((stock) => [stock.productId, stock]),
    );
    const ledgerByProduct = new Map<
      string,
      {
        initialQuantity: number;
        grossSales: number;
        cancellations: number;
        correctionDelta: number;
      }
    >();
    for (const movement of movements) {
      const entry = ledgerByProduct.get(movement.productId) ?? {
        initialQuantity: 0,
        grossSales: 0,
        cancellations: 0,
        correctionDelta: 0,
      };
      if (movement.type === "INITIALIZATION")
        entry.initialQuantity += movement.quantityDelta;
      else if (movement.type === "SALE")
        entry.grossSales += Math.abs(movement.quantityDelta);
      else if (movement.type === "CANCELLATION")
        entry.cancellations += movement.quantityDelta;
      else if (movement.type === "CORRECTION")
        entry.correctionDelta += movement.quantityDelta;
      ledgerByProduct.set(movement.productId, entry);
    }

    return products.map((product) => {
      const stock = stockByProduct.get(product.id) ?? null;
      const inventoryTracked = stock?.trackingEnabled === true;
      if (!inventoryTracked)
        return {
          productId: product.id,
          name: product.name,
          inventoryTracked: false,
          initialQuantity: null,
          grossSales: null,
          cancellations: null,
          correctionDelta: null,
          expectedQuantity: null,
          actualQuantity: null,
          difference: null,
          lowStockThreshold: null,
          effectiveAvailability: this.availability(
            product.manualAvailability,
            stock,
          ),
        };

      const ledger = ledgerByProduct.get(product.id) ?? {
        initialQuantity: 0,
        grossSales: 0,
        cancellations: 0,
        correctionDelta: 0,
      };
      const expectedQuantity =
        ledger.initialQuantity - ledger.grossSales + ledger.cancellations;
      return {
        productId: product.id,
        name: product.name,
        inventoryTracked: true,
        initialQuantity: ledger.initialQuantity,
        grossSales: ledger.grossSales,
        cancellations: ledger.cancellations,
        correctionDelta: ledger.correctionDelta,
        expectedQuantity,
        actualQuantity: stock!.stockQuantity,
        difference: stock!.stockQuantity - expectedQuantity,
        lowStockThreshold: stock!.lowStockThreshold,
        effectiveAvailability: this.availability(
          product.manualAvailability,
          stock,
        ),
      };
    });
  }

  async getSummary(eventId?: string) {
    const whereEvent = this.getEventFilter(eventId);

    const [orders, payments, cancelledOrders] = await Promise.all([
      this.prisma.order.findMany({
        where: {
          ...whereEvent,
          lifecycleStatus: { not: "CANCELLED" },
        },
        include: {
          payments: true,
          items: { where: { status: { not: "CANCELLED" } } },
        },
      }),
      this.prisma.payment.findMany({
        where: {
          order: {
            ...whereEvent,
          },
          status: "COMPLETED",
        },
      }),
      this.prisma.order.findMany({
        where: {
          ...whereEvent,
          lifecycleStatus: "CANCELLED",
        },
      }),
    ]);

    let totalAmount = 0;
    let openAmount = 0;
    let depositCollected = 0;
    let depositRefunded = 0;
    let netProductSales = 0;

    for (const order of orders) {
      totalAmount += order.totalAmount;
      depositRefunded += order.depositRefundTotal || 0;
      for (const item of order.items || []) {
        const paidQuantity =
          order.paymentStatus === "PAID"
            ? item.quantity
            : Math.min(item.paidQuantity ?? 0, item.quantity);
        depositCollected += (item.depositAtTime || 0) * paidQuantity;
        netProductSales += item.priceAtTime * paidQuantity;
      }
      const orderPaid = order.payments.reduce(
        (sum, p) =>
          p.status === "COMPLETED" && p.method !== "REFUND"
            ? sum + p.amount
            : sum,
        0,
      );
      if (orderPaid < order.totalAmount) {
        openAmount += order.totalAmount - orderPaid;
      }
    }
    const depositNet = depositCollected - depositRefunded;

    let cashRevenue = 0;
    let cardRevenue = 0;
    let voucherRevenue = 0;
    let depositPayouts = 0;

    for (const payment of payments) {
      if (payment.method === "CASH") cashRevenue += payment.amount;
      else if (payment.method === "CARD") cardRevenue += payment.amount;
      else if (payment.method === "VOUCHER") voucherRevenue += payment.amount;
      else if (payment.method === "REFUND") depositPayouts += payment.amount;
    }

    const cancelledAmount = cancelledOrders.reduce(
      (sum, o) => sum + o.totalAmount,
      0,
    );

    return {
      totalAmount,
      orderCount: orders.length,
      openAmount,
      cashRevenue,
      cardRevenue,
      voucherRevenue,
      depositCollected,
      depositRefunded,
      depositNet,
      depositPayouts,
      netProductSales,
      cancelledCount: cancelledOrders.length,
      cancelledAmount,
    };
  }

  async getProductsSummary(eventId?: string) {
    const whereEvent = this.getEventFilter(eventId);

    const items = await this.prisma.orderItem.findMany({
      where: {
        status: { not: "CANCELLED" },
        order: {
          ...whereEvent,
          lifecycleStatus: { not: "CANCELLED" },
        },
      },
      include: {
        product: {
          include: { category: true },
        },
      },
    });

    const productMap = new Map<
      string,
      {
        id: string;
        name: string;
        categoryName: string;
        price: number;
        taxRate: number;
        quantity: number;
        revenue: number;
      }
    >();

    for (const item of items) {
      if (!productMap.has(item.productId)) {
        productMap.set(item.productId, {
          id: item.productId,
          name: item.product.name,
          categoryName: item.product.category?.name || "Ohne Kategorie",
          price: item.product.price,
          taxRate: item.product.taxRate,
          quantity: 0,
          revenue: 0,
        });
      }
      const entry = productMap.get(item.productId)!;
      entry.quantity += item.quantity;
      entry.revenue += item.quantity * item.priceAtTime;
    }

    return Array.from(productMap.values()).sort(
      (a, b) => b.revenue - a.revenue,
    );
  }

  async getCategoriesSummary(eventId?: string) {
    const products = await this.getProductsSummary(eventId);
    const categoryMap = new Map<
      string,
      { name: string; quantity: number; revenue: number }
    >();

    for (const p of products) {
      if (!categoryMap.has(p.categoryName)) {
        categoryMap.set(p.categoryName, {
          name: p.categoryName,
          quantity: 0,
          revenue: 0,
        });
      }
      const cat = categoryMap.get(p.categoryName)!;
      cat.quantity += p.quantity;
      cat.revenue += p.revenue;
    }

    return Array.from(categoryMap.values()).sort(
      (a, b) => b.revenue - a.revenue,
    );
  }

  async getUsersSummary(eventId?: string) {
    const whereEvent = this.getEventFilter(eventId);

    const orders = await this.prisma.order.findMany({
      where: {
        ...whereEvent,
        lifecycleStatus: { not: "CANCELLED" },
      },
      include: {
        user: true,
        payments: {
          where: { status: "COMPLETED" },
        },
      },
    });

    const userMap = new Map<
      string,
      {
        id: string;
        username: string;
        role: string;
        orderCount: number;
        revenue: number;
        cashRevenue: number;
        cardRevenue: number;
      }
    >();

    for (const order of orders) {
      if (!userMap.has(order.userId)) {
        userMap.set(order.userId, {
          id: order.userId,
          username: order.user.username,
          role: order.user.role,
          orderCount: 0,
          revenue: 0,
          cashRevenue: 0,
          cardRevenue: 0,
        });
      }
      const entry = userMap.get(order.userId)!;
      entry.orderCount += 1;
      entry.revenue += order.totalAmount;

      for (const p of order.payments) {
        if (p.method === "CASH") entry.cashRevenue += p.amount;
        else if (p.method === "CARD") entry.cardRevenue += p.amount;
      }
    }

    return Array.from(userMap.values()).sort((a, b) => b.revenue - a.revenue);
  }

  async getHourlySummary(eventId?: string) {
    const whereEvent = this.getEventFilter(eventId);

    const orders = await this.prisma.order.findMany({
      where: {
        ...whereEvent,
        lifecycleStatus: { not: "CANCELLED" },
      },
      select: {
        createdAt: true,
        totalAmount: true,
      },
      orderBy: { createdAt: "asc" },
    });

    const hourlyMap = new Map<
      string,
      { hour: string; count: number; revenue: number }
    >();

    for (const order of orders) {
      const date = new Date(order.createdAt);
      const hourStr = `${date.getHours().toString().padStart(2, "0")}:00`;

      if (!hourlyMap.has(hourStr)) {
        hourlyMap.set(hourStr, { hour: hourStr, count: 0, revenue: 0 });
      }
      const entry = hourlyMap.get(hourStr)!;
      entry.count += 1;
      entry.revenue += order.totalAmount;
    }

    return Array.from(hourlyMap.values());
  }

  async getSessionsSummary(eventId?: string) {
    const whereEvent = this.getEventFilter(eventId);

    const sessions = await this.prisma.cashierSession.findMany({
      where: whereEvent,
      include: {
        user: true,
        payments: true,
      },
      orderBy: { startTime: "desc" },
    });

    return sessions.map((session) => {
      let cashSales = 0;
      let cardSales = 0;
      let cashPayouts = 0;

      for (const p of session.payments) {
        if (p.status === "COMPLETED") {
          if (p.method === "CASH") cashSales += p.amount;
          else if (p.method === "CARD") cardSales += p.amount;
          else if (p.method === "REFUND") cashPayouts += p.amount;
        } else if (p.status === "REFUNDED") {
          if (p.method === "CASH") cashSales -= p.amount;
          else if (p.method === "CARD") cardSales -= p.amount;
        }
      }

      const expectedCash = session.startingBalance + cashSales - cashPayouts;
      const difference =
        session.closingBalance !== null && session.closingBalance !== undefined
          ? session.closingBalance - expectedCash
          : null;

      return {
        id: session.id,
        username: session.user.username,
        status: session.status,
        startTime: session.startTime,
        endTime: session.endTime,
        startingBalance: session.startingBalance,
        cashSales,
        cardSales,
        cashPayouts,
        expectedCash,
        closingBalance: session.closingBalance,
        difference,
      };
    });
  }

  private formatCents(cents: number | null | undefined): string {
    if (cents === null || cents === undefined) return "";
    return (cents / 100).toFixed(2).replace(".", ",");
  }

  private formatDate(d?: Date | string | null): string {
    if (!d) return "";
    const date = new Date(d);
    return date.toLocaleString("de-AT", { timeZone: "Europe/Vienna" });
  }

  async exportCsv(
    type:
      | "orders"
      | "products"
      | "users"
      | "sessions"
      | "categories"
      | "inventory",
    eventId?: string,
    dataMode?: string,
  ): Promise<string> {
    const BOM = "\uFEFF";
    const whereEvent = this.getEventFilter(eventId);

    if (type === "inventory") {
      const inventory = await this.getInventoryReport(
        eventId ?? "",
        dataMode as OperationalDataMode,
      );
      const header = [
        "Produkt-ID",
        "Produkt",
        "Bestandsführung aktiv",
        "Anfangsbestand",
        "Verkäufe (Abgänge)",
        "Stornierungen",
        "Korrektur-Differenz",
        "Sollbestand",
        "Istbestand",
        "Differenz",
        "Mindestbestand",
        "Effektive Verfügbarkeit",
      ].join(";");
      const value = (input: string | number | boolean | null) =>
        input === null
          ? ""
          : typeof input === "boolean"
            ? input
              ? "Ja"
              : "Nein"
            : String(input);
      const quote = (input: string) => `"${input.replace(/"/g, '""')}"`;
      const rows = inventory.map((row) =>
        [
          row.productId,
          quote(row.name),
          value(row.inventoryTracked),
          value(row.initialQuantity),
          value(row.grossSales),
          value(row.cancellations),
          value(row.correctionDelta),
          value(row.expectedQuantity),
          value(row.actualQuantity),
          value(row.difference),
          value(row.lowStockThreshold),
          row.effectiveAvailability,
        ].join(";"),
      );
      return BOM + [header, ...rows].join("\r\n");
    }

    if (type === "products") {
      const products = await this.getProductsSummary(eventId);
      const header = [
        "Produkt",
        "Kategorie",
        "Einzelpreis (€)",
        "Steuersatz (%)",
        "Verkaufte Menge",
        "Gesamtumsatz (€)",
      ].join(";");
      const rows = products.map((p) =>
        [
          `"${p.name.replace(/"/g, '""')}"`,
          `"${p.categoryName.replace(/"/g, '""')}"`,
          this.formatCents(p.price),
          (p.taxRate / 100).toFixed(1).replace(".", ","),
          p.quantity.toString(),
          this.formatCents(p.revenue),
        ].join(";"),
      );

      return BOM + [header, ...rows].join("\r\n");
    }

    if (type === "categories") {
      const categories = await this.getCategoriesSummary(eventId);
      const header = [
        "Kategorie",
        "Verkaufte Artikel",
        "Gesamtumsatz (€)",
      ].join(";");
      const rows = categories.map((c) =>
        [
          `"${c.name.replace(/"/g, '""')}"`,
          c.quantity.toString(),
          this.formatCents(c.revenue),
        ].join(";"),
      );

      return BOM + [header, ...rows].join("\r\n");
    }

    if (type === "users") {
      const users = await this.getUsersSummary(eventId);
      const header = [
        "Mitarbeiter",
        "Rolle",
        "Bestellungen",
        "Bar-Einnahmen (€)",
        "Karten-Einnahmen (€)",
        "Gesamtumsatz (€)",
      ].join(";");
      const rows = users.map((u) =>
        [
          `"${u.username.replace(/"/g, '""')}"`,
          u.role,
          u.orderCount.toString(),
          this.formatCents(u.cashRevenue),
          this.formatCents(u.cardRevenue),
          this.formatCents(u.revenue),
        ].join(";"),
      );

      return BOM + [header, ...rows].join("\r\n");
    }

    if (type === "sessions") {
      const sessions = await this.getSessionsSummary(eventId);
      const header = [
        "Sitzung ID",
        "Mitarbeiter",
        "Status",
        "Startzeit",
        "Endzeit",
        "Startguthaben (€)",
        "Barumsatz (€)",
        "Soll-Bargeld (€)",
        "Gezählt (€)",
        "Differenz (€)",
      ].join(";");
      const rows = sessions.map((s) =>
        [
          s.id,
          `"${s.username.replace(/"/g, '""')}"`,
          s.status,
          this.formatDate(s.startTime),
          this.formatDate(s.endTime),
          this.formatCents(s.startingBalance),
          this.formatCents(s.cashSales),
          this.formatCents(s.expectedCash),
          this.formatCents(s.closingBalance),
          this.formatCents(s.difference),
        ].join(";"),
      );

      return BOM + [header, ...rows].join("\r\n");
    }

    if (type === "orders") {
      const orders = await this.prisma.order.findMany({
        where: whereEvent,
        include: {
          user: true,
          payments: true,
        },
        orderBy: { createdAt: "desc" },
      });

      const header = [
        "Bestell-ID",
        "Bestellnummer",
        "Zeitpunkt",
        "Tisch / Bereich",
        "Mitarbeiter",
        "Status",
        "Zahlungsstatus",
        "Gesamtbetrag (€)",
        "Bezahlt Bar (€)",
        "Bezahlt Karte (€)",
      ].join(";");
      const rows = orders.map((o) => {
        const cash = o.payments
          .filter((p) => p.method === "CASH" && p.status === "COMPLETED")
          .reduce((sum, p) => sum + p.amount, 0);
        const card = o.payments
          .filter((p) => p.method === "CARD" && p.status === "COMPLETED")
          .reduce((sum, p) => sum + p.amount, 0);

        return [
          o.id,
          o.orderNumber.toString(),
          this.formatDate(o.createdAt),
          `"${(o.tableName || "").replace(/"/g, '""')}"`,
          `"${o.user.username.replace(/"/g, '""')}"`,
          o.lifecycleStatus,
          o.paymentStatus,
          this.formatCents(o.totalAmount),
          this.formatCents(cash),
          this.formatCents(card),
        ].join(";");
      });

      return BOM + [header, ...rows].join("\r\n");
    }

    throw new BadRequestException(`Unbekannter Export-Typ: ${type}`);
  }
}
