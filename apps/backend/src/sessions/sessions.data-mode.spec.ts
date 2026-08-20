import { BadRequestException } from "@nestjs/common";
import { SessionsService } from "./sessions.service";

describe("SessionsService – unveränderlicher Betriebsmodus", () => {
  const createPrisma = (
    event: { status: string; testMode: boolean } | null,
  ) => {
    const prisma: any = {
      $queryRaw: jest
        .fn()
        .mockResolvedValue(event ? [{ id: "event-1", ...event }] : []),
      $transaction: jest.fn((callback) => callback(prisma)),
      cashierSession: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ id: "session-1", ...data }),
          ),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    return prisma;
  };

  it.each([
    { status: "TEST_MODE", testMode: true, expected: "TEST" },
    { status: "ACTIVE", testMode: false, expected: "LIVE" },
  ])(
    "speichert $expected aus dem unter Lock gelesenen Eventzustand",
    async ({ status, testMode, expected }) => {
      const prisma = createPrisma({ status, testMode });
      const service = new SessionsService(prisma);

      await service.startSession("cashier-1", "event-1", 1000);

      expect(prisma.cashierSession.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          eventId: "event-1",
          dataMode: expected,
        }),
      });
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    },
  );

  it("legt bei einem inkonsistenten Eventzustand keine Sitzung an", async () => {
    const prisma = createPrisma({ status: "ACTIVE", testMode: true });
    const service = new SessionsService(prisma);

    await expect(
      service.startSession("cashier-1", "event-1", 1000),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.cashierSession.create).not.toHaveBeenCalled();
  });
});
