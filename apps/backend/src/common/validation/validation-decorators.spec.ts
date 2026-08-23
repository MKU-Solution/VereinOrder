import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import {
  INT32_MAX,
  INT32_MIN,
  Int32,
  NonNegativeInt32,
  Quantity,
  SortOrder,
  TrimmedText,
} from "./validation-decorators";

class CommonValuesDto {
  @Int32()
  signed: number;

  @NonNegativeInt32()
  cents: number;

  @Quantity()
  quantity: number;

  @SortOrder()
  sortOrder: number;

  @TrimmedText(10)
  name: string;
}

const valid = {
  signed: 0,
  cents: 0,
  quantity: 1,
  sortOrder: 0,
  name: "Getränke",
};

describe("gemeinsame API-Validatoren", () => {
  it.each([
    ["signed", INT32_MIN],
    ["signed", INT32_MAX],
    ["cents", 0],
    ["cents", INT32_MAX],
    ["quantity", 1],
    ["quantity", 100],
    ["sortOrder", 0],
    ["sortOrder", INT32_MAX],
  ])("akzeptiert den Grenzwert %s=%s", async (field, value) => {
    const dto = plainToInstance(CommonValuesDto, { ...valid, [field]: value });
    expect(await validate(dto)).toHaveLength(0);
  });

  it.each([
    ["signed", INT32_MIN - 1],
    ["signed", INT32_MAX + 1],
    ["signed", 1.5],
    ["signed", "1"],
    ["cents", -1],
    ["cents", INT32_MAX + 1],
    ["quantity", 0],
    ["quantity", 101],
    ["quantity", 1.5],
    ["sortOrder", -1],
    ["sortOrder", 1.5],
    ["name", "           "],
    ["name", "12345678901"],
  ])("verwirft den Grenzfehler %s=%s", async (field, value) => {
    const dto = plainToInstance(CommonValuesDto, { ...valid, [field]: value });
    expect(await validate(dto)).not.toHaveLength(0);
  });

  it("trimmt Texte kontrolliert", async () => {
    const dto = plainToInstance(CommonValuesDto, {
      ...valid,
      name: "  Küche  ",
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.name).toBe("Küche");
  });
});
