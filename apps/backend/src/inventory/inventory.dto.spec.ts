import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import {
  CorrectInventoryDto,
  InitializeInventoryDto,
  UpdateInventorySettingsDto,
} from "./inventory.dto";

const base = {
  eventId: "11111111-1111-4111-8111-111111111111",
  dataMode: "LIVE",
  idempotencyKey: "key",
};

describe("Inventar-DTOs – Zahlen- und Begründungsgrenzen", () => {
  it.each([-1, 2147483648, 1.5])(
    "weist unzulässigen Initialbestand %s ab",
    async (quantity) => {
      const errors = await validate(
        plainToInstance(InitializeInventoryDto, {
          ...base,
          quantity,
          lowStockThreshold: 0,
        }),
      );
      expect(errors.length).toBeGreaterThan(0);
    },
  );

  it("weist negativen/zu großen Istbestand und leeren Korrekturgrund ab", async () => {
    const negative = await validate(
      plainToInstance(CorrectInventoryDto, {
        ...base,
        quantity: -1,
        reason: " ",
      }),
    );
    const overflow = await validate(
      plainToInstance(CorrectInventoryDto, {
        ...base,
        quantity: 2147483648,
        reason: "Inventur",
      }),
    );
    expect(negative.length).toBeGreaterThan(0);
    expect(overflow.length).toBeGreaterThan(0);
  });

  it("akzeptiert zustandsidempotente Einstellungen ohne Idempotency-Key", async () => {
    const errors = await validate(
      plainToInstance(UpdateInventorySettingsDto, {
        eventId: base.eventId,
        dataMode: base.dataMode,
        lowStockThreshold: 2,
        manualBlocked: true,
      }),
    );

    expect(errors).toEqual([]);
  });
});
