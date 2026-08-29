import { BadRequestException } from "@nestjs/common";
import {
  BACKUP_MANIFEST_KIND,
  BACKUP_MANIFEST_VERSION,
  BackupManifest,
  calculateSchemaFingerprint,
  parseBackupManifest,
  serializeBackupManifest,
} from "./backup-manifest";

function validManifest(): BackupManifest {
  const migrations = [
    { name: "20260801000000_first", checksum: "checksum-a" },
    { name: "20260802000000_second", checksum: "checksum-b" },
  ];
  return {
    kind: BACKUP_MANIFEST_KIND,
    manifestVersion: BACKUP_MANIFEST_VERSION,
    createdAt: "2026-08-24T08:30:00.000Z",
    trigger: "MANUAL",
    createdBy: { userId: "admin-id", username: "admin" },
    appVersion: "0.1.0",
    databaseName: "vereinorder_issue67_test",
    serverVersionNum: 160010,
    dumpToolVersion: "pg_dump (PostgreSQL) 16.10",
    migrations,
    schemaFingerprint: calculateSchemaFingerprint(migrations),
    countsBefore: { Order: 2, _prisma_migrations: 2 },
    countsAfter: { Order: 2, _prisma_migrations: 2 },
    sumsBefore: {
      byDataMode: {
        LIVE: {
          orderTotalAmount: 1050,
          paymentAmount: { CASH: 1050 },
          voucherCount: { ISSUED: 3 },
          valueVoucherBalance: 2000,
          valueVoucherMovementBalance: 2000,
          valueVoucherCount: { ACTIVE: 2 },
          inventoryStockQuantity: 17,
          inventoryMovementQuantity: 17,
          inventoryTrackedCount: 3,
          inventoryManualBlockedCount: 1,
        },
        TEST: {
          orderTotalAmount: 0,
          paymentAmount: {},
          voucherCount: {},
          valueVoucherBalance: 0,
          valueVoucherMovementBalance: 0,
          valueVoucherCount: {},
          inventoryStockQuantity: 0,
          inventoryMovementQuantity: 0,
          inventoryTrackedCount: 0,
          inventoryManualBlockedCount: 0,
        },
      },
      auditLogCount: 4,
      auditLogWithUserCount: 3,
    },
    sumsAfter: {
      byDataMode: {
        LIVE: {
          orderTotalAmount: 1050,
          paymentAmount: { CASH: 1050 },
          voucherCount: { ISSUED: 3 },
          valueVoucherBalance: 2000,
          valueVoucherMovementBalance: 2000,
          valueVoucherCount: { ACTIVE: 2 },
          inventoryStockQuantity: 17,
          inventoryMovementQuantity: 17,
          inventoryTrackedCount: 3,
          inventoryManualBlockedCount: 1,
        },
        TEST: {
          orderTotalAmount: 0,
          paymentAmount: {},
          voucherCount: {},
          valueVoucherBalance: 0,
          valueVoucherMovementBalance: 0,
          valueVoucherCount: {},
          inventoryStockQuantity: 0,
          inventoryMovementQuantity: 0,
          inventoryTrackedCount: 0,
          inventoryManualBlockedCount: 0,
        },
      },
      auditLogCount: 4,
      auditLogWithUserCount: 3,
    },
    dumpFile: "vereinorder_2026-08-24T08-30-00.000Z_manual.dump",
    dumpSizeBytes: 2048,
    dumpSha256: "a".repeat(64),
    verification: {
      structure: {
        status: "PASSED",
        checkedAt: "2026-08-24T08:30:01.000Z",
        restoreToolVersion: "pg_restore (PostgreSQL) 16.10",
        observedSizeBytes: 2048,
        observedMtimeMs: 1_787_560_201_000,
      },
      restoration: { status: "NOT_RUN" },
    },
  };
}

describe("PostgreSQL-Sicherungsmanifest V1 (Issue #67)", () => {
  it("akzeptiert den vollständigen dokumentierten Vertrag", () => {
    const manifest = validManifest();
    expect(parseBackupManifest(serializeBackupManifest(manifest))).toEqual(
      manifest,
    );
  });

  it("bildet den Schemafingerabdruck ausschließlich aus sortierten Namens-/Prüfsummenpaaren", () => {
    const first = calculateSchemaFingerprint([
      { name: "b", checksum: "2" },
      { name: "a", checksum: "1" },
    ]);
    const second = calculateSchemaFingerprint([
      { name: "a", checksum: "1" },
      { name: "b", checksum: "2" },
    ]);
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });

  it("normalisiert ältere Manifeste ohne Wertgutschein-Summen rückwärtskompatibel", () => {
    const legacy: any = JSON.parse(serializeBackupManifest(validManifest()));
    for (const snapshot of [legacy.sumsBefore, legacy.sumsAfter]) {
      for (const sums of Object.values(snapshot.byDataMode) as any[]) {
        delete sums.valueVoucherBalance;
        delete sums.valueVoucherMovementBalance;
        delete sums.valueVoucherCount;
        delete sums.inventoryStockQuantity;
        delete sums.inventoryMovementQuantity;
        delete sums.inventoryTrackedCount;
        delete sums.inventoryManualBlockedCount;
      }
    }

    const parsed = parseBackupManifest(JSON.stringify(legacy));
    expect(parsed.sumsAfter.byDataMode.LIVE).toMatchObject({
      valueVoucherBalance: 0,
      valueVoucherMovementBalance: 0,
      valueVoucherCount: {},
    });
  });

  it("normalisiert 0.2-era Manifeste ohne Bestandssummen rückwärtskompatibel", () => {
    const legacy: any = JSON.parse(serializeBackupManifest(validManifest()));
    for (const snapshot of [legacy.sumsBefore, legacy.sumsAfter]) {
      for (const sums of Object.values(snapshot.byDataMode) as any[]) {
        delete sums.inventoryStockQuantity;
        delete sums.inventoryMovementQuantity;
        delete sums.inventoryTrackedCount;
        delete sums.inventoryManualBlockedCount;
      }
    }

    const parsed = parseBackupManifest(JSON.stringify(legacy));
    expect(parsed.sumsAfter.byDataMode.LIVE).toMatchObject({
      inventoryStockQuantity: 0,
      inventoryMovementQuantity: 0,
      inventoryTrackedCount: 0,
      inventoryManualBlockedCount: 0,
    });
  });

  it.each([
    ["unbekannte Manifestversion", (m: any) => (m.manifestVersion = 2)],
    ["unbekanntes Wurzelfeld", (m: any) => (m.secret = "nope")],
    ["falscher Dumpname", (m: any) => (m.dumpFile = "../backup.dump")],
    ["falsche Prüfsumme", (m: any) => (m.dumpSha256 = "kurz")],
    [
      "abweichender Schemafingerabdruck",
      (m: any) => (m.schemaFingerprint = "b".repeat(64)),
    ],
    ["nicht sortierte Migrationen", (m: any) => m.migrations.reverse()],
    [
      "gebrochene Geldsumme",
      (m: any) => (m.sumsAfter.byDataMode.LIVE.orderTotalAmount = 1.5),
    ],
    [
      "zusätzliches Verifikationsfeld",
      (m: any) => (m.verification.structure.details = "intern"),
    ],
  ])("verwirft %s strikt", (_label, mutate) => {
    const manifest: any = JSON.parse(serializeBackupManifest(validManifest()));
    mutate(manifest);
    expect(() => parseBackupManifest(JSON.stringify(manifest))).toThrow(
      BadRequestException,
    );
  });
});
