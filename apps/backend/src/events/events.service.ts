import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from "@nestjs/common";
import {
  PrismaClient,
  EventStatus,
  Prisma,
  OperationalDataMode,
} from "@vereinorder/database";
import { PRISMA_CLIENT } from "../prisma/prisma.module";
import { createHash } from "crypto";

@Injectable()
export class EventsService {
  constructor(@Inject(PRISMA_CLIENT) private prisma: PrismaClient) {}

  private async lockEvent(tx: Prisma.TransactionClient, id: string) {
    const rows = await tx.$queryRaw<
      { id: string; name: string; status: EventStatus; testMode: boolean }[]
    >(
      Prisma.sql`SELECT "id", "name", "status", "testMode" FROM "Event" WHERE "id" = ${id} FOR UPDATE`,
    );
    if (!rows[0]) throw new NotFoundException("Event not found");
    return rows[0];
  }

  private dataMode(event: {
    status: EventStatus;
    testMode: boolean;
  }): OperationalDataMode {
    if (event.status === "ACTIVE" && !event.testMode) return "LIVE";
    if (event.status === "TEST_MODE" && event.testMode) return "TEST";
    throw new BadRequestException(
      "Die Veranstaltung ist nicht in einem konsistenten Betriebsmodus.",
    );
  }

  private requireIdempotencyKey(key?: string) {
    if (!key || key.length < 8 || key.length > 128)
      throw new BadRequestException(
        "Ein gültiger Idempotency-Key ist erforderlich.",
      );
    return key;
  }

  private canonicalJson(value: unknown): string {
    if (value === null || typeof value !== "object") {
      return JSON.stringify(value) ?? "undefined";
    }
    if (Array.isArray(value))
      return `[${value.map((item) => this.canonicalJson(item)).join(",")}]`;
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${this.canonicalJson(record[key])}`)
      .join(",")}}`;
  }

  private hash(value: unknown) {
    return createHash("sha256").update(this.canonicalJson(value)).digest("hex");
  }

