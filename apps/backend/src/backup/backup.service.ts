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
      variants,
      extras,
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
      this.prisma.productVariant.findMany(),
      this.prisma.productExtra.findMany(),
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
        variants: variants.length,
        extras: extras.length,
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
        variants,
        extras,
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
      // Clear current operational data (in reverse foreign key order)
      await tx.printJob.deleteMany();
      await tx.payment.deleteMany();
      await tx.orderItem.deleteMany();
      await tx.order.deleteMany();
      await tx.cashierSession.deleteMany();
      await tx.productExtra.deleteMany();
      await tx.productVariant.deleteMany();
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
      if (data.categories?.length)
        await tx.productCategory.createMany({ data: data.categories });
      if (data.products?.length)
        await tx.product.createMany({ data: data.products });
      if (data.variants?.length)
        await tx.productVariant.createMany({ data: data.variants });
      if (data.extras?.length)
        await tx.productExtra.createMany({ data: data.extras });
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
