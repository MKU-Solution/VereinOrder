import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { PrismaClient } from "@vereinorder/database";
import { AuditService } from "../src/audit/audit.service";
import { buildPostgreSqlConnectionEnvironment } from "../src/backup/postgresql-backup.tools";
import { ValueVouchersService } from "../src/value-vouchers/value-vouchers.service";
import { assertTestDatabaseUrl } from "./test-database";

const DATABASE = "vereinorder_ci_test_value_voucher_concurrency";
const TEST_CONFIRMATION = "VEREINORDER_TEST_ONLY";
const REPOSITORY_ROOT = path.resolve(__dirname, "..", "..", "..");

/**
 * Dieser Test erzeugt seine Datenbank selbst, statt den gemeinsamen Bestand zu
 * leeren. Er beweist die geldwerte Nebenläufigkeitsgrenze mit zwei getrennten
 * serialisierbaren Einlösungen und entfernt die Datenbank danach wieder.
 */
describe("Wertgutschein – PostgreSQL-Nebenläufigkeit (#139)", () => {
  const controlUrl = process.env.DATABASE_URL;
  const targetUrl = createTargetUrl(controlUrl);
  const target = assertTestDatabaseUrl(targetUrl, TEST_CONFIRMATION);
  let prisma: PrismaClient;
  let fixture: {
    userId: string;
    eventId: string;
    sessionId: string;
    printerId: string;
    productId: string;
  };

  beforeAll(async () => {
    expect(target.database).toBe(DATABASE);
    await dropTargetDatabase();
    await runPsql("postgres", [
      `CREATE DATABASE "${DATABASE}" TEMPLATE template0`,
    ]);
    await runPrismaMigrateDeploy();
    prisma = new PrismaClient({ datasources: { db: { url: targetUrl } } });
    await prisma.$connect();
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect().catch(() => undefined);
    await dropTargetDatabase();
    const leftovers = await runPsql("postgres", [
      "SELECT datname FROM pg_database WHERE datname LIKE 'vereinorder_ci_test_%' ORDER BY datname",
    ]);
    expect(leftovers.split(/\r?\n/).filter(Boolean)).toEqual([]);
  }, 120_000);

  it("entwertet bei zwei parallelen Bestellungen nie mehr als Guthaben oder Forderung", async () => {
    const suffix = randomUUID();
    const user = await prisma.user.create({
      data: {
        username: `voucher-concurrency-${suffix}`,
        pinHash: "test",
        role: "CASHIER",
      },
    });
    const event = await prisma.event.create({
      data: {
        name: `Voucher concurrency ${suffix}`,
        status: "TEST_MODE",
        testMode: true,
      },
    });
    const session = await prisma.cashierSession.create({
      data: {
        userId: user.id,
        eventId: event.id,
        dataMode: "TEST",
        startingBalance: 0,
      },
    });
    const printer = await prisma.printer.create({
      data: {
        name: `Voucher printer ${suffix}`,
        type: "CONSOLE",
        isActive: true,
      },
    });
    const category = await prisma.productCategory.create({
      data: { name: `Voucher category ${suffix}`, eventId: event.id },
    });
    const product = await prisma.product.create({
      data: {
        name: `Voucher product ${suffix}`,
        price: 1_000,
        eventId: event.id,
        categoryId: category.id,
      },
    });
    fixture = {
      userId: user.id,
      eventId: event.id,
      sessionId: session.id,
      printerId: printer.id,
      productId: product.id,
    };
    const [firstOrder, secondOrder] = await Promise.all(
      [1, 2].map(() =>
        prisma.order.create({
          data: {
            eventId: event.id,
            dataMode: "TEST",
            userId: user.id,
            totalAmount: 1_000,
            items: {
              create: {
                productId: product.id,
                quantity: 1,
                paidQuantity: 0,
                priceAtTime: 1_000,
                depositAtTime: 0,
              },
            },
          },
        }),
      ),
    );
    const service = new ValueVouchersService(prisma, new AuditService(prisma));
    const issued = await service.issue(user.id, "CASHIER", {
      eventId: event.id,
      cashierSessionId: session.id,
      printerId: printer.id,
      amount: 1_000,
      fundingMethod: "CARD",
      idempotencyKey: `issue-${suffix}`,
    });

    const results = await Promise.allSettled(
      [firstOrder, secondOrder].map((order, index) =>
        service.redeem(user.id, "CASHIER", {
          eventId: event.id,
          cashierSessionId: session.id,
          printerId: printer.id,
          orderId: order.id,
          code: issued.voucherCode,
          idempotencyKey: `redeem-${index}-${suffix}`,
        }),
      ),
    );

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    const voucher = await prisma.valueVoucher.findUniqueOrThrow({
      where: { code: issued.voucherCode },
      include: { movements: { orderBy: { createdAt: "asc" } } },
    });
    const payments = await prisma.payment.findMany({
      where: { orderId: { in: [firstOrder.id, secondOrder.id] } },
    });
    const audits = await prisma.auditLog.findMany({
      where: { entityId: voucher.id, action: "VALUE_VOUCHER_REDEEMED" },
    });

    expect(voucher).toMatchObject({
      currentBalance: 0,
      status: "DEPLETED",
      version: 1,
    });
    expect(voucher.movements).toEqual([
      expect.objectContaining({
        type: "ISSUE",
        balanceBefore: 0,
        balanceAfter: 1_000,
      }),
      expect.objectContaining({
        type: "REDEEM",
        balanceBefore: 1_000,
        balanceDelta: -1_000,
        balanceAfter: 0,
      }),
    ]);
    expect(payments).toEqual([
      expect.objectContaining({
        method: "VOUCHER",
        amount: 1_000,
        status: "COMPLETED",
      }),
    ]);
    expect(audits).toHaveLength(1);
    const orders = await prisma.order.findMany({
      where: { id: { in: [firstOrder.id, secondOrder.id] } },
      select: { paymentStatus: true },
    });
    expect(orders.map((order) => order.paymentStatus).sort()).toEqual([
      "OPEN",
      "PAID",
    ]);
  }, 60_000);

  it("rollt Gutschein, Zahlung, Bewegung und Audit bei einem Fehler vollständig zurück", async () => {
    const order = await prisma.order.create({
      data: {
        eventId: fixture.eventId,
        dataMode: "TEST",
        userId: fixture.userId,
        totalAmount: 500,
        items: {
          create: {
            productId: fixture.productId,
            quantity: 1,
            paidQuantity: 0,
            priceAtTime: 500,
            depositAtTime: 0,
          },
        },
      },
    });
    const issuingService = new ValueVouchersService(
      prisma,
      new AuditService(prisma),
    );
    const issued = await issuingService.issue(fixture.userId, "CASHIER", {
      eventId: fixture.eventId,
      cashierSessionId: fixture.sessionId,
      printerId: fixture.printerId,
      amount: 500,
      fundingMethod: "CARD",
      idempotencyKey: `rollback-issue-${randomUUID()}`,
    });
    const issuedVoucher = await prisma.valueVoucher.findUniqueOrThrow({
      where: { code: issued.voucherCode },
    });
    const failingService = new ValueVouchersService(prisma, {
      log: async () => {
        throw new Error("audit-write-failed");
      },
    } as any);

    await expect(
      failingService.redeem(fixture.userId, "CASHIER", {
        eventId: fixture.eventId,
        cashierSessionId: fixture.sessionId,
        printerId: fixture.printerId,
        orderId: order.id,
        code: issued.voucherCode,
        idempotencyKey: `rollback-redeem-${randomUUID()}`,
      }),
    ).rejects.toThrow("audit-write-failed");

    await expect(
      prisma.valueVoucher.findUniqueOrThrow({
        where: { code: issued.voucherCode },
        include: { movements: true },
      }),
    ).resolves.toMatchObject({
      currentBalance: 500,
      status: "ACTIVE",
      movements: [expect.objectContaining({ type: "ISSUE" })],
    });
    await expect(
      prisma.payment.count({ where: { orderId: order.id } }),
    ).resolves.toBe(0);
    await expect(
      prisma.auditLog.count({
        where: {
          action: "VALUE_VOUCHER_REDEEMED",
          entityId: issuedVoucher.id,
        },
      }),
    ).resolves.toBe(0);
  }, 60_000);

  async function dropTargetDatabase() {
    await runPsql("postgres", [
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DATABASE}' AND pid <> pg_backend_pid()`,
      `DROP DATABASE IF EXISTS "${DATABASE}"`,
    ]);
  }

  async function runPrismaMigrateDeploy() {
    const executable = path.join(
      REPOSITORY_ROOT,
      "node_modules",
      ".pnpm",
      "prisma@5.22.0",
      "node_modules",
      "prisma",
      "build",
      "index.js",
    );
    if (!fs.existsSync(executable)) {
      throw new Error(
        "Lokales Prisma-Binary für den Nebenläufigkeitstest fehlt.",
      );
    }
    await run(
      process.execPath,
      [
        executable,
        "migrate",
        "deploy",
        "--schema",
        path.join(
          REPOSITORY_ROOT,
          "packages",
          "database",
          "prisma",
          "schema.prisma",
        ),
      ],
      { ...process.env, DATABASE_URL: targetUrl },
    );
  }

  async function runPsql(database: string, commands: string[]) {
    const connection = buildPostgreSqlConnectionEnvironment(controlUrl!);
    const executable =
      process.platform === "win32" &&
      fs.existsSync("C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe")
        ? "C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe"
        : "psql";
    return run(
      executable,
      [
        "--no-psqlrc",
        "--set=ON_ERROR_STOP=1",
        "--tuples-only",
        "--no-align",
        ...commands.map((command) => `--command=${command}`),
      ],
      { ...connection.environment, PGDATABASE: database },
    );
  }
});

function createTargetUrl(controlUrl: string | undefined): string {
  if (!controlUrl)
    throw new Error("DATABASE_URL fehlt für den PostgreSQL-Wächtertest.");
  const target = new URL(controlUrl);
  target.pathname = `/${DATABASE}`;
  return target.toString();
}

function run(
  executable: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: REPOSITORY_ROOT,
      env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `${path.basename(executable)} endete mit ${code}: ${Buffer.concat(stderr).toString("utf8").trim()}`,
          ),
        );
        return;
      }
      resolve(Buffer.concat(stdout).toString("utf8").trim());
    });
  });
}
