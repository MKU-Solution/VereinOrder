import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { CreateAreaDto } from "../areas/dto/area.dto";
import { createApiValidationPipe } from "../common/validation/api-validation";
import { CreateStationDto } from "../stations/dto/station.dto";
import { CreateCategoryDto, CreateProductDto } from "./dto/product.dto";

const eventId = "10000000-0000-4000-8000-000000000001";
const categoryId = "10000000-0000-4000-8000-000000000002";

describe("Stammdaten-DTOs (Issue #69)", () => {
  it.each([
    [CreateAreaDto, { eventId, name: "   " }],
    [CreateStationDto, { eventId }],
    [CreateStationDto, { eventId, name: "Schank", shortName: "1234567890123" }],
    [CreateCategoryDto, { eventId }],
    [CreateProductDto, { eventId, categoryId, price: 500 }],
    [CreateProductDto, { eventId, categoryId, name: "Cola", price: 1.5 }],
  ])("weist fehlende oder begrenzungswidrige Felder ab", async (Dto, input) => {
    expect(
      await validate(plainToInstance(Dto as new () => object, input)),
    ).not.toHaveLength(0);
  });

  it("verwirft unbekannte verschachtelte Prisma-Felder", async () => {
    await expect(
      createApiValidationPipe().transform(
        {
          eventId,
          categoryId,
          name: "Cola",
          price: 350,
          optionGroups: [
            {
              name: "Größe",
              selectionType: "SINGLE",
              isRequired: true,
              minSelect: 1,
              maxSelect: 1,
              priceMode: "ABSOLUTE",
              quickSaleTiles: true,
              sortOrder: 0,
              product: { connect: { id: "fremd" } },
              options: [],
            },
          ],
        },
        { type: "body", metatype: CreateProductDto },
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});
