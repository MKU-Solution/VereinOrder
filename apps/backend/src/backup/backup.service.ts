import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  OnModuleInit,
} from "@nestjs/common";
import { PrismaClient } from "@vereinorder/database";
import { PRISMA_CLIENT } from "../prisma/prisma.module";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { planFallbackCategory } from "../common/fallback-category";

export interface BackupMetadata {
  filename: string;
  sizeBytes: number;
  createdAt: string;
  checksumSha256: string;
  version: string;
  counts: Record<string, number>;
}

@Injectable()
export class BackupService implements OnModuleInit {
  private backupDir: string;

  constructor(@Inject(PRISMA_CLIENT) private prisma: PrismaClient) {
    this.backupDir =
      process.env.BACKUP_DIR || path.join(process.cwd(), "backups");
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
  }

  onModuleInit() {
    // Automatic backup every 60 minutes
    const intervalMs = 60 * 60 * 1000;
    setInterval(async () => {
      try {
        const activeEvents = await this.prisma.event.count({
          where: { status: "ACTIVE" },
        });
        if (activeEvents > 0) {
          console.log(
            "[BackupService] Automatisches Stündliches Backup wird erstellt...",
          );
          await this.createBackup("SYSTEM_CRON");
        }
      } catch (err) {
        console.error("[BackupService] Fehler beim automatischen Backup:", err);
      }
    }, intervalMs);
  }

  async createBackup(userId?: string): Promise<BackupMetadata> {
    const timestamp = new Date();
    const dateStr = timestamp.toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `vereinorder_backup_${dateStr}.json`;
    const filePath = path.join(this.backupDir, filename);

    // Fetch all database records
    const [
      events,
      areas,
      stations,
      categories,
      products,
      optionGroups,
      options,
      users,
      orders,
      orderItems,
      payments,
      sessions,
      printers,
      printJobs,
      auditLogs,
    ] = await Promise.all([
      this.prisma.event.findMany(),
      this.prisma.area.findMany(),
      this.prisma.station.findMany(),
      this.prisma.productCategory.findMany(),
      this.prisma.product.findMany(),
      this.prisma.productOptionGroup.findMany(),
      this.prisma.productOption.findMany(),
      this.prisma.user.findMany(),
      this.prisma.order.findMany(),
      this.prisma.orderItem.findMany(),
      this.prisma.payment.findMany(),
      this.prisma.cashierSession.findMany(),
      this.prisma.printer.findMany(),
      this.prisma.printJob.findMany(),
      this.prisma.auditLog.findMany(),
    ]);

    const backupData = {
      version: "0.1.0",
      timestamp: timestamp.toISOString(),
      database: "postgresql",
      createdBy: userId || "ADMINISTRATOR",
      counts: {
        events: events.length,
        areas: areas.length,
        stations: stations.length,
        categories: categories.length,
        products: products.length,
        optionGroups: optionGroups.length,
        options: options.length,
        users: users.length,
        orders: orders.length,
        orderItems: orderItems.length,
        payments: payments.length,
        sessions: sessions.length,
        printers: printers.length,
        printJobs: printJobs.length,
        auditLogs: auditLogs.length,
      },
      data: {
        events,
        areas,
        stations,
        categories,
        products,
        optionGroups,
        options,
        users,
        orders,
        orderItems,
        payments,
        sessions,
        printers,
        printJobs,
        auditLogs,
      },
    };

    const jsonString = JSON.stringify(backupData, null, 2);
    fs.writeFileSync(filePath, jsonString, "utf-8");

    const checksumSha256 = crypto
      .createHash("sha256")
      .update(jsonString)
      .digest("hex");
    const stats = fs.statSync(filePath);

    if (userId && userId !== "SYSTEM_CRON") {
      await this.prisma.auditLog.create({
        data: {
          action: "CREATE_BACKUP",
          entityId: filename,
          entityType: "Backup",
          userId,
          details: {
            filename,
            sizeBytes: stats.size,
            checksumSha256,
          },
        },
      });
    }

    return {
      filename,
      sizeBytes: stats.size,
      createdAt: timestamp.toISOString(),
      checksumSha256,
      version: backupData.version,
      counts: backupData.counts,
    };
  }

  async listBackups(): Promise<BackupMetadata[]> {
    if (!fs.existsSync(this.backupDir)) return [];

    const files = fs
      .readdirSync(this.backupDir)
      .filter((f) => f.endsWith(".json"));
    const list: BackupMetadata[] = [];

    for (const filename of files) {
      const filePath = path.join(this.backupDir, filename);
      try {
        const stats = fs.statSync(filePath);
        const content = fs.readFileSync(filePath, "utf-8");
        const parsed = JSON.parse(content);
        const checksum = crypto
          .createHash("sha256")
          .update(content)
          .digest("hex");

        list.push({
          filename,
          sizeBytes: stats.size,
          createdAt: parsed.timestamp || stats.birthtime.toISOString(),
          checksumSha256: checksum,
          version: parsed.version || "0.1.0",
          counts: parsed.counts || {},
        });
      } catch (err) {
        // Corrupt or non-json file
      }
    }

    return list.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  getBackupFilePath(filename: string): string {
    const safeFilename = path.basename(filename);
    const filePath = path.join(this.backupDir, safeFilename);
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException(
        `Backup-Datei ${safeFilename} nicht gefunden.`,
      );
    }
    return filePath;
  }

