import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ConflictException } from "@nestjs/common";
import { BackupService } from "./backup.service";

// Legacy-Wiederherstellung ist ausschließlich im gesperrten Wartungsmodus
// zulässig. Die Attrappe bildet genau diese serverseitige Vorbedingung ab.
function makeMaintenanceStateStub() {
  return { read: jest.fn(() => ({ phase: "LOCKED" })) } as any;
}

function createPrisma() {
  const tx = {
    printJob: { deleteMany: jest.fn(), createMany: jest.fn() },
    payment: { deleteMany: jest.fn(), createMany: jest.fn() },
    orderItem: { deleteMany: jest.fn(), createMany: jest.fn() },
    order: { deleteMany: jest.fn(), createMany: jest.fn() },
    cashierSession: { deleteMany: jest.fn(), createMany: jest.fn() },
    productOption: { deleteMany: jest.fn(), createMany: jest.fn() },
    productOptionGroup: { deleteMany: jest.fn(), createMany: jest.fn() },
    product: { deleteMany: jest.fn(), createMany: jest.fn() },
    productCategory: { deleteMany: jest.fn(), createMany: jest.fn() },
    station: { deleteMany: jest.fn(), createMany: jest.fn() },
    area: { deleteMany: jest.fn(), createMany: jest.fn() },
    printer: { deleteMany: jest.fn(), createMany: jest.fn() },
    event: { deleteMany: jest.fn(), createMany: jest.fn() },
    user: { deleteMany: jest.fn(), createMany: jest.fn() },
    // Issue #103: ProductVoucher wird jetzt explizit geleert und
    // wiedereingespielt (B5/#100), auditLog vollstaendig ersetzt (B3/B7).
    productVoucher: { deleteMany: jest.fn(), createMany: jest.fn() },
    auditLog: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
      create: jest.fn(),
    },
    $executeRaw: jest.fn(),
  };
  Object.entries(tx).forEach(([key, entity]) => {
    if (key === "$executeRaw") return;
    Object.values(entity).forEach((fn) => fn.mockResolvedValue({ count: 0 }));
  });
  tx.$executeRaw.mockResolvedValue(0);
  const emptyFindMany = () => jest.fn().mockResolvedValue([]);
  const prisma = {
    ...tx,
    event: { ...tx.event, findMany: emptyFindMany() },
    area: { ...tx.area, findMany: emptyFindMany() },
    station: { ...tx.station, findMany: emptyFindMany() },
    productCategory: { ...tx.productCategory, findMany: emptyFindMany() },
    product: { ...tx.product, findMany: emptyFindMany() },
    productOptionGroup: {
      ...tx.productOptionGroup,
      findMany: emptyFindMany(),
    },
    productOption: { ...tx.productOption, findMany: emptyFindMany() },
    // findUnique wird nach der Transaktion aufgerufen, um zu pruefen, ob der
    // handelnde Administrator in der wiederhergestellten Datenbank existiert
    // (B8). In diesen Tests existiert er standardmaessig nicht.
    user: {
      ...tx.user,
      findMany: emptyFindMany(),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    order: { ...tx.order, findMany: emptyFindMany() },
    orderItem: { ...tx.orderItem, findMany: emptyFindMany() },
    payment: { ...tx.payment, findMany: emptyFindMany() },
    cashierSession: { ...tx.cashierSession, findMany: emptyFindMany() },
    printer: { ...tx.printer, findMany: emptyFindMany() },
    printJob: { ...tx.printJob, findMany: emptyFindMany() },
    auditLog: { ...tx.auditLog, findMany: emptyFindMany() },
    productVoucher: { ...tx.productVoucher, findMany: emptyFindMany() },
    $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };
  return { prisma, tx };
}

