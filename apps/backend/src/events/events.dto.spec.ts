import { createApiValidationPipe } from "../common/validation/api-validation";
import {
  ChangeEventStatusDto,
  CopyAssortmentDto,
  UpdateEventDto,
} from "./events.dto";

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

  it("akzeptiert und validiert ChangeEventStatusDto mit offlineQueueWarning", async () => {
    const valid = await pipe.transform(
      {
        status: "COMPLETED",
        offlineQueueWarning: {
          hasOpenOrders: true,
          openCount: 5,
          openTotalCents: 12000,
          acknowledged: true,
        },
      },
      { type: "body", metatype: ChangeEventStatusDto },
    );
    expect(valid.status).toBe("COMPLETED");
    expect(valid.offlineQueueWarning?.openCount).toBe(5);

    await expect(
      pipe.transform(
        {
          status: "COMPLETED",
          offlineQueueWarning: {
            hasOpenOrders: true,
            openCount: -2,
            openTotalCents: 12000,
            acknowledged: true,
          },
        },
        { type: "body", metatype: ChangeEventStatusDto },
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ statusCode: 400 }),
    });
  });
});
