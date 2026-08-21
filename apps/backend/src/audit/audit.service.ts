import { Injectable, Inject } from "@nestjs/common";
import { Prisma, PrismaClient, AuditLog } from "@vereinorder/database";
import { PRISMA_CLIENT } from "../prisma/prisma.module";

export interface AuditQueryDto {
  action?: string;
  entityType?: string;
  userId?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

@Injectable()
export class AuditService {
  constructor(@Inject(PRISMA_CLIENT) private prisma: PrismaClient) {}

  /**
   * Optionaler zweiter Parameter erlaubt anderen Diensten, den Audit-Eintrag
   * in derselben Datenbanktransaktion zu schreiben wie die fachliche
   * Änderung (z. B. Failover-Entscheidungen im Print-Job-Modul). Ohne
   * Angabe wird wie bisher der globale Client verwendet.
   */
  async log(
    data: {
      action: string;
      entityId: string;
      entityType: string;
      userId?: string;
      details?: any;
    },
    client: PrismaClient | Prisma.TransactionClient = this.prisma,
  ): Promise<AuditLog> {
    return client.auditLog.create({
      data: {
        action: data.action,
        entityId: data.entityId,
        entityType: data.entityType,
        userId: data.userId || null,
        details: data.details || null,
      },
    });
  }

  async getLogs(query: AuditQueryDto) {
    const limit = Number(query.limit) || 50;
    const offset = Number(query.offset) || 0;

    const where: any = {};
    if (query.action) where.action = query.action;
    if (query.entityType) where.entityType = query.entityType;
    if (query.userId) where.userId = query.userId;

    if (query.search) {
      where.OR = [
        { action: { contains: query.search, mode: "insensitive" } },
        { entityType: { contains: query.search, mode: "insensitive" } },
        { user: { username: { contains: query.search, mode: "insensitive" } } },
      ];
    }

    const [total, logs] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        include: {
          user: {
            select: { id: true, username: true, role: true },
          },
        },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
    ]);

    return { total, limit, offset, logs };
  }

  async getStats() {
    const now = new Date();
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );

    const [
      totalCount,
      todayCount,
      cancellationsCount,
      priceChangesCount,
      failedLoginsCount,
      rksvConfirmationsCount,
    ] = await Promise.all([
      this.prisma.auditLog.count(),
      this.prisma.auditLog.count({ where: { createdAt: { gte: todayStart } } }),
      this.prisma.auditLog.count({
        where: { action: { in: ["CANCEL_ORDER", "CANCEL_ORDER_ITEM"] } },
      }),
      this.prisma.auditLog.count({ where: { action: "PRICE_CHANGED" } }),
      this.prisma.auditLog.count({ where: { action: "FAILED_LOGIN" } }),
      this.prisma.auditLog.count({ where: { action: "ACTIVATE_EVENT_RKSV" } }),
    ]);

    return {
      totalCount,
      todayCount,
      cancellationsCount,
      priceChangesCount,
      failedLoginsCount,
      rksvConfirmationsCount,
    };
  }

  async exportCsv(): Promise<string> {
    const logs = await this.prisma.auditLog.findMany({
      include: {
        user: { select: { username: true, role: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 5000,
    });

    const headers = [
      "ID",
      "Zeitstempel",
      "Aktion",
      "Entitaet",
      "Entitaets-ID",
      "Benutzer-ID",
      "Benutzername",
      "Rolle",
      "Details / Begruendung",
    ];
    const rows = logs.map((l) => {
      const detailsStr = l.details
        ? JSON.stringify(l.details).replace(/"/g, '""')
        : "";
      const userName = l.user?.username || "System";
      const role = l.user?.role || "SYSTEM";

      return [
        l.id,
        l.createdAt.toISOString(),
        l.action,
        l.entityType,
        l.entityId,
        l.userId || "",
        `"${userName}"`,
        role,
        `"${detailsStr}"`,
      ].join(";");
    });

    const bom = "\uFEFF";
    return bom + headers.join(";") + "\r\n" + rows.join("\r\n");
  }
}
