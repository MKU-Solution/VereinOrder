import { BadRequestException } from "@nestjs/common";

const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;
export const MAX_BACKUP_BYTES = 256 * 1024 * 1024;
const MAX_ROWS_PER_TABLE = 100_000;
const MAX_TOTAL_ROWS = 500_000;

const TABLE_FIELDS = {
  events: [
    "id",
    "name",
    "organizer",
    "location",
    "startTime",
    "endTime",
    "timezone",
    "status",
    "testMode",
    "rksvConfirmedAt",
    "rksvConfirmedByUserId",
    "rksvDisclaimerVersion",
    "createdAt",
    "updatedAt",
  ],
  areas: [
    "id",
    "name",
    "sortOrder",
    "floorPlan",
    "eventId",
    "createdAt",
    "updatedAt",
  ],
  stations: [
    "id",
    "name",
    "shortName",
    "color",
    "sortOrder",
    "isActive",
    "eventId",
    "printerId",
    "createdAt",
    "updatedAt",
  ],
  categories: [
    "id",
    "name",
    "sortOrder",
    "eventId",
    "targetStationId",
    "createdAt",
    "updatedAt",
  ],
  products: [
    "id",
    "name",
    "shortName",
    "description",
    "price",
    "taxRate",
    "color",
    "sortOrder",
    "imageUrl",
    "availability",
    "categoryId",
    "targetStationId",
    "eventId",
    "createdAt",
    "updatedAt",
  ],
  optionGroups: [
    "id",
    "name",
    "selectionType",
    "isRequired",
    "minSelect",
    "maxSelect",
    "priceMode",
    "quickSaleTiles",
    "sortOrder",
    "productId",
  ],
  options: ["id", "name", "priceEffect", "isActive", "sortOrder", "groupId"],
  users: [
    "id",
    "username",
    "pinHash",
    "role",
    "isActive",
    "createdAt",
    "updatedAt",
  ],
  orders: [
    "id",
    "orderNumber",
    "totalAmount",
    "lifecycleStatus",
    "paymentStatus",
    "fulfillmentStatus",
    "isPriority",
    "idempotencyKey",
    "tableName",
    "areaId",
    "userId",
    "claimedByUserId",
    "claimedAt",
    "eventId",
    "dataMode",
    "createdAt",
    "updatedAt",
    "cashierSessionId",
    "pickupNumber",
    "stationId",
  ],
  orderItems: [
    "id",
    "quantity",
    "priceAtTime",
    "status",
    "variantId",
    "variantName",
    "extras",
    "orderId",
    "productId",
    "createdAt",
    "updatedAt",
  ],
  payments: [
    "id",
    "amount",
    "tenderedAmount",
    "changeAmount",
    "method",
    "status",
    "orderId",
    "cashierSessionId",
    "createdAt",
    "updatedAt",
  ],
  sessions: [
    "id",
    "startingBalance",
    "closingBalance",
    "status",
    "startTime",
    "endTime",
    "userId",
    "eventId",
    "dataMode",
  ],
  printers: [
    "id",
    "name",
    "type",
    "ipAddress",
    "port",
    "isActive",
    "paperWidth",
    "codepage",
    "cutMode",
    "copies",
    "timeoutMs",
    "queueName",
    "fallbackPrinterId",
    "lastErrorCode",
    "lastErrorAt",
    "lastOkAt",
    "createdAt",
    "updatedAt",
  ],
  printJobs: [
    "id",
    "printerId",
    "jobType",
    "content",
    "status",
    "orderId",
    "errorMessage",
    "attemptPhase",
    "leaseId",
    "leaseExpiresAt",
    "lastHeartbeatAt",
    "attemptCount",
    "activePrinterId",
    "failoverCount",
    "failoverAt",
    "failoverReason",
    "failoverFromPrinterId",
    "outcomeClass",
    "errorCode",
    "deliveredAt",
    "unresolvedAt",
    "unresolvedReason",
    "resolvedAt",
    "resolvedByUserId",
    "resolution",
    "cupsJobId",
    "cupsJobState",
    "bytesWritten",
    "createdAt",
    "updatedAt",
  ],
  auditLogs: [
    "id",
    "action",
    "entityId",
    "entityType",
    "userId",
    "details",
    "createdAt",
  ],
  vouchers: [
    "id",
    "code",
    "status",
    "eventId",
    "productId",
    "orderId",
    "orderItemId",
    "issuedByUserId",
    "cashierSessionId",
    "issuedAt",
    "redeemedAt",
    "redeemedAtStationId",
  ],
} as const;

type TableName = keyof typeof TABLE_FIELDS;
// Erst nach erfolgreicher Prüfung wird der dynamische JSON-Datensatz an die
// tabellenspezifischen Prisma-createMany-Aufrufe übergeben.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BackupRow = Record<string, any>;

export interface ValidatedBackupDocument {
  version: string;
  timestamp?: string;
  database?: string;
  createdBy?: string;
  counts?: Partial<Record<TableName, number>>;
  data: Record<TableName, BackupRow[]>;
}

function invalid(): never {
  throw new BadRequestException(
    "Ungültiges oder beschädigtes Backup-Dateiformat.",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertAllowedKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
) {
  const allowedSet = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedSet.has(key))) invalid();
}