describe("BackupService – Wiederherstellung nach Issue #84", () => {
  let tempDir: string;
  let previousBackupDir: string | undefined;

  beforeEach(() => {
    previousBackupDir = process.env.BACKUP_DIR;
    tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "vereinorder-backup-spec-"),
    );
    process.env.BACKUP_DIR = tempDir;
  });

  afterEach(() => {
    if (previousBackupDir === undefined) delete process.env.BACKUP_DIR;
    else process.env.BACKUP_DIR = previousBackupDir;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("verweigert den Legacy-Restore vor jedem Dateizugriff, solange der Wartungsmodus offen ist", async () => {
    const { prisma, tx } = createPrisma();
    const service = new BackupService(
      prisma as any,
      { read: jest.fn(() => ({ phase: "OPEN" })) } as any,
    );

    await expect(
      service.restoreBackup("nicht-vorhanden.json", "admin-1"),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.auditLog.deleteMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("ordnet einem kategorielosen Produkt aus einer Sicherung von vor Issue #84 dieselbe Auffangkategorie zu wie Migration und Vorlagenimport", async () => {
    const { prisma, tx } = createPrisma();
    const service = new BackupService(
      prisma as any,
      makeMaintenanceStateStub(),
    );

    const legacyBackup = {
      version: "0.1.0",
      timestamp: new Date().toISOString(),
      database: "postgresql",
      createdBy: "SYSTEM_CRON",
      counts: {},
      data: {
        events: [{ id: "event-legacy", name: "Altfest" }],
        areas: [],
        stations: [],
        // Eine bereits bestehende Kategorie, aber ohne Namenskollision mit
        // der Auffangkategorie.
        categories: [
          {
            id: "category-existing",
            name: "Getränke",
            sortOrder: 0,
            eventId: "event-legacy",
            targetStationId: null,
          },
        ],
        // Produkt ohne "categoryId" — kann nur aus der Zeit vor Issue #84
        // stammen, "categoryId" ist seither Pflicht.
        products: [
          {
            id: "product-legacy",
            name: "Wurstsemmel",
            eventId: "event-legacy",
            categoryId: null,
            targetStationId: null,
            price: 300,
            taxRate: 1000,
            sortOrder: 0,
            availability: "AVAILABLE",
          },
        ],
        optionGroups: [],
        options: [],
        users: [],
        orders: [],
        orderItems: [],
        payments: [],
        sessions: [],
        printers: [],
        printJobs: [],
        auditLogs: [],
      },
    };
    fs.writeFileSync(
      path.join(tempDir, "legacy-backup.json"),
      JSON.stringify(legacyBackup),
      "utf-8",
    );

    await service.restoreBackup("legacy-backup.json", "admin-1");

    expect(tx.productCategory.createMany).toHaveBeenCalledTimes(1);
    const categoriesWritten = tx.productCategory.createMany.mock.calls[0][0]
      .data as any[];
    expect(categoriesWritten).toHaveLength(2);
    const fallback = categoriesWritten.find(
      (c) => c.eventId === "event-legacy" && c.name === "Sonstige Artikel",
    );
    expect(fallback).toBeDefined();
    // Angehängt ans Ende der bestehenden Sortierung (0), dieselbe Regel wie
    // die SQL-Migration und der Vorlagenimport.
    expect(fallback.sortOrder).toBe(1);
    expect(fallback.targetStationId).toBeNull();

    expect(tx.product.createMany).toHaveBeenCalledTimes(1);
    const productsWritten = tx.product.createMany.mock.calls[0][0]
      .data as any[];
    const restoredProduct = productsWritten.find(
      (p) => p.id === "product-legacy",
    );
    expect(restoredProduct.categoryId).toBe(fallback.id);
  });

  it("lässt eine Sicherung ohne kategorielose Produkte unverändert", async () => {
    const { prisma, tx } = createPrisma();
    const service = new BackupService(
      prisma as any,
      makeMaintenanceStateStub(),
    );

    const modernBackup = {
      version: "0.1.0",
      timestamp: new Date().toISOString(),
      database: "postgresql",
      createdBy: "SYSTEM_CRON",
      counts: {},
      data: {
        events: [{ id: "event-modern", name: "Neufest" }],
        areas: [],
        stations: [],
        categories: [
          {
            id: "category-a",
            name: "Getränke",
            sortOrder: 0,
            eventId: "event-modern",
            targetStationId: null,
          },
        ],
        products: [
          {
            id: "product-modern",
            name: "Bier",
            eventId: "event-modern",
            categoryId: "category-a",
            targetStationId: null,
            price: 350,
            taxRate: 2000,
            sortOrder: 0,
            availability: "AVAILABLE",
          },
        ],
        optionGroups: [],
        options: [],
        users: [],
        orders: [],
        orderItems: [],
        payments: [],
        sessions: [],
        printers: [],
        printJobs: [],
        auditLogs: [],
      },
    };
    fs.writeFileSync(
      path.join(tempDir, "modern-backup.json"),
      JSON.stringify(modernBackup),
      "utf-8",
    );

    await service.restoreBackup("modern-backup.json", "admin-1");

    const categoriesWritten = tx.productCategory.createMany.mock.calls[0][0]
      .data as any[];
    expect(categoriesWritten).toHaveLength(1);
    expect(categoriesWritten[0].id).toBe("category-a");

    const productsWritten = tx.product.createMany.mock.calls[0][0]
      .data as any[];
    expect(productsWritten).toHaveLength(1);
    expect(productsWritten[0].categoryId).toBe("category-a");
  });
});
