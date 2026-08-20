import { HttpException } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { AuthService } from "./auth.service";

describe("AuthService – PIN-Schutz für Issue #51", () => {
  let prisma: any;
  let jwtService: any;
  let service: AuthService;
  let pinHash: string;

  beforeAll(async () => {
    pinHash = await bcrypt.hash("1234", 4);
  });

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn() },
      authThrottle: {
        findUnique: jest.fn().mockResolvedValue(null),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        upsert: jest.fn(),
        update: jest.fn(),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    jwtService = { sign: jest.fn().mockReturnValue("signed-token") };
    service = new AuthService(prisma, jwtService);
  });

  it("löscht den Fehlversuchszähler nach einer gültigen PIN", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "waiter-1",
      username: "kellner1",
      pinHash,
      role: "WAITER",
      isActive: true,
    });

    const user = await service.validateUser(" kellner1 ", "1234");

    expect(user).toMatchObject({ id: "waiter-1", username: "kellner1" });
    expect(user.pinHash).toBeUndefined();
    expect(prisma.authThrottle.deleteMany).toHaveBeenCalledWith({
      where: { key: "kellner1" },
    });
  });

  it("sperrt nach dem fünften Fehlversuch für fünf Minuten", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "waiter-1",
      username: "kellner1",
      pinHash,
      role: "WAITER",
      isActive: true,
    });
    prisma.authThrottle.upsert.mockResolvedValue({
      key: "kellner1",
      failedAttempts: 5,
      lockedUntil: null,
    });
    prisma.authThrottle.update.mockResolvedValue({});

    await expect(
      service.validateUser("kellner1", "9999"),
    ).rejects.toMatchObject({
      status: 429,
    });

    expect(prisma.authThrottle.update).toHaveBeenCalledWith({
      where: { key: "kellner1" },
      data: { lockedUntil: expect.any(Date) },
    });
    const lockedUntil =
      prisma.authThrottle.update.mock.calls[0][0].data.lockedUntil.getTime();
    expect(lockedUntil).toBeGreaterThan(Date.now() + 4 * 60 * 1000);
  });

  it("prüft während einer aktiven Sperre keine weitere PIN", async () => {
    prisma.authThrottle.findUnique.mockResolvedValue({
      key: "kellner1",
      failedAttempts: 5,
      lockedUntil: new Date(Date.now() + 60_000),
    });

    await expect(
      service.validateUser("kellner1", "1234"),
    ).rejects.toBeInstanceOf(HttpException);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("beginnt nach Ablauf einer Sperre wieder beim ersten Fehlversuch", async () => {
    prisma.authThrottle.findUnique.mockResolvedValue({
      key: "kellner1",
      failedAttempts: 5,
      lockedUntil: new Date(Date.now() - 1_000),
    });
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.authThrottle.upsert.mockResolvedValue({
      key: "kellner1",
      failedAttempts: 1,
      lockedUntil: null,
    });

    await expect(service.validateUser("kellner1", "9999")).resolves.toBeNull();

    expect(prisma.authThrottle.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { failedAttempts: 1, lockedUntil: null },
      }),
    );
    expect(prisma.authThrottle.update).not.toHaveBeenCalled();
  });

  it("auditiert einen Benutzerwechsel mit vorheriger Identität", async () => {
    const user = {
      id: "waiter-2",
      username: "kellner2",
      role: "WAITER",
    };

    await expect(
      service.login(user, "USER_SWITCH", "waiter-1"),
    ).resolves.toEqual({ access_token: "signed-token" });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "USER_SWITCH",
        entityId: "waiter-2",
        entityType: "User",
        userId: "waiter-2",
        details: expect.objectContaining({ previousUserId: "waiter-1" }),
      }),
    });
  });

  it("stellt ohne speicherbaren Audit-Eintrag keinen neuen Token aus", async () => {
    prisma.auditLog.create.mockRejectedValue(new Error("audit unavailable"));

    await expect(
      service.login(
        { id: "waiter-2", username: "kellner2", role: "WAITER" },
        "USER_SWITCH",
        "waiter-1",
      ),
    ).rejects.toThrow("audit unavailable");
    expect(jwtService.sign).not.toHaveBeenCalled();
  });
});