function validateReferences(data: Record<TableName, BackupRow[]>) {
  const ids = (table: TableName) =>
    new Set(
      data[table]
        .map((row) => row.id)
        .filter((id): id is string => typeof id === "string"),
    );
  const events = ids("events");
  const printers = ids("printers");
  const users = ids("users");
  const products = ids("products");
  const orders = ids("orders");
  const orderItems = ids("orderItems");
  const sessions = ids("sessions");
  const optionGroups = ids("optionGroups");
  const areas = new Map(
    data.areas
      .filter((row) => typeof row.id === "string")
      .map((row) => [row.id as string, row.eventId]),
  );
  const stations = new Map(
    data.stations
      .filter((row) => typeof row.id === "string")
      .map((row) => [row.id as string, row.eventId]),
  );
  const categories = new Map(
    data.categories
      .filter((row) => typeof row.id === "string")
      .map((row) => [row.id as string, row.eventId]),
  );

  for (const row of [
    ...data.areas,
    ...data.stations,
    ...data.categories,
    ...data.products,
    ...data.sessions,
    ...data.orders,
    ...data.vouchers,
  ]) {
    if (typeof row.eventId === "string" && !events.has(row.eventId)) invalid();
  }
  for (const row of data.stations) {
    if (typeof row.printerId === "string" && !printers.has(row.printerId))
      invalid();
  }
  for (const row of data.categories) {
    if (
      typeof row.targetStationId === "string" &&
      stations.get(row.targetStationId) !== row.eventId
    )
      invalid();
  }
  for (const row of data.products) {
    if (
      typeof row.categoryId === "string" &&
      categories.get(row.categoryId) !== row.eventId
    )
      invalid();
    if (
      typeof row.targetStationId === "string" &&
      stations.get(row.targetStationId) !== row.eventId
    )
      invalid();
  }
  for (const row of data.optionGroups) {
    if (typeof row.productId === "string" && !products.has(row.productId))
      invalid();
  }
  for (const row of data.options) {
    if (typeof row.groupId === "string" && !optionGroups.has(row.groupId))
      invalid();
  }
  for (const row of data.sessions) {
    if (typeof row.userId === "string" && !users.has(row.userId)) invalid();
  }
  for (const row of data.orders) {
    if (typeof row.userId === "string" && !users.has(row.userId)) invalid();
    if (typeof row.areaId === "string" && areas.get(row.areaId) !== row.eventId)
      invalid();
    if (
      typeof row.stationId === "string" &&
      stations.get(row.stationId) !== row.eventId
    )
      invalid();
    if (
      typeof row.cashierSessionId === "string" &&
      !sessions.has(row.cashierSessionId)
    )
      invalid();
  }
  for (const row of data.orderItems) {
    if (typeof row.orderId === "string" && !orders.has(row.orderId)) invalid();
    if (typeof row.productId === "string" && !products.has(row.productId))
      invalid();
  }
  for (const row of data.payments) {
    if (typeof row.orderId === "string" && !orders.has(row.orderId)) invalid();
    if (
      typeof row.cashierSessionId === "string" &&
      !sessions.has(row.cashierSessionId)
    )
      invalid();
  }
  for (const row of data.vouchers) {
    if (typeof row.productId === "string" && !products.has(row.productId))
      invalid();
    if (typeof row.orderId === "string" && !orders.has(row.orderId)) invalid();
    if (typeof row.orderItemId === "string" && !orderItems.has(row.orderItemId))
      invalid();
  }
}

export function parseBackupDocument(content: string): ValidatedBackupDocument {
  if (Buffer.byteLength(content, "utf8") > MAX_BACKUP_BYTES) invalid();
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    invalid();
  }
  if (!isRecord(raw)) invalid();
  assertAllowedKeys(raw, [
    "version",
    "timestamp",
    "database",
    "createdBy",
    "counts",
    "data",
  ]);
  if (
    typeof raw.version !== "string" ||
    raw.version !== "0.1.0" ||
    !isRecord(raw.data)
  )
    invalid();
  if (raw.counts !== undefined) {
    if (!isRecord(raw.counts)) invalid();
    assertAllowedKeys(raw.counts, Object.keys(TABLE_FIELDS));
    for (const value of Object.values(raw.counts)) {
      if (
        !Number.isInteger(value) ||
        (value as number) < 0 ||
        (value as number) > MAX_ROWS_PER_TABLE
      )
        invalid();
    }
  }
  assertAllowedKeys(raw.data, Object.keys(TABLE_FIELDS));

  const data = {} as Record<TableName, BackupRow[]>;
  let totalRows = 0;
  for (const table of Object.keys(TABLE_FIELDS) as TableName[]) {
    const rows = raw.data[table] ?? [];
    if (!Array.isArray(rows) || rows.length > MAX_ROWS_PER_TABLE) invalid();
    totalRows += rows.length;
    if (totalRows > MAX_TOTAL_ROWS) invalid();
    data[table] = rows.map((row) => {
      if (!isRecord(row)) invalid();
      assertAllowedKeys(row, TABLE_FIELDS[table]);
      for (const [key, value] of Object.entries(row)) {
        if (
          key === "content" ||
          key === "details" ||
          key === "extras" ||
          value == null
        )
          continue;
        if (
          typeof value === "number" &&
          (!Number.isInteger(value) || value < INT32_MIN || value > INT32_MAX)
        )
          invalid();
      }
      return row;
    });
  }
  validateReferences(data);
  return {
    version: raw.version,
    timestamp: typeof raw.timestamp === "string" ? raw.timestamp : undefined,
    database: typeof raw.database === "string" ? raw.database : undefined,
    createdBy: typeof raw.createdBy === "string" ? raw.createdBy : undefined,
    counts: raw.counts as Partial<Record<TableName, number>> | undefined,
    data,
  };
}