  private async configOperation<T>(
    tx: Prisma.TransactionClient,
    scopeId: string,
    action: string,
    key: string,
    payload: unknown,
    create: () => Promise<T>,
  ): Promise<T | { replayed: true; [key: string]: unknown }> {
    const payloadHash = this.hash(payload);
    await tx.$queryRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${scopeId}:${action}:${key}`}, 0))::text AS "lock"`,
    );
    const existing = await tx.configOperation.findUnique({
      where: {
        scopeId_action_idempotencyKey: { scopeId, action, idempotencyKey: key },
      },
    });
    if (existing) {
      if (existing.payloadHash !== payloadHash)
        throw new ConflictException(
          "Idempotency-Key wurde bereits mit anderem Inhalt verwendet.",
        );
      return { ...(existing.response as object), replayed: true };
    }
    const result = await create();
    await tx.configOperation.create({
      data: {
        scopeId,
        action,
        idempotencyKey: key,
        payloadHash,
        response: result as Prisma.InputJsonValue,
      },
    });
    return result;
  }

  async findAll() {
    return this.prisma.event.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: {
          select: {
            orders: true,
            products: true,
            stations: true,
            areas: true,
          },
        },
      },
    });
  }

  async findOne(id: string) {
    const event = await this.prisma.event.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            orders: true,
            products: true,
            stations: true,
            areas: true,
            cashierSessions: true,
          },
        },
      },
    });
    if (!event) throw new NotFoundException("Event not found");
    return event;
  }

  async create(data: any, userId?: string) {
    const event = await this.prisma.event.create({
      data: {
        name: data.name,
        organizer: data.organizer || null,
        location: data.location || null,
        startTime: data.startTime ? new Date(data.startTime) : null,
        endTime: data.endTime ? new Date(data.endTime) : null,
        timezone: data.timezone || "Europe/Vienna",
        status: "DRAFT",
        testMode: false,
      },
    });

    if (userId) {
      await this.prisma.auditLog.create({
        data: {
          action: "EVENT_CREATED",
          entityId: event.id,
          entityType: "Event",
          userId,
          details: { name: event.name, status: event.status },
        },
      });
    }

    return event;
  }

  async update(id: string, data: any, userId?: string) {
    if (data.status !== undefined || data.testMode !== undefined)
      throw new BadRequestException(
        "Betriebsmodus darf nur über die expliziten Lifecycle-Aktionen geändert werden.",
      );
    const existing = await this.prisma.event.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Event not found");

    const event = await this.prisma.event.update({
      where: { id },
      data: {
        name: data.name !== undefined ? data.name : undefined,
        organizer: data.organizer !== undefined ? data.organizer : undefined,
        location: data.location !== undefined ? data.location : undefined,
        startTime:
          data.startTime !== undefined
            ? data.startTime
              ? new Date(data.startTime)
              : null
            : undefined,
        endTime:
          data.endTime !== undefined
            ? data.endTime
              ? new Date(data.endTime)
              : null
            : undefined,
        timezone: data.timezone !== undefined ? data.timezone : undefined,
      },
    });

    if (userId) {
      await this.prisma.auditLog.create({
        data: {
          action: "EVENT_UPDATED",
          entityId: event.id,
          entityType: "Event",
          userId,
          details: { changes: data },
        },
      });
    }

    return event;
  }

  async activate(
    id: string,
    userId: string,
    confirmed: boolean,
    disclaimerVersion: string = "1.0",
  ) {
    if (!confirmed) {
      throw new BadRequestException(
        "Die rechtliche RKSV-Bestätigung ist für die Aktivierung des Festbetriebs zwingend erforderlich.",
      );
    }
    return this.prisma.$transaction(async (tx) => {
      await this.lockEvent(tx, id);
      if (
        await tx.cashierSession.count({
          where: { eventId: id, status: "ACTIVE" },
        })
      )
        throw new ConflictException(
          "Echtbetrieb kann bei offener Kassensitzung nicht aktiviert werden.",
        );
      if (
        (await tx.order.count({ where: { eventId: id, dataMode: "TEST" } })) ||
        (await tx.cashierSession.count({
          where: { eventId: id, dataMode: "TEST" },
        }))
      )
        throw new ConflictException(
          "Testdaten müssen vor dem Echtbetrieb vollständig bereinigt werden.",
        );
      const updated = await tx.event.update({
        where: { id },
        data: {
          status: "ACTIVE",
          testMode: false,
          rksvConfirmedAt: new Date(),
          rksvConfirmedByUserId: userId,
          rksvDisclaimerVersion: disclaimerVersion,
        },
      });
      await tx.auditLog.create({
        data: {
          action: "RKSV_DISCLAIMER_CONFIRMED",
          entityId: id,
          entityType: "Event",
          userId,
          details: {
            disclaimerText:
              "VereinOrder ist keine RKSV-Registrierkasse. Der Veranstalter ist selbst dafür verantwortlich zu prüfen, ob für diese Veranstaltung Einzelaufzeichnungs-, Belegerteilungs- oder Registrierkassenpflichten bestehen.",
            version: disclaimerVersion,
            appVersion: "0.1.0",
            activatedAt: updated.rksvConfirmedAt,
          },
        },
      });
      return updated;
    });
  }

  async changeStatus(id: string, status: EventStatus, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await this.lockEvent(tx, id);
      if (status === "ACTIVE") {
        const current = await tx.event.findUnique({
          where: { id },
          select: { rksvConfirmedAt: true },
        });
        if (!current?.rksvConfirmedAt)
          throw new BadRequestException(
            "Echtbetrieb kann nur mit vorheriger RKSV-Bestätigung aktiviert werden.",
          );
        if (
          (await tx.order.count({
            where: { eventId: id, dataMode: "TEST" },
          })) ||
          (await tx.cashierSession.count({
            where: { eventId: id, dataMode: "TEST" },
          }))
        ) {
          throw new ConflictException(
            "Testdaten müssen vor dem Echtbetrieb vollständig bereinigt werden.",
          );
        }
      }
      if (
        (status === "ACTIVE" || status === "TEST_MODE") &&
        (await tx.cashierSession.count({
          where: { eventId: id, status: "ACTIVE" },
        }))
      )
        throw new ConflictException(
          "Der Betriebsmodus kann bei offenen Kassensitzungen nicht geändert werden.",
        );
      const updated = await tx.event.update({
        where: { id },
        data: {
          status,
          testMode:
            status === "TEST_MODE"
              ? true
              : status === "ACTIVE"
                ? false
                : existing.testMode,
        },
      });
      await tx.auditLog.create({
        data: {
          action: "EVENT_STATUS_CHANGED",
          entityId: id,
          entityType: "Event",
          userId,
          details: {
            previousStatus: existing.status,
            newStatus: status,
            testMode: updated.testMode,
          },
        },
      });
      return updated;
    });
  }

  async testDataSummary(id: string) {
    const event = await this.findOne(id);
    const [orders, sessions, vouchers, payments] = await Promise.all([
      this.prisma.order.count({ where: { eventId: id, dataMode: "TEST" } }),
      this.prisma.cashierSession.count({
        where: { eventId: id, dataMode: "TEST" },
      }),
      this.prisma.productVoucher.count({ where: { eventId: id } }),
      this.prisma.payment.count({
        where: { order: { eventId: id, dataMode: "TEST" } },
      }),
    ]);
    return {
      event: {
        id: event.id,
        name: event.name,
        status: event.status,
        testMode: event.testMode,
      },
      orders,
      sessions,
      payments,
      vouchers,
    };
  }

  async cleanTestData(
    id: string,
    userId: string,
    confirmationName: string,
    idempotencyKey: string,
  ) {
    this.requireIdempotencyKey(idempotencyKey);
    return this.prisma.$transaction(
      async (tx) =>
        this.configOperation(
          tx,
          id,
          "CLEAN_TEST_DATA",
          idempotencyKey,
          { confirmationName },
          async () => {
            const event = await this.lockEvent(tx, id);
            if (event.status !== "TEST_MODE" || !event.testMode)
              throw new ConflictException(
                "Nur eine Veranstaltung im Testmodus darf bereinigt werden.",
              );
            if (confirmationName !== event.name)
              throw new BadRequestException(
                "Der Veranstaltungsname wurde nicht exakt bestätigt.",
              );
            if (
              (await tx.order.count({
                where: { eventId: id, dataMode: "LIVE" },
              })) ||
              (await tx.cashierSession.count({
                where: { eventId: id, dataMode: "LIVE" },
              }))
            )
              throw new ConflictException(
                "Echtbetriebsdaten dürfen nicht bereinigt werden.",
              );
            const eventOrders = await tx.order.findMany({
              where: { eventId: id, dataMode: "TEST" },
              select: { id: true },
            });
            const orderIds = eventOrders.map((o) => o.id);

            let deletedPrintJobs = { count: 0 };
            let deletedPayments = { count: 0 };
            let deletedOrderItems = { count: 0 };
            let deletedOrders = { count: 0 };
            const deletedVouchers = await tx.productVoucher.deleteMany({
              where: { eventId: id, order: { dataMode: "TEST" } },
            });

            if (orderIds.length > 0) {
              deletedPrintJobs = await tx.printJob.deleteMany({
                where: { orderId: { in: orderIds } },
              });
              deletedPayments = await tx.payment.deleteMany({
                where: { orderId: { in: orderIds } },
              });
              deletedOrderItems = await tx.orderItem.deleteMany({
                where: { orderId: { in: orderIds } },
              });
              deletedOrders = await tx.order.deleteMany({
                where: { id: { in: orderIds } },
              });
            }

            const deletedSessions = await tx.cashierSession.deleteMany({
              where: { eventId: id, dataMode: "TEST" },
            });

            const prepared = await tx.event.update({
              where: { id },
              data: { status: "PREPARED", testMode: false },
            });

            await tx.auditLog.create({
              data: {
                action: "EVENT_TEST_DATA_CLEANED",
                entityId: id,
                entityType: "Event",
                userId,
                details: {
                  ordersDeleted: deletedOrders.count,
                  paymentsDeleted: deletedPayments.count,
                  sessionsDeleted: deletedSessions.count,
                  printJobsDeleted: deletedPrintJobs.count,
                  itemsDeleted: deletedOrderItems.count,
                  vouchersDeleted: deletedVouchers.count,
                },
              },
            });

            return {
              success: true,
              event: {
                id: prepared.id,
                status: prepared.status,
                testMode: prepared.testMode,
              },
              message: "Testdaten erfolgreich bereinigt.",
              deleted: {
                orders: deletedOrders.count,
                payments: deletedPayments.count,
                sessions: deletedSessions.count,
                printJobs: deletedPrintJobs.count,
                vouchers: deletedVouchers.count,
              },
            };
          },
        ),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async duplicate(
    sourceId: string,
    userId: string,
    idempotencyKey: string,
    options: { name?: string } = {},
  ) {
    this.requireIdempotencyKey(idempotencyKey);
    return this.prisma.$transaction(
      (tx) =>
        this.configOperation(
          tx,
          sourceId,
          "DUPLICATE",
          idempotencyKey,
          options,
          async () => {
            const source = await tx.event.findUnique({
              where: { id: sourceId },
              include: {
                categories: {
                  include: {
                    products: { include: { variants: true, extras: true } },
                  },
                },
                products: {
                  where: { categoryId: null },
                  include: { variants: true, extras: true },
                },
                stations: true,
                areas: true,
              },
            });
            if (!source) throw new NotFoundException("Event not found");
            const name = options.name?.trim() || `${source.name} (Kopie)`;
            if (!name || name.length > 200)
              throw new BadRequestException(
                "Ein gültiger Veranstaltungsname ist erforderlich.",
              );
            if (await tx.event.count({ where: { name } }))
              throw new ConflictException(
                "Eine Veranstaltung mit diesem Namen existiert bereits.",
              );
            const target = await tx.event.create({
              data: {
                name,
                organizer: source.organizer,
                location: source.location,
                startTime: source.startTime,
                endTime: source.endTime,
                timezone: source.timezone,
                status: "DRAFT",
                testMode: false,
                rksvConfirmedAt: null,
                rksvConfirmedByUserId: null,
                rksvDisclaimerVersion: null,
              },
            });
            const stationIds = new Map<string, string>();
            for (const station of source.stations) {
              const copy = await tx.station.create({
                data: {
                  name: station.name,
                  shortName: station.shortName,
                  color: station.color,
                  sortOrder: station.sortOrder,
                  isActive: station.isActive,
                  eventId: target.id,
                  printerId: null,
                },
              });
              stationIds.set(station.id, copy.id);
            }
            for (const area of source.areas)
              await tx.area.create({
                data: {
                  name: area.name,
                  sortOrder: area.sortOrder,
                  eventId: target.id,
                },
              });
            const copyProduct = async (
              product: any,
              categoryId: string | null,
            ) =>
              tx.product.create({
                data: {
                  name: product.name,
                  shortName: product.shortName,
                  description: product.description,
                  price: product.price,
                  taxRate: product.taxRate,
                  color: product.color,
                  sortOrder: product.sortOrder,
                  imageUrl: product.imageUrl,
                  availability: product.availability,
                  categoryId,
                  eventId: target.id,
                  targetStationId: product.targetStationId
                    ? stationIds.get(product.targetStationId) || null
                    : null,
                  variants: {
                    create: product.variants.map((v: any) => ({
                      name: v.name,
                      price: v.price,
                      sortOrder: v.sortOrder,
                    })),
                  },
                  extras: {
                    create: product.extras.map((e: any) => ({
                      name: e.name,
                      price: e.price,
                      sortOrder: e.sortOrder,
                    })),
                  },
                },
              });
            for (const category of source.categories) {
              const targetCategory = await tx.productCategory.create({
                data: {
                  name: category.name,
                  sortOrder: category.sortOrder,
                  eventId: target.id,
                },
              });
              for (const product of category.products)
                await copyProduct(product, targetCategory.id);
            }
            for (const product of source.products)
              await copyProduct(product, null);
            const result = { eventId: target.id, name: target.name };
            await tx.auditLog.create({
              data: {
                action: "EVENT_DUPLICATED",
                entityId: target.id,
                entityType: "Event",
                userId,
                details: { sourceId },
              },
            });
            return result;
          },
        ),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async copyAssortment(
    sourceId: string,
    userId: string,
    idempotencyKey: string,
    body: {
      targetEventId: string;
      stationMappings: Record<string, string | null>;
    },
  ) {
    this.requireIdempotencyKey(idempotencyKey);
    if (
      !body?.targetEventId ||
      !body.stationMappings ||
      typeof body.stationMappings !== "object"
    )
      throw new BadRequestException(
        "Zielveranstaltung und vollständige Stationszuordnungen sind erforderlich.",
      );
    if (sourceId === body.targetEventId)
      throw new BadRequestException(
        "Quell- und Zielveranstaltung müssen verschieden sein.",
      );
    return this.prisma.$transaction(
      async (tx) => {
        const source = await tx.event.findUnique({
          where: { id: sourceId },
          include: {
            categories: {
              include: {
                products: { include: { variants: true, extras: true } },
              },
            },
            products: {
              where: { categoryId: null },
              include: { variants: true, extras: true },
            },
            stations: true,
          },
        });
        if (!source)
          throw new NotFoundException("Quellveranstaltung nicht gefunden.");
        const target = await this.lockEvent(tx, body.targetEventId);
        if (
          !["DRAFT", "PREPARED", "TEST_MODE"].includes(target.status) ||
          (
            await tx.event.findUnique({
              where: { id: target.id },
              select: { rksvConfirmedAt: true },
            })
          )?.rksvConfirmedAt
        )
          throw new ConflictException(
            "Das Sortiment darf nur in eine nicht RKSV-aktivierte Entwurfs-, Vorbereitungs- oder Testveranstaltung kopiert werden.",
          );
        const targetStations = await tx.station.findMany({
          where: { eventId: target.id },
          select: { id: true },
        });
        const allowedTargets = new Set(
          targetStations.map((station) => station.id),
        );
        for (const station of source.stations)
          if (
            !(station.id in body.stationMappings) ||
            (body.stationMappings[station.id] !== null &&
              !allowedTargets.has(body.stationMappings[station.id]!))
          )
            throw new BadRequestException(
              "Stationszuordnungen müssen vollständig sein und auf Stationen der Zielveranstaltung zeigen.",
            );
        return this.configOperation(
          tx,
          target.id,
          "ASSORTMENT_COPY",
          idempotencyKey,
          { sourceId, ...body },
          async () => {
            const categoryNames = source.categories.map(
              (category) => category.name,
            );
            const productNames = [
              ...source.categories.flatMap((category) => category.products),
              ...source.products,
            ].map((product) => product.name);
            if (
              (await tx.productCategory.count({
                where: { eventId: target.id, name: { in: categoryNames } },
              })) ||
              (await tx.product.count({
                where: { eventId: target.id, name: { in: productNames } },
              }))
            )
              throw new ConflictException(
                "Im Ziel bestehen Namenskonflikte bei Kategorien oder Produkten.",
              );
            const copyProduct = async (
              product: any,
              categoryId: string | null,
            ) =>
              tx.product.create({
                data: {
                  name: product.name,
                  shortName: product.shortName,
                  description: product.description,
                  price: product.price,
                  taxRate: product.taxRate,
                  color: product.color,
                  sortOrder: product.sortOrder,
                  imageUrl: product.imageUrl,
                  availability: product.availability,
                  eventId: target.id,
                  categoryId,
                  targetStationId: product.targetStationId
                    ? body.stationMappings[product.targetStationId]
                    : null,
                  variants: {
                    create: product.variants.map((variant: any) => ({
                      name: variant.name,
                      price: variant.price,
                      sortOrder: variant.sortOrder,
                    })),
                  },
                  extras: {
                    create: product.extras.map((extra: any) => ({
                      name: extra.name,
                      price: extra.price,
                      sortOrder: extra.sortOrder,
                    })),
                  },
                },
              });
            let categoryCount = 0;
            let productCount = 0;
            for (const category of source.categories) {
              const copy = await tx.productCategory.create({
                data: {
                  name: category.name,
                  sortOrder: category.sortOrder,
                  eventId: target.id,
                },
              });
              categoryCount++;
              for (const product of category.products) {
                await copyProduct(product, copy.id);
                productCount++;
              }
            }
            for (const product of source.products) {
              await copyProduct(product, null);
              productCount++;
            }
            const result = {
              targetEventId: target.id,
              categories: categoryCount,
              products: productCount,
            };
            await tx.auditLog.create({
              data: {
                action: "EVENT_ASSORTMENT_COPIED",
                entityId: target.id,
                entityType: "Event",
                userId,
                details: { sourceId, ...result },
              },
            });
            return result;
          },
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async exportConfig(id: string) {
    const event = await this.prisma.event.findUnique({
      where: { id },
      include: {
        categories: {
          include: { products: { include: { variants: true, extras: true } } },
        },
        products: {
          where: { categoryId: null },
          include: { variants: true, extras: true },
        },
        stations: true,
        areas: true,
      },
    });
    if (!event) throw new NotFoundException("Event not found");
    const stationRef = new Map(
      event.stations.map((s, index) => [s.id, `station-${index + 1}`]),
    );
    const products = event.categories.flatMap((c, ci) =>
      c.products.map((p, pi) => ({
        ref: `product-${ci + 1}-${pi + 1}`,
        categoryRef: `category-${ci + 1}`,
        stationRef: p.targetStationId
          ? stationRef.get(p.targetStationId)
          : null,
        name: p.name,
        shortName: p.shortName,
        description: p.description,
        price: p.price,
        taxRate: p.taxRate,
        color: p.color,
        sortOrder: p.sortOrder,
        imageUrl: p.imageUrl,
        availability: p.availability,
        variants: p.variants.map((v) => ({
          name: v.name,
          price: v.price,
          sortOrder: v.sortOrder,
        })),
        extras: p.extras.map((e) => ({
          name: e.name,
          price: e.price,
          sortOrder: e.sortOrder,
        })),
      })),
    );
    products.push(
      ...event.products.map((p, index) => ({
        ref: `product-none-${index + 1}`,
        categoryRef: null,
        stationRef: p.targetStationId
          ? stationRef.get(p.targetStationId)
          : null,
        name: p.name,
        shortName: p.shortName,
        description: p.description,
        price: p.price,
        taxRate: p.taxRate,
        color: p.color,
        sortOrder: p.sortOrder,
        imageUrl: p.imageUrl,
        availability: p.availability,
        variants: p.variants.map((v) => ({
          name: v.name,
          price: v.price,
          sortOrder: v.sortOrder,
        })),
        extras: p.extras.map((e) => ({
          name: e.name,
          price: e.price,
          sortOrder: e.sortOrder,
        })),
      })),
    );
    return {
      kind: "VEREINORDER_EVENT_CONFIG",
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      event: {
        name: event.name,
        organizer: event.organizer,
        location: event.location,
        startTime: event.startTime?.toISOString() || null,
        endTime: event.endTime?.toISOString() || null,
        timezone: event.timezone,
      },
      areas: event.areas.map((area) => ({
        name: area.name,
        sortOrder: area.sortOrder,
      })),
      stations: event.stations.map((s, index) => ({
        ref: `station-${index + 1}`,
        name: s.name,
        shortName: s.shortName,
        color: s.color,
        sortOrder: s.sortOrder,
        isActive: s.isActive,
        printerMapping: null,
      })),
      categories: event.categories.map((c, index) => ({
        ref: `category-${index + 1}`,
        name: c.name,
        sortOrder: c.sortOrder,
      })),
      products,
    };
  }

  async importConfig(userId: string, idempotencyKey: string, input: unknown) {
    this.requireIdempotencyKey(idempotencyKey);
    const config = this.validateImport(input);
    return this.prisma.$transaction(
      (tx) =>
        this.configOperation(
          tx,
          "GLOBAL_CONFIG_IMPORT",
          "CONFIG_IMPORT",
          idempotencyKey,
          config,
          async () => {
            if (await tx.event.count({ where: { name: config.event.name } }))
              throw new ConflictException(
                "Eine Veranstaltung mit diesem Namen existiert bereits.",
              );
            const target = await tx.event.create({
              data: {
                ...config.event,
                startTime: config.event.startTime
                  ? new Date(config.event.startTime)
                  : null,
                endTime: config.event.endTime
                  ? new Date(config.event.endTime)
                  : null,
                status: "DRAFT",
                testMode: false,
                rksvConfirmedAt: null,
                rksvConfirmedByUserId: null,
                rksvDisclaimerVersion: null,
              },
            });
            const stationIds = new Map<string, string>();
            for (const station of config.stations) {
              const saved = await tx.station.create({
                data: {
                  name: station.name,
                  shortName: station.shortName,
                  color: station.color,
                  sortOrder: station.sortOrder,
                  isActive: station.isActive,
                  eventId: target.id,
                  printerId: null,
                },
              });
              stationIds.set(station.ref, saved.id);
            }
            for (const area of config.areas)
              await tx.area.create({
                data: {
                  name: area.name,
                  sortOrder: area.sortOrder,
                  eventId: target.id,
                },
              });
            const categoryIds = new Map<string, string>();
            for (const category of config.categories) {
              const saved = await tx.productCategory.create({
                data: {
                  name: category.name,
                  sortOrder: category.sortOrder,
                  eventId: target.id,
                },
              });
              categoryIds.set(category.ref, saved.id);
            }
            for (const product of config.products)
              await tx.product.create({
                data: {
                  name: product.name,
                  shortName: product.shortName,
                  description: product.description,
                  price: product.price,
                  taxRate: product.taxRate,
                  color: product.color,
                  sortOrder: product.sortOrder,
                  imageUrl: product.imageUrl,
                  availability: product.availability as any,
                  eventId: target.id,
                  categoryId: product.categoryRef
                    ? categoryIds.get(product.categoryRef)!
                    : null,
                  targetStationId: product.stationRef
                    ? stationIds.get(product.stationRef)!
                    : null,
                  variants: { create: product.variants },
                  extras: { create: product.extras },
                },
              });
            const result = { eventId: target.id, name: target.name };
            await tx.auditLog.create({
              data: {
                action: "EVENT_CONFIG_IMPORTED",
                entityId: target.id,
                entityType: "Event",
                userId,
                details: {
                  areas: config.areas.length,
                  stations: config.stations.length,
                  categories: config.categories.length,
                  products: config.products.length,
                },
              },
            });
            return result;
          },
        ),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private validateImport(input: unknown): any {
    if (Buffer.byteLength(this.canonicalJson(input), "utf8") > 1_000_000) {
      throw new BadRequestException("Die Konfigurationsdatei ist zu groß.");
    }
    const object = (value: unknown, keys: string[], label: string) => {
      if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        Object.keys(value as object).some((key) => !keys.includes(key))
      )
        throw new BadRequestException(`${label} enthält ungültige Felder.`);
      return value as Record<string, any>;
    };
    const array = (value: unknown, label: string) => {
      if (!Array.isArray(value) || value.length > 1000)
        throw new BadRequestException(
          `${label} muss eine begrenzte Liste sein.`,
        );
      return value;
    };
    const string = (value: unknown, label: string, optional = false) => {
      if (value === null && optional) return null;
      if (typeof value !== "string" || !value.trim() || value.length > 500)
        throw new BadRequestException(`${label} ist ungültig.`);
      return value.trim();
    };
    const integer = (value: unknown, label: string) => {
      if (
        typeof value !== "number" ||
        !Number.isInteger(value) ||
        value < -2147483648 ||
        value > 2147483647
      ) {
        throw new BadRequestException(`${label} muss ein Int32-Wert sein.`);
      }
      return value;
    };
    const root = object(
      input,
      [
        "kind",
        "schemaVersion",
        "exportedAt",
        "event",
        "areas",
        "stations",
        "categories",
        "products",
      ],
      "Import",
    );
    if (root.kind !== "VEREINORDER_EVENT_CONFIG" || root.schemaVersion !== 1)
      throw new BadRequestException("Unbekanntes Konfigurationsformat.");
    const eventRaw = object(
      root.event,
      ["name", "organizer", "location", "startTime", "endTime", "timezone"],
      "Veranstaltung",
    );
    const iso = (value: unknown, label: string) => {
      if (value === null) return null;
      const result = string(value, label);
      if (
        Number.isNaN(Date.parse(result)) ||
        new Date(result).toISOString() !== result
      )
        throw new BadRequestException(`${label} muss ISO-8601 sein.`);
      return result;
    };
    const timezone = string(eventRaw.timezone, "Zeitzone");
    try {
      Intl.DateTimeFormat(undefined, { timeZone: timezone });
    } catch {
      throw new BadRequestException("Zeitzone muss eine IANA-Zeitzone sein.");
    }
    if (root.exportedAt !== undefined) iso(root.exportedAt, "Exportzeitpunkt");
    const event = {
      name: string(eventRaw.name, "Veranstaltungsname"),
      organizer: string(eventRaw.organizer, "Organisator", true),
      location: string(eventRaw.location, "Ort", true),
      startTime: iso(eventRaw.startTime, "Beginn"),
      endTime: iso(eventRaw.endTime, "Ende"),
      timezone,
    };
    if (
      event.startTime &&
      event.endTime &&
      Date.parse(event.endTime) < Date.parse(event.startTime)
    ) {
      throw new BadRequestException(
        "Das Veranstaltungsende darf nicht vor dem Beginn liegen.",
      );
    }
    const refs = (list: any[], name: string) => {
      const set = new Set<string>();
      list.forEach((item) => {
        if (set.has(item.ref))
          throw new BadRequestException(
            `${name}-Referenzen müssen eindeutig sein.`,
          );
        set.add(item.ref);
      });
      return set;
    };
    const areas = array(root.areas, "Bereiche").map((raw: unknown) => {
      const x = object(raw, ["name", "sortOrder"], "Bereich");
      return {
        name: string(x.name, "Bereichsname"),
        sortOrder: integer(x.sortOrder, "Sortierung"),
      };
    });
    const stations = array(root.stations, "Stationen").map((raw: unknown) => {
      const x = object(
        raw,
        [
          "ref",
          "name",
          "shortName",
          "color",
          "sortOrder",
          "isActive",
          "printerMapping",
        ],
        "Station",
      );
      if (x.printerMapping !== null && x.printerMapping !== undefined)
        throw new BadRequestException(
          "Hardware-Zuordnungen dürfen nicht importiert werden.",
        );
      if (typeof x.isActive !== "boolean")
        throw new BadRequestException("Stationsstatus ist ungültig.");
      return {
        ref: string(x.ref, "Stationsreferenz"),
        name: string(x.name, "Stationsname"),
        shortName: string(x.shortName, "Stationskurzname", true),
        color: string(x.color, "Stationsfarbe", true),
        sortOrder: integer(x.sortOrder, "Sortierung"),
        isActive: x.isActive,
      };
    });
    const categories = array(root.categories, "Kategorien").map(
      (raw: unknown) => {
        const x = object(raw, ["ref", "name", "sortOrder"], "Kategorie");
        return {
          ref: string(x.ref, "Kategorienreferenz"),
          name: string(x.name, "Kategoriename"),
          sortOrder: integer(x.sortOrder, "Sortierung"),
        };
      },
    );
    const stationRefs = refs(stations, "Stations");
    const categoryRefs = refs(categories, "Kategorien");
    const products = array(root.products, "Produkte").map((raw: unknown) => {
      const x = object(
        raw,
        [
          "ref",
          "categoryRef",
          "stationRef",
          "name",
          "shortName",
          "description",
          "price",
          "taxRate",
          "color",
          "sortOrder",
          "imageUrl",
          "availability",
          "variants",
          "extras",
        ],
        "Produkt",
      );
      if (x.categoryRef !== null && !categoryRefs.has(x.categoryRef))
        throw new BadRequestException(
          "Produkt verweist auf eine unbekannte Kategorie.",
        );
      if (x.stationRef !== null && !stationRefs.has(x.stationRef))
        throw new BadRequestException(
          "Produkt verweist auf eine unbekannte Station.",
        );
      const child = (rawChild: unknown, label: string) => {
        const c = object(rawChild, ["name", "price", "sortOrder"], label);
        const price = integer(c.price, `${label}preis`);
        if (price < 0)
          throw new BadRequestException(
            `${label}preis darf nicht negativ sein.`,
          );
        return {
          name: string(c.name, `${label}name`),
          price,
          sortOrder: integer(c.sortOrder, "Sortierung"),
        };
      };
      const availability = string(x.availability, "Verfügbarkeit");
      if (
        !["AVAILABLE", "LOW_STOCK", "OUT_OF_STOCK", "DISABLED"].includes(
          availability,
        )
      )
        throw new BadRequestException("Verfügbarkeit ist ungültig.");
      const price = integer(x.price, "Preis");
      const taxRate = integer(x.taxRate, "Steuersatz");
      if (price < 0)
        throw new BadRequestException("Preis darf nicht negativ sein.");
      if (taxRate < 0 || taxRate > 10000)
        throw new BadRequestException(
          "Steuersatz muss zwischen 0 und 10000 liegen.",
        );
      return {
        ref: string(x.ref, "Produktreferenz"),
        categoryRef: x.categoryRef,
        stationRef: x.stationRef,
        name: string(x.name, "Produktname"),
        shortName: string(x.shortName, "Produktkurzname", true),
        description: string(x.description, "Beschreibung", true),
        price,
        taxRate,
        color: string(x.color, "Farbe", true),
        sortOrder: integer(x.sortOrder, "Sortierung"),
        imageUrl: string(x.imageUrl, "Bildadresse", true),
        availability,
        variants: array(x.variants, "Varianten").map((v) =>
          child(v, "Variante"),
        ),
        extras: array(x.extras, "Extras").map((v) => child(v, "Extra")),
      };
    });
    refs(products, "Produkt");
    return {
      kind: root.kind,
      schemaVersion: root.schemaVersion,
      event,
      areas,
      stations,
      categories,
      products,
    };
  }

  async remove(id: string, userId: string) {
    const existing = await this.prisma.event.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Event not found");

    await this.prisma.auditLog.create({
      data: {
        action: "EVENT_DELETED",
        entityId: id,
        entityType: "Event",
        userId,
        details: { name: existing.name },
      },
    });

    return this.prisma.event.delete({ where: { id } });
  }
}
