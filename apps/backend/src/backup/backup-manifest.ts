import { BadRequestException } from "@nestjs/common";
import { createHash } from "node:crypto";

export const BACKUP_MANIFEST_KIND = "VEREINORDER_DB_BACKUP" as const;
export const BACKUP_MANIFEST_VERSION = 1 as const;
export const BACKUP_TRIGGERS = [
  "MANUAL",
  "SCHEDULE",
  "PRE_RESTORE",
  "PRE_MIGRATION",
] as const;

export type BackupTrigger = (typeof BACKUP_TRIGGERS)[number];
export type BackupVerificationStatus = "PASSED" | "FAILED";
export type RestoreVerificationStatus = "NOT_RUN" | "PASSED" | "FAILED";

export interface BackupCreatedBy {
  userId: string;
  username: string;
}

export interface BackupMigration {
  name: string;
  checksum: string;
}

export interface BackupModeSums {
  orderTotalAmount: number;
  paymentAmount: Record<string, number>;
  voucherCount: Record<string, number>;
  valueVoucherBalance: number;
  valueVoucherMovementBalance: number;
  valueVoucherCount: Record<string, number>;
}

export interface BackupSums {
  byDataMode: Record<string, BackupModeSums>;
  auditLogCount: number;
  auditLogWithUserCount: number;
}

export interface BackupManifest {
  kind: typeof BACKUP_MANIFEST_KIND;
  manifestVersion: typeof BACKUP_MANIFEST_VERSION;
  createdAt: string;
  trigger: BackupTrigger;
  createdBy: BackupCreatedBy | null;
  appVersion: string;
  databaseName: string;
  serverVersionNum: number;
  dumpToolVersion: string;
  migrations: BackupMigration[];
  schemaFingerprint: string;
  countsBefore: Record<string, number>;
  countsAfter: Record<string, number>;
  sumsBefore: BackupSums;
  sumsAfter: BackupSums;
  dumpFile: string;
  dumpSizeBytes: number;
  dumpSha256: string;
  verification: {
    structure:
      | {
          status: "PASSED";
          checkedAt: string;
          restoreToolVersion: string;
          observedSizeBytes: number;
          observedMtimeMs: number;
        }
      | {
          status: "FAILED";
          checkedAt: string;
          errorCode: string;
        };
    restoration:
      | { status: "NOT_RUN" }
      | { status: "PASSED" | "FAILED"; checkedAt: string };
  };
}

const ROOT_KEYS = [
  "kind",
  "manifestVersion",
  "createdAt",
  "trigger",
  "createdBy",
  "appVersion",
  "databaseName",
  "serverVersionNum",
  "dumpToolVersion",
  "migrations",
  "schemaFingerprint",
  "countsBefore",
  "countsAfter",
  "sumsBefore",
  "sumsAfter",
  "dumpFile",
  "dumpSizeBytes",
  "dumpSha256",
  "verification",
] as const;

function invalid(): never {
  throw new BadRequestException(
    "Ungültiges oder beschädigtes Sicherungsmanifest.",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
) {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    keys.length !== wanted.length ||
    keys.some((key, index) => key !== wanted[index])
  ) {
    invalid();
  }
}

function assertText(value: unknown, maxLength = 512): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength
  ) {
    invalid();
  }
}

function assertIsoDate(value: unknown): asserts value is string {
  assertText(value, 64);
  if (!Number.isFinite(Date.parse(value))) invalid();
}

function assertSafeNonNegativeInteger(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) invalid();
}

function assertHexSha256(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) invalid();
}

function assertNumericRecord(
  value: unknown,
): asserts value is Record<string, number> {
  if (!isRecord(value)) invalid();
  for (const [key, number] of Object.entries(value)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key)) invalid();
    assertSafeNonNegativeInteger(number);
  }
}

function assertSums(value: unknown): asserts value is BackupSums {
  if (!isRecord(value)) invalid();
  assertExactKeys(value, [
    "byDataMode",
    "auditLogCount",
    "auditLogWithUserCount",
  ]);
  assertSafeNonNegativeInteger(value.auditLogCount);
  assertSafeNonNegativeInteger(value.auditLogWithUserCount);
  if (!isRecord(value.byDataMode)) invalid();
  for (const [dataMode, sums] of Object.entries(value.byDataMode)) {
    if (!/^[A-Z_]{1,32}$/.test(dataMode) || !isRecord(sums)) invalid();
    const legacyKeys = ["orderTotalAmount", "paymentAmount", "voucherCount"];
    const currentKeys = [
      ...legacyKeys,
      "valueVoucherBalance",
      "valueVoucherMovementBalance",
      "valueVoucherCount",
    ];
    const keys = Object.keys(sums);
    if (
      keys.length === legacyKeys.length &&
      keys.every((key) => legacyKeys.includes(key))
    ) {
      // Native V1-Manifeste bleiben einspielbar. Nach der Migration existieren
      // die neuen Tabellen leer; die Normalisierung macht den spaeteren
      // Soll/Ist-Vergleich mit diesen Nullwerten deterministisch.
      sums.valueVoucherBalance = 0;
      sums.valueVoucherMovementBalance = 0;
      sums.valueVoucherCount = {};
    } else {
      assertExactKeys(sums, currentKeys);
    }
    assertSafeNonNegativeInteger(sums.orderTotalAmount);
    assertNumericRecord(sums.paymentAmount);
    assertNumericRecord(sums.voucherCount);
    assertSafeNonNegativeInteger(sums.valueVoucherBalance);
    assertSafeNonNegativeInteger(sums.valueVoucherMovementBalance);
    assertNumericRecord(sums.valueVoucherCount);
  }
}

