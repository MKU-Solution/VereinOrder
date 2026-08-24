import { ConflictException } from "@nestjs/common";
import { ROLES_KEY } from "../common/decorators/roles.decorator";
import { BackupController } from "./backup.controller";

describe("BackupController – Rollen und Formatsperren (Issue #67)", () => {
  const legacy = {
    restoreBackup: jest.fn(),
  };
  const native = {
    createBackup: jest.fn(),
    listBackups: jest.fn(),
    verifyRestoration: jest.fn(),
    getDownloadFilePath: jest.fn(),
  };
  const controller = new BackupController(legacy as any, native as any);

  beforeEach(() => jest.clearAllMocks());

  it.each([
    "createBackup",
    "listBackups",
    "verifyRestore",
    "downloadBackup",
    "restoreBackup",
  ] as const)("schützt %s ausdrücklich mit ADMINISTRATOR", (method) => {
    expect(Reflect.getMetadata(ROLES_KEY, controller[method])).toEqual([
      "ADMINISTRATOR",
    ]);
  });

  it("übergibt Dump und Administratoridentität an die isolierte Wiederherstellungsprüfung", async () => {
    native.verifyRestoration.mockResolvedValue({
      filename: "vereinorder_test_manual.dump",
    });

    await controller.verifyRestore(
      { user: { userId: "admin-id", username: "admin" } },
      { filename: "vereinorder_test_manual.dump" },
    );

    expect(native.verifyRestoration).toHaveBeenCalledWith(
      "vereinorder_test_manual.dump",
      { userId: "admin-id", username: "admin" },
    );
  });

  it("übergibt die auditierbare Administratoridentität an die native Sicherung", async () => {
    native.createBackup.mockResolvedValue({ filename: "test.dump" });

    await controller.createBackup({
      user: { userId: "admin-id", username: "admin" },
    });

    expect(native.createBackup).toHaveBeenCalledWith("MANUAL", {
      userId: "admin-id",
      username: "admin",
    });
  });

  it.each([
    "vereinorder_2026-08-24T10-00-00.000Z_manual.dump",
    "vereinorder_2026-08-24T10-00-00.000Z_manual.manifest.json",
  ])(
    "lehnt den nativen Restore von %s vor dem Legacy-Dienst ab",
    async (filename) => {
      await expect(
        controller.restoreBackup(
          { user: { userId: "admin-id" } },
          { filename },
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(legacy.restoreBackup).not.toHaveBeenCalled();
    },
  );

  it("delegiert ausschließlich eine JSON-Altsicherung", async () => {
    legacy.restoreBackup.mockResolvedValue({ success: true });

    await controller.restoreBackup(
      { user: { userId: "admin-id" } },
      { filename: "vereinorder_backup_altbestand.json" },
    );

    expect(legacy.restoreBackup).toHaveBeenCalledWith(
      "vereinorder_backup_altbestand.json",
      "admin-id",
    );
  });
});
