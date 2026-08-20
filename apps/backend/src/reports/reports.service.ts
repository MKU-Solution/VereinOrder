import { Injectable, Inject, BadRequestException } from "@nestjs/common";
import { PrismaClient } from "@vereinorder/database";
import { PRISMA_CLIENT } from "../prisma/prisma.module";

@Injectable()
export class ReportsService {
  constructor(@Inject(PRISMA_CLIENT) private prisma: PrismaClient) {}

  private getEventFilter(eventId?: string) {
    return eventId ? { eventId } : {};
  }

  async getSummary(eventId?: string) {
    const whereEvent = this.getEventFilter(eventId);

    const [orders, payments, cancelledOrders] = await Promise.all([
      this.prisma.order.findMany({
        where: {
          ...whereEvent,
          lifecycleStatus: { not: "CANCELLED" },
        },
        include: { payments: true },
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

    for (const order of orders) {
      totalAmount += order.totalAmount;
      const orderPaid = order.payments.reduce(
        (sum, p) => (p.status === "COMPLETED" ? sum + p.amount : sum),
        0,
      );
      if (orderPaid < order.totalAmount) {
        openAmount += order.totalAmount - orderPaid;
      }
    }

    let cashRevenue = 0;
    let cardRevenue = 0;
    let voucherRevenue = 0;

    for (const payment of payments) {
      if (payment.method === "CASH") cashRevenue += payment.amount;
      else if (payment.method === "CARD") cardRevenue += payment.amount;
      else if (payment.method === "VOUCHER") voucherRevenue += payment.amount;
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

      for (const p of session.payments) {
        if (p.status === "COMPLETED") {
          if (p.method === "CASH") cashSales += p.amount;
          else if (p.method === "CARD") cardSales += p.amount;
        } else if (p.status === "REFUNDED") {
          if (p.method === "CASH") cashSales -= p.amount;
          else if (p.method === "CARD") cardSales -= p.amount;
        }
      }

      const expectedCash = session.startingBalance + cashSales;
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
    type: "orders" | "products" | "users" | "sessions" | "categories",
    eventId?: string,
  ): Promise<string> {
    const BOM = "\uFEFF";
    const whereEvent = this.getEventFilter(eventId);

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