export function calculateSchemaFingerprint(
  migrations: BackupMigration[],
): string {
  const ordered = [...migrations].sort((a, b) =>
    a.name.localeCompare(b.name, "en"),
  );
  return createHash("sha256")
    .update(
      JSON.stringify(
        ordered.map((migration) => [migration.name, migration.checksum]),
      ),
    )
    .digest("hex");
}

export function serializeBackupManifest(manifest: BackupManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function parseBackupManifest(content: string): BackupManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    invalid();
  }
  if (!isRecord(raw)) invalid();
  assertExactKeys(raw, ROOT_KEYS);

  if (
    raw.kind !== BACKUP_MANIFEST_KIND ||
    raw.manifestVersion !== BACKUP_MANIFEST_VERSION ||
    !BACKUP_TRIGGERS.includes(raw.trigger as BackupTrigger)
  ) {
    invalid();
  }
  assertIsoDate(raw.createdAt);
  assertText(raw.appVersion, 100);
  assertText(raw.databaseName, 128);
  assertSafeNonNegativeInteger(raw.serverVersionNum);
  assertText(raw.dumpToolVersion, 200);
  assertText(raw.dumpFile, 255);
  if (!/^vereinorder_[A-Za-z0-9._-]+\.dump$/.test(raw.dumpFile)) invalid();
  assertSafeNonNegativeInteger(raw.dumpSizeBytes);
  assertHexSha256(raw.dumpSha256);
  assertHexSha256(raw.schemaFingerprint);
  assertNumericRecord(raw.countsBefore);
  assertNumericRecord(raw.countsAfter);
  assertSums(raw.sumsBefore);
  assertSums(raw.sumsAfter);

  if (raw.createdBy !== null) {
    if (!isRecord(raw.createdBy)) invalid();
    assertExactKeys(raw.createdBy, ["userId", "username"]);
    assertText(raw.createdBy.userId, 128);
    assertText(raw.createdBy.username, 64);
  }

  if (!Array.isArray(raw.migrations) || raw.migrations.length > 10_000)
    invalid();
  const migrations = raw.migrations.map((migration) => {
    if (!isRecord(migration)) invalid();
    assertExactKeys(migration, ["name", "checksum"]);
    assertText(migration.name, 255);
    assertText(migration.checksum, 255);
    return { name: migration.name, checksum: migration.checksum };
  });
  const sortedNames = migrations.map((migration) => migration.name);
  if (
    new Set(sortedNames).size !== sortedNames.length ||
    sortedNames.some(
      (name, index) =>
        index > 0 && name.localeCompare(sortedNames[index - 1], "en") < 0,
    ) ||
    calculateSchemaFingerprint(migrations) !== raw.schemaFingerprint
  ) {
    invalid();
  }

  if (!isRecord(raw.verification)) invalid();
  assertExactKeys(raw.verification, ["structure", "restoration"]);
  if (!isRecord(raw.verification.structure)) invalid();
  if (raw.verification.structure.status === "PASSED") {
    assertExactKeys(raw.verification.structure, [
      "status",
      "checkedAt",
      "restoreToolVersion",
      "observedSizeBytes",
      "observedMtimeMs",
    ]);
    assertIsoDate(raw.verification.structure.checkedAt);
    assertText(raw.verification.structure.restoreToolVersion, 200);
    assertSafeNonNegativeInteger(raw.verification.structure.observedSizeBytes);
    assertSafeNonNegativeInteger(raw.verification.structure.observedMtimeMs);
  } else if (raw.verification.structure.status === "FAILED") {
    assertExactKeys(raw.verification.structure, [
      "status",
      "checkedAt",
      "errorCode",
    ]);
    assertIsoDate(raw.verification.structure.checkedAt);
    assertText(raw.verification.structure.errorCode, 100);
  } else {
    invalid();
  }

  if (!isRecord(raw.verification.restoration)) invalid();
  if (raw.verification.restoration.status === "NOT_RUN") {
    assertExactKeys(raw.verification.restoration, ["status"]);
  } else if (
    raw.verification.restoration.status === "PASSED" ||
    raw.verification.restoration.status === "FAILED"
  ) {
    assertExactKeys(raw.verification.restoration, ["status", "checkedAt"]);
    assertIsoDate(raw.verification.restoration.checkedAt);
  } else {
    invalid();
  }

  return raw as unknown as BackupManifest;
}