  async restoreBackup(filename: string, userId?: string) {
    const filePath = this.getBackupFilePath(filename);
    const content = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(content);

    if (!parsed.data || !parsed.version) {
      throw new BadRequestException(
        "Ungültiges oder beschädigtes Backup-Dateiformat.",
      );
    }

    // 1. Create a safety snapshot before restoring
    await this.createBackup(`PRE_RESTORE_BEFORE_${filename}`);

    const { data } = parsed;

    // 2. Perform restoration in transactional sequence
    return await this.prisma.$transaction(async (tx) => {
      // Clear current operational data (in reverse foreign key order).
      // Issue #84: "Product"."categoryId" -> "ProductCategory"."id" is now
      // ON DELETE RESTRICT (was SetNull), so every product referencing a
      // category must be gone before that category is deleted. "product" is
      // therefore cleared before "productCategory" below; do not reorder
      // these two without checking the FK direction again.
      await tx.printJob.deleteMany();
      await tx.payment.deleteMany();
      await tx.orderItem.deleteMany();
      await tx.order.deleteMany();
      await tx.cashierSession.deleteMany();
      await tx.productOption.deleteMany();
      await tx.productOptionGroup.deleteMany();
      await tx.product.deleteMany();
      await tx.productCategory.deleteMany();
      await tx.station.deleteMany();
      await tx.area.deleteMany();
      await tx.printer.deleteMany();
      await tx.event.deleteMany();
      // Keep users or replace if included
      if (data.users && data.users.length > 0) {
        await tx.user.deleteMany();
        await tx.user.createMany({ data: data.users });
      }

      if (data.events?.length) await tx.event.createMany({ data: data.events });
      if (data.printers?.length)
        await tx.printer.createMany({ data: data.printers });
      if (data.areas?.length) await tx.area.createMany({ data: data.areas });
      if (data.stations?.length)
        await tx.station.createMany({ data: data.stations });
      // Issue #84: categories must be inserted before products, because
      // "Product"."categoryId" is now a required, RESTRICT-guarded foreign
      // key ("productCategory" is created here, before "product", to match).
      //
      // This backup format carries no schema/data version of its own —
      // "version" above is the application version, not a data-shape version
      // like the event template's "schemaVersion". A backup taken before
      // this migration can still contain products with no category at all,
      // which the (now required) "categoryId" column would reject at insert
      // time — a raw database error in the middle of restoring, i.e. exactly
      // when something has already gone wrong. There is no version field to
      // gate a fix on, but the data itself is the discriminator: a product
      // with no "categoryId" can only predate this migration. Such products
      // get the same fallback category as the SQL migration
      // 20260822120000_move_target_station_to_category and the event
      // template importer (events.service.ts) — one rule in
      // ../common/fallback-category.ts for all three.
      const categories: any[] = data.categories ? [...data.categories] : [];
      const products: any[] = data.products ?? [];
      const orphanedByEvent = new Map<string, any[]>();
      for (const product of products) {
        if (!product.categoryId) {
          const list = orphanedByEvent.get(product.eventId) ?? [];
          list.push(product);
          orphanedByEvent.set(product.eventId, list);
        }
      }
      const fallbackCreatedAt = new Date();
      for (const [eventId, orphaned] of orphanedByEvent) {
        const plan = planFallbackCategory(
          categories.filter((c) => c.eventId === eventId),
        );
        const fallbackId = crypto.randomUUID();
        categories.push({
          id: fallbackId,
          name: plan.name,
          sortOrder: plan.sortOrder,
          eventId,
          targetStationId: null,
          createdAt: fallbackCreatedAt,
          updatedAt: fallbackCreatedAt,
        });
        for (const product of orphaned) product.categoryId = fallbackId;
      }
      if (categories.length)
        await tx.productCategory.createMany({ data: categories });
      if (products.length) await tx.product.createMany({ data: products });
      if (data.optionGroups?.length)
        await tx.productOptionGroup.createMany({ data: data.optionGroups });
      if (data.options?.length)
        await tx.productOption.createMany({ data: data.options });
      if (data.sessions?.length)
        await tx.cashierSession.createMany({ data: data.sessions });
      if (data.orders?.length) await tx.order.createMany({ data: data.orders });
      if (data.orderItems?.length)
        await tx.orderItem.createMany({ data: data.orderItems });
      if (data.payments?.length)
        await tx.payment.createMany({ data: data.payments });
      if (data.printJobs?.length)
        await tx.printJob.createMany({ data: data.printJobs });

      if (userId) {
        await tx.auditLog.create({
          data: {
            action: "RESTORE_BACKUP",
            entityId: filename,
            entityType: "Backup",
            userId,
            details: {
              restoredFrom: filename,
              counts: parsed.counts,
            },
          },
        });
      }

      return {
        success: true,
        message: `Backup ${filename} erfolgreich wiederhergestellt!`,
        counts: parsed.counts,
      };
    });
  }
}
