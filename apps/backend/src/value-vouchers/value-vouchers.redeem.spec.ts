import { BadRequestException } from "@nestjs/common";
import { ValueVouchersService } from "./value-vouchers.service";

/**
 * Wächtertests für die atomare Einlösung aus #139. Der Client liefert
 * absichtlich keinen Betrag: der Dienst muss ihn aus Saldo und offener
 * Forderung bestimmen und darf weder Restzahlung noch Wechselgeld überbuchen.
 */
describe("ValueVouchersService – Einlösung und Zahlungsgrenzen (#139)", () => {
  const eventId = "event-1";
  const userId = "cashier-1";
  const sessionId = "session-1";
  const printerId = "printer-1";

  function redeemDto(overrides: Record<string, unknown> = {}) {
    return {
      eventId,
      cashierSessionId: sessionId,
      printerId,
      orderId: "order-1",
      code: "TEST-1234567890ABCD",
      idempotencyKey: "redeem-idempotency-key",
      ...overrides,
    } as any;
  }

  function harness(
    options: {
      balance?: number;
      total?: number;
      lifecycleStatus?: string;
      existingPayments?: Array<{ amount: number; method: string }>;
      voucherStatus?: string;
    } = {},
  ) {
    const payments: any[] = [];
    const movements: any[] = [];
    const printJobs: any[] = [];
    const allocations: any[] = [];
    const audits: any[] = [];
    let balance = options.balance ?? 700;
    let version = 0;
    const order = {
      id: "order-1",
      eventId,
      dataMode: "TEST",
      totalAmount: options.total ?? 1_000,
      lifecycleStatus: options.lifecycleStatus ?? "SUBMITTED",
      paymentStatus: "OPEN",
      payments: options.existingPayments ?? [],
      items: [
        {
          id: "item-1",
          quantity: 1,
          priceAtTime: options.total ?? 1_000,
          depositAtTime: 0,
        },
      ],
    };
    const prisma: any = {
      $transaction: jest.fn((callback) => callback(prisma)),
      $queryRaw: jest.fn().mockResolvedValue([]),
      cashierSession: {
        findUnique: jest.fn().mockResolvedValue({
          id: sessionId,
          userId,
          eventId,
          status: "ACTIVE",
          dataMode: "TEST",
        }),
      },
      event: {
        findUnique: jest.fn().mockResolvedValue({
          name: "Wächtertest",
          status: "TEST_MODE",
          testMode: true,
        }),
      },
      order: {
        findUnique: jest.fn().mockResolvedValue(order),
        update: jest.fn(async ({ data }: any) => ({
          ...order,
          paymentStatus: data.paymentStatus,
        })),
      },
      valueVoucher: {
        findUnique: jest.fn().mockImplementation(async () => ({
          id: "voucher-1",
          code: "TEST-1234567890ABCD",
          eventId,
          dataMode: "TEST",
          status:
            options.voucherStatus ?? (balance > 0 ? "ACTIVE" : "DEPLETED"),
          initialBalance: 1_000,
          currentBalance: balance,
          version,
        })),
        updateMany: jest.fn(async ({ where, data }: any) => {
          if (
            where.currentBalance.gte <= balance &&
            where.status === "ACTIVE" &&
            where.version === version
          ) {
            balance = data.currentBalance;
            version += 1;
            return { count: 1 };
          }
          return { count: 0 };
        }),
      },
      valueVoucherMovement: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(async ({ data }: any) => {
          const row = { id: `movement-${movements.length + 1}`, ...data };
          movements.push(row);
          return row;
        }),
        count: jest.fn().mockResolvedValue(1),
      },
      payment: {
        create: jest.fn(async ({ data }: any) => {
          const row = { id: `payment-${payments.length + 1}`, ...data };
          payments.push(row);
          return row;
        }),
      },
      printer: { findFirst: jest.fn().mockResolvedValue({ id: printerId }) },
      valueVoucherAllocation: {
        create: jest.fn(async ({ data }: any) => allocations.push(data)),
      },
      printJob: {
        create: jest.fn(async ({ data }: any) => printJobs.push(data)),
      },
    };
    const audit = { log: jest.fn(async (data) => audits.push(data)) };
    return {
      service: new ValueVouchersService(prisma, audit as any),
      prisma,
      payments,
      movements,
      printJobs,
      allocations,
      audits,
      get balance() {
        return balance;
      },
    };
  }

  it("bucht serverseitig min(Saldo, Restforderung), CASH-Rest und Wechselgeld", async () => {
    const test = harness({ balance: 700, total: 1_000 });
    await expect(
      test.service.redeem(
        userId,
        "CASHIER",
        redeemDto({
          remainderPayment: { method: "CASH", tenderedAmount: 500 },
        }),
      ),
    ).resolves.toMatchObject({
      redeemedAmount: 700,
      currentBalance: 0,
      paymentStatus: "PAID",
    });

    expect(test.balance).toBe(0);
    expect(test.movements).toEqual([
      expect.objectContaining({
        type: "REDEEM",
        balanceBefore: 700,
        balanceDelta: -700,
        balanceAfter: 0,
      }),
    ]);
    expect(test.payments).toEqual([
      expect.objectContaining({ method: "VOUCHER", amount: 700 }),
      expect.objectContaining({
        method: "CASH",
        amount: 300,
        tenderedAmount: 500,
        changeAmount: 200,
      }),
    ]);
    expect(test.printJobs).toHaveLength(0);
    expect(test.audits).toEqual([
      expect.objectContaining({ action: "VALUE_VOUCHER_REDEEMED" }),
    ]);
  });

  it("druckt einen Restwertbon nur bei positivem Saldo und unterstützt CARD-Rest", async () => {
    const test = harness({ balance: 1_000, total: 700 });
    await test.service.redeem(userId, "WAITER", redeemDto());
    expect(test.payments).toEqual([
      expect.objectContaining({ method: "VOUCHER", amount: 700 }),
    ]);
    expect(test.printJobs).toEqual([
      expect.objectContaining({
        printerId,
        jobType: "VALUE_VOUCHER_BALANCE",
        content: expect.objectContaining({ currentBalance: 300 }),
      }),
    ]);

    const card = harness({ balance: 500, total: 900 });
    await card.service.redeem(
      userId,
      "CASHIER",
      redeemDto({ remainderPayment: { method: "CARD" } }),
    );
    expect(card.payments[1]).toEqual(
      expect.objectContaining({
        method: "CARD",
        amount: 400,
        tenderedAmount: null,
        changeAmount: 0,
      }),
    );
  });

  it("verweigert Unterdeckung, Überzahlung und Restzahlung bei vollständiger Deckung vor jedem Write", async () => {
    const under = harness({ balance: 400, total: 1_000 });
    await expect(
      under.service.redeem(userId, "CASHIER", redeemDto()),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(under.payments).toHaveLength(0);

    const excessive = harness({ balance: 1_000, total: 700 });
    await expect(
      excessive.service.redeem(
        userId,
        "CASHIER",
        redeemDto({ remainderPayment: { method: "CARD" } }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(excessive.payments).toHaveLength(0);

    const invalidCash = harness({ balance: 500, total: 1_000 });
    await expect(
      invalidCash.service.redeem(
        userId,
        "CASHIER",
        redeemDto({
          remainderPayment: { method: "CASH", tenderedAmount: 499 },
        }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(invalidCash.payments).toHaveLength(0);
  });

  it("storniert, unbekannt und bereits entwertet vor Zahlungs- und Auditbuchung", async () => {
    const cancelledOrder = harness({ lifecycleStatus: "CANCELLED" });
    await expect(
      cancelledOrder.service.redeem(userId, "CASHIER", redeemDto()),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(cancelledOrder.payments).toHaveLength(0);

    const depleted = harness({ balance: 0, voucherStatus: "DEPLETED" });
    await expect(
      depleted.service.redeem(userId, "CASHIER", redeemDto()),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(depleted.payments).toHaveLength(0);

    const unknown = harness();
    unknown.prisma.valueVoucher.findUnique.mockResolvedValueOnce(null);
    await expect(
      unknown.service.redeem(userId, "CASHIER", redeemDto()),
    ).rejects.toMatchObject({ status: 404 });
    expect(unknown.payments).toHaveLength(0);
  });
});
