import { DiagnosticsService } from "./diagnostics.service";

describe("DiagnosticsService – Backup-Speicher (Issue #67)", () => {
  it("meldet eine unterschrittene Speicherreserve als roten Betriebsfehler", async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ ok: 1 }]),
      event: {
        count: jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0),
      },
      order: { count: jest.fn().mockResolvedValue(0) },
      product: { count: jest.fn().mockResolvedValue(0) },
      user: { count: jest.fn().mockResolvedValue(1) },
      printJob: { count: jest.fn().mockResolvedValue(0) },
      printer: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const backups = [
      {
        filename: "vereinorder_test_schedule.dump",
        createdAt: new Date().toISOString(),
        sizeBytes: 1024,
      },
    ];
    const storage = {
      totalBytes: 10_000,
      freeBytes: 500,
      backupCount: 1,
      backupBytes: 1200,
      latestStructuredBackup: backups[0],
      latestRestoredBackup: null,
      retention: {
        hourlyKeep: 24,
        dailyKeep: 14,
        eventKeep: 3,
        minFreeBytes: 1000,
      },
      creationAllowed: false,
    };
    const backupService = {
      listBackups: jest.fn().mockResolvedValue(backups),
      getToolStatus: jest.fn().mockReturnValue({ enabled: true }),
      getStorageStatus: jest.fn().mockResolvedValue(storage),
    };
    const service = new DiagnosticsService(prisma as any, backupService as any);

    const result = await service.getStatus();

    expect(result.overallHealth).toBe("RED");
    expect(result.backup.storage).toBe(storage);
    expect(backupService.getStorageStatus).toHaveBeenCalledWith(backups);
    expect(result.recommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "ERROR",
          title: "Zu wenig freier Speicher für Datensicherungen",
          actionTab: "backups",
        }),
      ]),
    );
  });
});
