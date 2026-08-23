import { createApiValidationPipe } from "../common/validation/api-validation";
import { CopyAssortmentDto, UpdateEventDto } from "./events.dto";

describe("Veranstaltungs-DTOs", () => {
  const pipe = createApiValidationPipe();

  it("lehnt Lifecycle-Felder im allgemeinen Update ab", async () => {
    await expect(
      pipe.transform(
        { name: "Sommerfest", status: "ACTIVE", testMode: false },
        { type: "body", metatype: UpdateEventDto },
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ statusCode: 400 }),
    });
  });

  it("lehnt ungueltige verschachtelte Stationszuordnungen ab", async () => {
    await expect(
      pipe.transform(
        {
          targetEventId: "caa36e5d-cf61-4d4a-9362-a59c33a0bf24",
          stationMappings: { "keine-uuid": "auch-keine-uuid" },
        },
        { type: "body", metatype: CopyAssortmentDto },
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ statusCode: 400 }),
    });
  });
});
