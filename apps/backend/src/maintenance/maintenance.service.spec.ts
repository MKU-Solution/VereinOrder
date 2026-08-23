import { ConflictException } from "@nestjs/common";
import {
  getDrainMinWaitMs,
  MaintenanceService,
  isDrainWaitElapsed,
} from "./maintenance.service";

describe("isDrainWaitElapsed (reine Prüfung, Entwurf Abschnitt 6)", () => {
  it("ist erfüllt, wenn kein 'since' bekannt ist", () => {
    expect(isDrainWaitElapsed({ since: null }, Date.now())).toBe(true);
  });

  it("ist NICHT erfüllt, kurz nach Beginn von DRAINING", () => {
    const since = new Date(Date.now() - 1000).toISOString();
    expect(isDrainWaitElapsed({ since }, Date.now())).toBe(false);
  });

  it("ist erfüllt, sobald die Wartezeit verstrichen ist", () => {
    const since = new Date(Date.now() - getDrainMinWaitMs() - 1).toISOString();
    expect(isDrainWaitElapsed({ since }, Date.now())).toBe(true);
  });

  it("respektiert eine übergebene abweichende Wartezeit (für Tests)", () => {
    const since = new Date(Date.now() - 5000).toISOString();
    expect(isDrainWaitElapsed({ since }, Date.now(), 1000)).toBe(true);
    expect(isDrainWaitElapsed({ since }, Date.now(), 10_000)).toBe(false);
  });
});

function makeDeps(phase: "OPEN" | "DRAINING" | "LOCKED" = "OPEN") {
  const stateService = {
    read: jest.fn(() => ({
      phase,
      since: null,
      byUserId: null,
      byUsername: null,
      reason: null,
      expectedUntil: null,
    })),
    write: jest.fn(),
    clear: jest.fn(),
  };
  const prisma = { printJob: { count: jest.fn().mockResolvedValue(0) } };
  const audit = { log: jest.fn() };
  return { stateService, prisma, audit };
}

describe("MaintenanceService.start/end – nur ADMINISTRATOR, jede Umschaltung auditiert", () => {
  it("start() lehnt ab, wenn bereits nicht OPEN", async () => {
    const { stateService, prisma, audit } = makeDeps("LOCKED");
    const service = new MaintenanceService(
      stateService as any,
      prisma as any,
      audit as any,
    );
    await expect(
      service.start("admin-1", "admin", "Test", undefined),
    ).rejects.toThrow(ConflictException);
    expect(stateService.write).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it("start() schreibt DRAINING mit Urheber und auditiert", async () => {
    const { stateService, prisma, audit } = makeDeps("OPEN");
    const service = new MaintenanceService(
      stateService as any,
      prisma as any,
      audit as any,
    );

    const result = await service.start(
      "admin-1",
      "admin",
      "Wartung",
      "2026-08-23T12:00:00.000Z",
    );

    expect(result.phase).toBe("DRAINING");
    expect(stateService.write).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "DRAINING",
        byUserId: "admin-1",
        byUsername: "admin",
        reason: "Wartung",
        expectedUntil: "2026-08-23T12:00:00.000Z",
      }),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "MAINTENANCE_STARTED",
        userId: "admin-1",
      }),
    );
  });

  it("end() lehnt ab, wenn bereits OPEN", async () => {
    const { stateService, prisma, audit } = makeDeps("OPEN");
    const service = new MaintenanceService(
      stateService as any,
      prisma as any,
      audit as any,
    );
    await expect(service.end("admin-1", "admin")).rejects.toThrow(
      ConflictException,
    );
    expect(stateService.clear).not.toHaveBeenCalled();
  });

  it("end() löscht die Zustandsdatei und auditiert", async () => {
    const { stateService, prisma, audit } = makeDeps("LOCKED");
    const service = new MaintenanceService(
      stateService as any,
      prisma as any,
      audit as any,
    );

    await service.end("admin-1", "admin");

    expect(stateService.clear).toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "MAINTENANCE_ENDED",
        userId: "admin-1",
      }),
    );
  });
});

describe("MaintenanceService.tryAdvanceToLocked – Übergang DRAINING -> LOCKED", () => {
  it("tut nichts außerhalb von DRAINING", async () => {
    const { stateService, prisma, audit } = makeDeps("OPEN");
    const service = new MaintenanceService(
      stateService as any,
      prisma as any,
      audit as any,
    );
    await service.tryAdvanceToLocked();
    expect(prisma.printJob.count).not.toHaveBeenCalled();
    expect(stateService.write).not.toHaveBeenCalled();
  });

  it("wartet die Mindestzeit ab, bevor überhaupt auf Druckaufträge geprüft wird", async () => {
    const stateService = {
      read: jest.fn(() => ({
        phase: "DRAINING",
        since: new Date().toISOString(), // gerade erst begonnen
        byUserId: "admin-1",
        byUsername: "admin",
        reason: null,
        expectedUntil: null,
      })),
      write: jest.fn(),
      clear: jest.fn(),
    };
    const prisma = { printJob: { count: jest.fn() } };
    const audit = { log: jest.fn() };
    const service = new MaintenanceService(
      stateService as any,
      prisma as any,
      audit as any,
    );

    await service.tryAdvanceToLocked();

    expect(prisma.printJob.count).not.toHaveBeenCalled();
    expect(stateService.write).not.toHaveBeenCalled();
  });

  it("sperrt nicht, solange ein Druckauftrag in DELIVERING/SPOOLED steht", async () => {
    const stateService = {
      read: jest.fn(() => ({
        phase: "DRAINING",
        since: new Date(Date.now() - getDrainMinWaitMs() - 1000).toISOString(),
        byUserId: "admin-1",
        byUsername: "admin",
        reason: null,
        expectedUntil: null,
      })),
      write: jest.fn(),
      clear: jest.fn(),
    };
    const prisma = { printJob: { count: jest.fn().mockResolvedValue(1) } };
    const audit = { log: jest.fn() };
    const service = new MaintenanceService(
      stateService as any,
      prisma as any,
      audit as any,
    );

    await service.tryAdvanceToLocked();

    expect(prisma.printJob.count).toHaveBeenCalledWith({
      where: { attemptPhase: { in: ["DELIVERING", "SPOOLED"] } },
    });
    expect(stateService.write).not.toHaveBeenCalled();
  });

  it("sperrt (LOCKED) und auditiert, wenn Wartezeit um ist und keine Druckaufträge mehr offen sind", async () => {
    const stateService = {
      read: jest.fn(() => ({
        phase: "DRAINING",
        since: new Date(Date.now() - getDrainMinWaitMs() - 1000).toISOString(),
        byUserId: "admin-1",
        byUsername: "admin",
        reason: "Wartung",
        expectedUntil: null,
      })),
      write: jest.fn(),
      clear: jest.fn(),
    };
    const prisma = { printJob: { count: jest.fn().mockResolvedValue(0) } };
    const audit = { log: jest.fn() };
    const service = new MaintenanceService(
      stateService as any,
      prisma as any,
      audit as any,
    );

    await service.tryAdvanceToLocked();

    expect(stateService.write).toHaveBeenCalledWith(
      expect.objectContaining({ phase: "LOCKED", byUserId: "admin-1" }),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: "MAINTENANCE_LOCKED" }),
    );
  });
});
