import { ConflictException } from "@nestjs/common";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { NativeRestoreService } from "./native-restore.service";

describe("NativeRestoreService-Sicherheitsgrenzen (Issue #67)", () => {
  let stateDir: string;
  let previousStateDir: string | undefined;
  let previousDatabaseUrl: string | undefined;

  beforeEach(() => {
    previousStateDir = process.env.STATE_DIR;
    previousDatabaseUrl = process.env.DATABASE_URL;
    stateDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "vereinorder-native-restore-unit-"),
    );
    process.env.STATE_DIR = stateDir;
    process.env.DATABASE_URL =
      "postgresql://user:secret@localhost:5432/vereinorder_issue67_test";
  });

  afterEach(() => {
    fs.rmSync(stateDir, { recursive: true, force: true });
    restoreEnvironment("STATE_DIR", previousStateDir);
    restoreEnvironment("DATABASE_URL", previousDatabaseUrl);
  });

  it("verweigert die Umschaltung außerhalb von LOCKED vor jedem Dateizugriff", async () => {
    const backups = {
      getDownloadFilePath: jest.fn(),
    };
    const service = createService("OPEN", backups);

    await expect(
      service.execute(
        "vereinorder_test_manual.dump",
        {
          confirmedCreatedAt: "2026-08-24T08:30:00.000Z",
          queuesConfirmed: true,
        },
        { userId: "admin-id", username: "admin" },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(backups.getDownloadFilePath).not.toHaveBeenCalled();
  });

  it("verweigert Rücknahme und Abnahme ohne exakt passenden Vorgang", async () => {
    const service = createService("LOCKED", {});

    await expect(
      service.rollback("0123456789abcdef", "2026-08-24T08:30:00.000Z", {
        userId: "admin-id",
        username: "admin",
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.accept("0123456789abcdef", "2026-08-24T08:30:00.000Z", {
        userId: "admin-id",
        username: "admin",
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  function createService(phase: string, backups: object): NativeRestoreService {
    return new NativeRestoreService(
      {
        $connect: jest.fn(),
        $disconnect: jest.fn(),
        auditLog: { findFirst: jest.fn(), create: jest.fn() },
      } as any,
      { read: () => ({ phase }) } as any,
      { end: jest.fn() } as any,
      backups as any,
      {} as any,
      { schedule: jest.fn() } as any,
    );
  }
});

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
