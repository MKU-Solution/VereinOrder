import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import {
  AddPaymentsDto,
  CancelOrderDto,
  CreateOrderDto,
  CreateQuickSaleDto,
  CreateStationSaleDto,
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
});
