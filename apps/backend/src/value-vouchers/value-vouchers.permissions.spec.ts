import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from "@nestjs/common";
import { ROLES_KEY } from "../common/decorators/roles.decorator";
import { OrdersService } from "../orders/orders.service";
import { validate } from "class-validator";
import {
  IssueValueVoucherDto,
  RedeemValueVoucherDto,
} from "./dto/value-vouchers.dto";
import { ValueVouchersController } from "./value-vouchers.controller";
import { ValueVouchersService } from "./value-vouchers.service";

/**
 * Wächtertests für #139: Diese Spezifikation ist absichtlich nahe an der
 * Sicherheitsgrenze. Sie beweist die Rollenmatrix direkt am Domaenendienst,
 * also unabhängig davon, ob eine Route später versehentlich anders dekoriert
 * wird. Vor dem Test wurde der negative Gegenbeweis geprüft: Ein WAITER darf
 * mit identischem Kontext weder fremde Modi sehen noch ohne eigene aktive
 * Kassensitzung handeln; die folgenden Tests liefern dafür jeweils 403/404.
 */
describe("ValueVouchersService – Rollen- und Mandantengrenzen (#139)", () => {
  const baseVoucher = {
    id: "voucher-1",
    code: "TEST-1234567890ABCD",
    eventId: "event-1",
    dataMode: "TEST",
    status: "ACTIVE",
    initialBalance: 1000,
    currentBalance: 1000,
    version: 0,
  };

  function createPrisma(options?: {
    session?: any;
    event?: any;
    voucher?: any;
  }) {
    const prisma: any = {
      $transaction: jest.fn((callback) => callback(prisma)),
      cashierSession: {
        findUnique: jest.fn().mockResolvedValue(
          options?.session ?? {
            id: "session-1",
            userId: "waiter-1",
            eventId: "event-1",
            status: "ACTIVE",
            dataMode: "TEST",
          },
        ),
      },
      event: {
        findUnique: jest
          .fn()
          .mockResolvedValue(
            options?.event ?? { status: "TEST_MODE", testMode: true },
          ),
      },
      valueVoucher: {
        findUnique: jest
          .fn()
          .mockResolvedValue(options?.voucher ?? baseVoucher),
      },
    };
    return prisma;
  }

  const quote = {
    eventId: "event-1",
    cashierSessionId: "session-1",
    code: "TEST-1234567890ABCD",
  };

  it("beweist die Vorgabe: WAITER darf einen eigenen TEST-Gutschein quotieren", async () => {
    const prisma = createPrisma();
    const service = new ValueVouchersService(prisma, { log: jest.fn() } as any);

    await expect(
      service.quote("waiter-1", "WAITER", quote),
    ).resolves.toMatchObject({ balance: 1000, dataMode: "TEST" });
  });

  it("weist Quote ohne eigene aktive Kassensitzung vor jeder Gutschein-Offenlegung ab", async () => {
    const prisma = createPrisma({
      session: {
        id: "session-1",
        userId: "other-user",
        eventId: "event-1",
        status: "ACTIVE",
        dataMode: "TEST",
      },
    });
    const service = new ValueVouchersService(prisma, { log: jest.fn() } as any);

    await expect(
      service.quote("waiter-1", "CASHIER", quote),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.valueVoucher.findUnique).not.toHaveBeenCalled();
  });

  it("beweist die Vorgabe: ein Gutschein eines anderen Betriebsmodus erscheint als unbekannt", async () => {
    const prisma = createPrisma({
      voucher: { ...baseVoucher, dataMode: "LIVE" },
    });
    const service = new ValueVouchersService(prisma, { log: jest.fn() } as any);

    await expect(
      service.quote("waiter-1", "CASHIER", quote),
    ).rejects.toMatchObject({
      status: 404,
    });
  });

  it("beweist die API-Invariante: der Client darf beim Einlösen keinen Betrag vorgeben", async () => {
    // Rot-Beweis: Der HTTP-Validator muss den Betrag weglassen dürfen. Damit
    // ist sichergestellt, dass die Domaenenlogik min(Saldo, Restbetrag)
    // atomar selbst berechnet und kein manipuliertes amount übernimmt.
    const dto = Object.assign(new RedeemValueVoucherDto(), {
      eventId: "a0a0a0a0-0000-4000-8000-000000000001",
      cashierSessionId: "a0a0a0a0-0000-4000-8000-000000000002",
      orderId: "a0a0a0a0-0000-4000-8000-000000000003",
      code: "TEST-1234567890ABCD",
      idempotencyKey: "redeem-without-client-amount",
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it("akzeptiert bei der Ausgabe CASH und CARD nur gemäß ihrer Tender-Regeln", () => {
    const service = new ValueVouchersService(createPrisma(), {
      log: jest.fn(),
    } as any) as any;

    expect(() => service.validateTender(500, "CASH", 700)).not.toThrow();
    expect(() => service.validateTender(500, "CARD")).not.toThrow();
    expect(() => service.validateTender(500, "CASH", 499)).toThrow();
    expect(() => service.validateTender(500, "CARD", 500)).toThrow();
  });

  it("erzwingt die Rollenmatrix zusätzlich an allen HTTP-Endpunkten", () => {
    expect(
      Reflect.getMetadata(ROLES_KEY, ValueVouchersController.prototype.issue),
    ).toEqual(["ADMINISTRATOR", "CASHIER"]);
    expect(
      Reflect.getMetadata(ROLES_KEY, ValueVouchersController.prototype.quote),
    ).toEqual(["ADMINISTRATOR", "CASHIER", "WAITER"]);
    expect(
      Reflect.getMetadata(ROLES_KEY, ValueVouchersController.prototype.redeem),
    ).toEqual(["ADMINISTRATOR", "CASHIER", "WAITER"]);
    expect(
      Reflect.getMetadata(ROLES_KEY, ValueVouchersController.prototype.history),
    ).toEqual(["ADMINISTRATOR", "EVENT_MANAGER", "REVISION"]);
    expect(
      Reflect.getMetadata(ROLES_KEY, ValueVouchersController.prototype.cancel),
    ).toEqual(["ADMINISTRATOR", "EVENT_MANAGER", "REVISION"]);
  });

  it("maskiert Codes bei Suche und Verlauf, gibt aber bei der Ausgabe den druckbaren Code zurück", async () => {
    const prisma = createPrisma();
    prisma.valueVoucher.findUnique.mockResolvedValueOnce({
      ...baseVoucher,
      movements: [],
    });
    const service = new ValueVouchersService(prisma, { log: jest.fn() } as any);

    await expect(
      service.quote("waiter-1", "WAITER", quote),
    ).resolves.toMatchObject({
      voucherCode: "TEST-…ABCD",
    });
    await expect(
      service.history("waiter-1", "ADMINISTRATOR", quote),
    ).resolves.toMatchObject({
      code: "TEST-…ABCD",
    });

    const dto = Object.assign(new IssueValueVoucherDto(), {
      eventId: "a0a0a0a0-0000-4000-8000-000000000001",
      cashierSessionId: "a0a0a0a0-0000-4000-8000-000000000002",
      printerId: "a0a0a0a0-0000-4000-8000-000000000003",
      amount: 500,
      fundingMethod: "CASH",
      tenderedAmount: 700,
      idempotencyKey: "issue-printable-code",
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it("weist unbekannte, entwertete und stornierte Gutscheine ohne Zahlungsbuchung ab", async () => {
    for (const status of ["DEPLETED", "CANCELLED"] as const) {
      const prisma = createPrisma({
        voucher: { ...baseVoucher, status, currentBalance: 0 },
      });
      const service = new ValueVouchersService(prisma, {
        log: jest.fn(),
      } as any);
      await expect(
        service.quote("waiter-1", "WAITER", quote),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it("lehnt einen wiederverwendeten Idempotenzschlüssel mit abweichendem Fingerprint ab", async () => {
    const prisma = createPrisma();
    prisma.valueVoucherMovement = {
      findUnique: jest.fn().mockResolvedValue({
        requestFingerprint: "anderer-fingerprint",
        voucher: baseVoucher,
      }),
    };
    const service = new ValueVouchersService(prisma, {
      log: jest.fn(),
    } as any) as any;
    await expect(
      service.findIdempotent("same-key", "korrekter-fingerprint"),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("liefert bei identischem Idempotenz-Fingerprint einen maskierten Replay ohne zweite Buchung", async () => {
    const prisma = createPrisma();
    prisma.valueVoucherMovement = {
      findUnique: jest.fn().mockResolvedValue({
        id: "movement-1",
        requestFingerprint: "gleicher-fingerprint",
        balanceAfter: 350,
        voucher: baseVoucher,
      }),
    };
    const service = new ValueVouchersService(prisma, {
      log: jest.fn(),
    } as any) as any;
    await expect(
      service.findIdempotent("same-key", "gleicher-fingerprint"),
    ).resolves.toEqual({
      voucherCode: "TEST-…ABCD",
      movementId: "movement-1",
      currentBalance: 350,
      replayed: true,
    });
  });

  it("lässt den allgemeinen Bestellpfad niemals VOUCHER als Zahlung buchen", () => {
    const orders = new OrdersService({} as any, {} as any) as any;
    expect(() =>
      orders.validatePayments([{ amount: 500, method: "VOUCHER" }]),
    ).toThrow(BadRequestException);
    expect(() =>
      orders.validatePayments([{ amount: 500, method: "CASH" }]),
    ).not.toThrow();
    expect(() =>
      orders.validatePayments([{ amount: 500, method: "CARD" }]),
    ).not.toThrow();
  });
});
