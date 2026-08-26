import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { CloseSessionDto, StartSessionDto } from "./sessions.dto";

describe("Session-Request-DTOs", () => {
  it.each([-1, 1.5, 2_147_483_648])(
    "weist einen ungültigen Kassenbestand von %s ab",
    async (startingBalance) => {
      const dto = plainToInstance(StartSessionDto, {
        eventId: "11111111-1111-4111-8111-111111111111",
        startingBalance,
      });
      expect(await validate(dto)).not.toHaveLength(0);
    },
  );

  it("akzeptiert die Int32-Randwerte und lehnt unbekannte Aktionsfelder ab", async () => {
    const start = plainToInstance(StartSessionDto, {
      eventId: "11111111-1111-4111-8111-111111111111",
      startingBalance: 0,
    });
    expect(await validate(start)).toHaveLength(0);

    const close = plainToInstance(CloseSessionDto, {
      closingBalance: 2_147_483_647,
      status: "CLOSED",
    });
    expect(
      await validate(close, {
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    ).not.toHaveLength(0);
  });

  it("validiert offlineQueueWarning beim Schließen", async () => {
    const validClose = plainToInstance(CloseSessionDto, {
      closingBalance: 5000,
      offlineQueueWarning: {
        hasOpenOrders: true,
        openCount: 2,
        openTotalCents: 3500,
        acknowledged: true,
      },
    });
    expect(await validate(validClose)).toHaveLength(0);

    const invalidClose = plainToInstance(CloseSessionDto, {
      closingBalance: 5000,
      offlineQueueWarning: {
        hasOpenOrders: true,
        openCount: -1,
        openTotalCents: 3500,
        acknowledged: "yes",
      },
    });
    expect(await validate(invalidClose)).not.toHaveLength(0);
  });
});
