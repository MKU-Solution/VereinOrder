import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import {
  AddPaymentsDto,
  CancelOrderDto,
  CreateOrderDto,
  CreateQuickSaleDto,
  CreateStationSaleDto,
  SplitPaymentDto,
} from "./orders.dto";

const eventId = "11111111-1111-4111-8111-111111111111";
const productId = "22222222-2222-4222-8222-222222222222";
const stationId = "33333333-3333-4333-8333-333333333333";
const key = "44444444-4444-4444-8444-444444444444";

async function errorsFor<T extends object>(
  type: new () => T,
  payload: Record<string, unknown>,
) {
  return validate(plainToInstance(type, payload), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}

describe("Order-Request-DTOs", () => {
  const validOrder = {
    eventId,
    idempotencyKey: key,
    items: [{ productId, quantity: 1 }],
    payments: [{ amount: 100, method: "CASH" }],
  };

  it("akzeptiert ausschließlich positive Int32-Centbeträge", async () => {
    for (const amount of [-1, 0, 1.5, 2_147_483_648]) {
      const errors = await errorsFor(AddPaymentsDto, {
        payments: [{ amount, method: "CASH" }],
      });
      expect(errors).not.toHaveLength(0);
    }
    await expect(
      errorsFor(AddPaymentsDto, {
        payments: [{ amount: 2_147_483_647, method: "VOUCHER" }],
      }),
    ).resolves.toHaveLength(0);
    await expect(
      errorsFor(AddPaymentsDto, {
        payments: [{ amount: 1, method: "REFUND" }],
      }),
    ).resolves.not.toHaveLength(0);
  });

  it("prüft verschachtelte Positionen, UUIDs und die Positionsgrenze", async () => {
    await expect(
      errorsFor(CreateOrderDto, {
        ...validOrder,
        items: [{ productId: "kein-uuid", quantity: 1 }],
      }),
    ).resolves.not.toHaveLength(0);
    await expect(
      errorsFor(CreateOrderDto, {
        ...validOrder,
        items: [{ productId, quantity: 101 }],
      }),
    ).resolves.not.toHaveLength(0);
    await expect(
      errorsFor(CreateOrderDto, {
        ...validOrder,
        items: Array.from({ length: 51 }, () => ({ productId, quantity: 1 })),
      }),
    ).resolves.not.toHaveLength(0);
  });

  it("weist unbekannte Felder auf Root- und Nested-Ebene ab", async () => {
    await expect(
      errorsFor(CreateOrderDto, { ...validOrder, totalAmount: 1 }),
    ).resolves.not.toHaveLength(0);
    await expect(
      errorsFor(CreateOrderDto, {
        ...validOrder,
        items: [{ productId, quantity: 1, priceAtTime: 1 }],
      }),
    ).resolves.not.toHaveLength(0);
  });

  it("trennt die Allowlists von zentralem und Stationsverkauf", async () => {
    const sale = {
      eventId,
      idempotencyKey: key,
      items: [{ productId, quantity: 1 }],
    };
    await expect(
      errorsFor(CreateQuickSaleDto, {
        ...sale,
        paymentMethod: "CASH",
        stationId,
      }),
    ).resolves.not.toHaveLength(0);
    await expect(
      errorsFor(CreateStationSaleDto, {
        ...sale,
        paymentMethod: "CARD",
        stationId,
      }),
    ).resolves.not.toHaveLength(0);
    await expect(
      errorsFor(CreateStationSaleDto, {
        ...sale,
        paymentMethod: "CASH",
        stationId,
      }),
    ).resolves.toHaveLength(0);
  });

  it("lässt leere Schnellverkaufspositionen nur für die Serviceprüfung einer Pfandrückgabe durch", async () => {
    const refundOnlySale = {
      eventId,
      idempotencyKey: key,
      items: [],
      paymentMethod: "CASH",
      depositRefundTotal: 100,
    };

    await expect(
      errorsFor(CreateQuickSaleDto, refundOnlySale),
    ).resolves.toHaveLength(0);
    await expect(
      errorsFor(CreateStationSaleDto, {
        ...refundOnlySale,
        stationId,
      }),
    ).resolves.toHaveLength(0);

    // Normale Bestellungen bleiben echte Bestellungen mit mindestens einer
    // Position; nur der atomare Kassenendpunkt darf eine reine Auszahlung
    // erfassen und prüft die notwendige Pfandrückgabe im Service.
    await expect(
      errorsFor(CreateOrderDto, {
        ...validOrder,
        items: [],
        depositRefundTotal: 100,
      }),
    ).resolves.not.toHaveLength(0);
  });

  it("trimmt Stornogründe und lehnt leere oder zu lange Gründe ab", async () => {
    const dto = plainToInstance(CancelOrderDto, { reason: "  Irrtum  " });
    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.reason).toBe("Irrtum");

    await expect(
      errorsFor(CancelOrderDto, { reason: "   " }),
    ).resolves.not.toHaveLength(0);
    await expect(
      errorsFor(CancelOrderDto, { reason: "x".repeat(501) }),
    ).resolves.not.toHaveLength(0);
  });

  it("validiert SplitPaymentDto für Teilzahlungen", async () => {
    const validSplit = {
      items: [
        {
          orderItemId: "a0000000-0000-4000-8000-000000000001",
          quantity: 2,
        },
      ],
      payments: [{ amount: 2500, method: "CASH" }],
    };
    await expect(errorsFor(SplitPaymentDto, validSplit)).resolves.toHaveLength(
      0,
    );

    // Ungültige Item-Menge
    await expect(
      errorsFor(SplitPaymentDto, {
        ...validSplit,
        items: [
          { orderItemId: "a0000000-0000-4000-8000-000000000001", quantity: 0 },
        ],
      }),
    ).resolves.not.toHaveLength(0);

    // Leeres Item-Array
    await expect(
      errorsFor(SplitPaymentDto, { ...validSplit, items: [] }),
    ).resolves.not.toHaveLength(0);

    // Leeres Payment-Array
    await expect(
      errorsFor(SplitPaymentDto, { ...validSplit, payments: [] }),
    ).resolves.not.toHaveLength(0);
  });
});
