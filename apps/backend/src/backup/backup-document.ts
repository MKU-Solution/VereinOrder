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
    "deposit",
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
    "deposit",
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
    "depositRefundTotal",
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
    "paidQuantity",
    "priceAtTime",
    "depositAtTime",
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
    "valueVoucherMovementId",
    "sourceKey",
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
  valueVouchers: [
    "id",
    "code",
    "status",
    "initialBalance",
    "currentBalance",
    "version",
    "eventId",
    "dataMode",
    "issuedByUserId",
    "issuedCashierSessionId",
    "issuedAt",
    "updatedAt",
  ],
  valueVoucherMovements: [
    "id",
    "type",
    "balanceDelta",
    "balanceBefore",
    "balanceAfter",
    "voucherId",
    "eventId",
    "dataMode",
    "orderId",
    "paymentId",
    "reversesMovementId",
    "actorUserId",
    "cashierSessionId",
    "fundingMethod",
    "tenderedAmount",
    "changeAmount",
    "reason",
    "idempotencyKey",
    "requestFingerprint",
    "createdAt",
  ],
  valueVoucherAllocations: ["id", "movementId", "orderItemId", "amount"],
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

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
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
  const payments = new Map(
    data.payments
      .filter((row) => typeof row.id === "string")
      .map((row) => [row.id as string, row.orderId]),
  );
  const sessionsByContext = new Map(
    data.sessions
      .filter((row) => typeof row.id === "string")
      .map((row) => [
        row.id as string,
        { eventId: row.eventId, dataMode: row.dataMode },
      ]),
  );
  const ordersByContext = new Map(
    data.orders
      .filter((row) => typeof row.id === "string")
      .map((row) => [
        row.id as string,
        { eventId: row.eventId, dataMode: row.dataMode },
      ]),
  );
  const orderItemsByOrder = new Map(
    data.orderItems
      .filter((row) => typeof row.id === "string")
      .map((row) => [row.id as string, row.orderId]),
  );
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
    ...data.valueVouchers,
    ...data.valueVoucherMovements,
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

  const assertUniqueText = (table: BackupRow[], field: string) => {
    const seen = new Set<string>();
    for (const row of table) {
      const value = row[field];
      if (typeof value !== "string" || value.length === 0 || seen.has(value))
        invalid();
      seen.add(value);
    }
  };
  assertUniqueText(data.valueVouchers, "id");
  assertUniqueText(data.valueVouchers, "code");
  assertUniqueText(data.valueVoucherMovements, "id");
  assertUniqueText(data.valueVoucherMovements, "idempotencyKey");
  assertUniqueText(data.valueVoucherAllocations, "id");

  const valueVouchers = new Map(
    data.valueVouchers.map((row) => [row.id as string, row]),
  );
  const valueVoucherMovements = new Map(
    data.valueVoucherMovements.map((row) => [row.id as string, row]),
  );
  const movementPaymentIds = new Set<string>();

  for (const voucher of data.valueVouchers) {
    const session = sessionsByContext.get(voucher.issuedCashierSessionId);
    if (
      typeof voucher.code !== "string" ||
      voucher.code.length === 0 ||
      voucher.code.length > 40 ||
      !["ACTIVE", "DEPLETED", "CANCELLED"].includes(voucher.status) ||
      (voucher.dataMode !== "TEST" && voucher.dataMode !== "LIVE") ||
      typeof voucher.issuedByUserId !== "string" ||
      !users.has(voucher.issuedByUserId) ||
      !session ||
      session.eventId !== voucher.eventId ||
      session.dataMode !== voucher.dataMode ||
      !Number.isInteger(voucher.initialBalance) ||
      voucher.initialBalance <= 0 ||
      !Number.isInteger(voucher.currentBalance) ||
      voucher.currentBalance < 0 ||
      voucher.currentBalance > voucher.initialBalance ||
      !Number.isInteger(voucher.version) ||
      voucher.version < 0 ||
      !isIsoDate(voucher.issuedAt) ||
      !isIsoDate(voucher.updatedAt) ||
      (voucher.status === "ACTIVE" && voucher.currentBalance === 0) ||
      ((voucher.status === "DEPLETED" || voucher.status === "CANCELLED") &&
        voucher.currentBalance !== 0)
    )
      invalid();
  }

  const movementsByVoucher = new Map<string, BackupRow[]>();
  for (const movement of data.valueVoucherMovements) {
    const voucher = valueVouchers.get(movement.voucherId);
    const session = sessionsByContext.get(movement.cashierSessionId);
    const order =
      typeof movement.orderId === "string"
        ? ordersByContext.get(movement.orderId)
        : undefined;
    const reasonPresent =
      typeof movement.reason === "string" && movement.reason.trim().length > 0;
    const cashIssue =
      movement.fundingMethod === "CASH" &&
      Number.isInteger(movement.tenderedAmount) &&
      Number.isInteger(movement.changeAmount) &&
      movement.tenderedAmount >= movement.balanceDelta &&
      movement.changeAmount === movement.tenderedAmount - movement.balanceDelta;
    const cardIssue =
      movement.fundingMethod === "CARD" &&
      movement.tenderedAmount == null &&
      movement.changeAmount == null;
    const noFunding =
      movement.fundingMethod == null &&
      movement.tenderedAmount == null &&
      movement.changeAmount == null;
    const typeFieldsValid =
      (movement.type === "ISSUE" &&
        movement.balanceDelta > 0 &&
        movement.balanceBefore === 0 &&
        movement.balanceAfter === movement.balanceDelta &&
        movement.orderId == null &&
        movement.paymentId == null &&
        movement.reversesMovementId == null &&
        (cashIssue || cardIssue)) ||
      (movement.type === "REDEEM" &&
        movement.balanceDelta < 0 &&
        typeof movement.orderId === "string" &&
        typeof movement.paymentId === "string" &&
        movement.reversesMovementId == null &&
        noFunding) ||
      (movement.type === "REDEEM_REVERSAL" &&
        movement.balanceDelta > 0 &&
        movement.paymentId == null &&
        typeof movement.reversesMovementId === "string" &&
        reasonPresent &&
        noFunding) ||
      (movement.type === "CANCEL" &&
        movement.balanceDelta < 0 &&
        movement.balanceAfter === 0 &&
        movement.orderId == null &&
        movement.paymentId == null &&
        movement.reversesMovementId == null &&
        reasonPresent &&
        noFunding);
    if (
      !voucher ||
      voucher.eventId !== movement.eventId ||
      voucher.dataMode !== movement.dataMode ||
      typeof movement.actorUserId !== "string" ||
      !users.has(movement.actorUserId) ||
      !session ||
      session.eventId !== movement.eventId ||
      session.dataMode !== movement.dataMode ||
      (typeof movement.orderId === "string" &&
        (!order ||
          order.eventId !== movement.eventId ||
          order.dataMode !== movement.dataMode)) ||
      (typeof movement.paymentId === "string" &&
        payments.get(movement.paymentId) !== movement.orderId) ||
      (typeof movement.reversesMovementId === "string" &&
        !valueVoucherMovements.has(movement.reversesMovementId)) ||
      !Number.isInteger(movement.balanceBefore) ||
      !Number.isInteger(movement.balanceDelta) ||
      !Number.isInteger(movement.balanceAfter) ||
      movement.balanceBefore < 0 ||
      movement.balanceAfter < 0 ||
      movement.balanceAfter !==
        movement.balanceBefore + movement.balanceDelta ||
      !typeFieldsValid ||
      typeof movement.idempotencyKey !== "string" ||
      movement.idempotencyKey.length === 0 ||
      movement.idempotencyKey.length > 128 ||
      (typeof movement.reason === "string" && movement.reason.length > 500) ||
      typeof movement.requestFingerprint !== "string" ||
      !/^[a-f0-9]{64}$/i.test(movement.requestFingerprint) ||
      !isIsoDate(movement.createdAt)
    )
      invalid();
    if (typeof movement.paymentId === "string") {
      if (movementPaymentIds.has(movement.paymentId)) invalid();
      movementPaymentIds.add(movement.paymentId);
    }
    const list = movementsByVoucher.get(movement.voucherId) ?? [];
    list.push(movement);
    movementsByVoucher.set(movement.voucherId, list);
  }

  for (const voucher of data.valueVouchers) {
    const movements = (movementsByVoucher.get(voucher.id) ?? []).sort((a, b) =>
      `${a.createdAt}\0${a.id}`.localeCompare(`${b.createdAt}\0${b.id}`, "en"),
    );
    if (movements.length === 0 || movements[0].type !== "ISSUE") invalid();
    let balance = 0;
    for (const [index, movement] of movements.entries()) {
      if (
        movement.balanceBefore !== balance ||
        (index > 0 && movement.type === "ISSUE") ||
        (movement.type === "ISSUE" &&
          movement.balanceAfter !== voucher.initialBalance)
      )
        invalid();
      if (typeof movement.reversesMovementId === "string") {
        const reversed = valueVoucherMovements.get(movement.reversesMovementId);
        if (
          !reversed ||
          reversed.voucherId !== voucher.id ||
          reversed.type !== "REDEEM" ||
          movements.indexOf(reversed) >= index
        )
          invalid();
      }
      balance = movement.balanceAfter;
    }
    const expectedStatus =
      movements[movements.length - 1].type === "CANCEL"
        ? "CANCELLED"
        : balance === 0
          ? "DEPLETED"
          : "ACTIVE";
    if (balance !== voucher.currentBalance || voucher.status !== expectedStatus)
      invalid();
  }

  const allocationKeys = new Set<string>();
  const allocationSums = new Map<string, number>();
  for (const allocation of data.valueVoucherAllocations) {
    const movement = valueVoucherMovements.get(allocation.movementId);
    const orderItemOrderId = orderItemsByOrder.get(allocation.orderItemId);
    const key = `${allocation.movementId}\0${allocation.orderItemId}`;
    if (
      !movement ||
      movement.type !== "REDEEM" ||
      !orderItemOrderId ||
      orderItemOrderId !== movement.orderId ||
      !Number.isInteger(allocation.amount) ||
      allocation.amount <= 0 ||
      allocationKeys.has(key)
    )
      invalid();
    allocationKeys.add(key);
    allocationSums.set(
      allocation.movementId,
      (allocationSums.get(allocation.movementId) ?? 0) + allocation.amount,
    );
  }
  for (const movement of data.valueVoucherMovements) {
    const allocated = allocationSums.get(movement.id) ?? 0;
    if (
      (movement.type === "REDEEM" && allocated !== -movement.balanceDelta) ||
      (movement.type !== "REDEEM" && allocated !== 0)
    )
      invalid();
  }

  for (const printJob of data.printJobs) {
    if (
      typeof printJob.valueVoucherMovementId === "string" &&
      !valueVoucherMovements.has(printJob.valueVoucherMovementId)
    )
      invalid();
  }
  const printSourceKeys = new Set<string>();
  for (const printJob of data.printJobs) {
    if (typeof printJob.sourceKey !== "string") continue;
    if (
      printJob.sourceKey.length === 0 ||
      printJob.sourceKey.length > 128 ||
      printSourceKeys.has(printJob.sourceKey)
    )
      invalid();
    printSourceKeys.add(printJob.sourceKey);
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
    (raw.version !== "0.1.0" && raw.version !== "0.2.0") ||
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
