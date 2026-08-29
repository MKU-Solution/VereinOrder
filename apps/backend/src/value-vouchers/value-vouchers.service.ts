import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Inject,
  NotFoundException,
} from "@nestjs/common";
import { createHash, randomBytes } from "crypto";
import { Prisma, PrismaClient } from "@vereinorder/database";
import { AuditService } from "../audit/audit.service";
import { PRISMA_CLIENT } from "../prisma/prisma.module";
import {
  CancelValueVoucherDto,
  IssueValueVoucherDto,
  RedeemValueVoucherDto,
  ValueVoucherQueryDto,
} from "./dto/value-vouchers.dto";

type TransactionClient = Prisma.TransactionClient;
type DataMode = "TEST" | "LIVE";

/**
 * Wertgutscheine sind bewusst kein allgemeiner PaymentMethod-Pfad: alle
 * Saldoaenderungen, Zahlungen und Druckauftraege entstehen ausschliesslich
 * innerhalb der hier verwendeten serialisierbaren Transaktion.
 */
@Injectable()
export class ValueVouchersService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
  ) {}

  async issue(userId: string, role: string, dto: IssueValueVoucherDto) {
    this.assertIssueRole(role);
    const fingerprint = this.fingerprint("ISSUE", dto);
    const replay = await this.findIdempotent(dto.idempotencyKey, fingerprint);
    if (replay) return replay;

    return this.serializable(async (tx) => {
      const replayInTransaction = await this.findIdempotent(
        dto.idempotencyKey,
        fingerprint,
        tx,
      );
      if (replayInTransaction) return replayInTransaction;

      const context = await this.requireCashierContext(
        tx,
        userId,
        dto.eventId,
        dto.cashierSessionId,
      );
      this.validateTender(dto.amount, dto.fundingMethod, dto.tenderedAmount);
      const printer = await this.requirePrinter(tx, dto.printerId);
      const code = this.newCode(context.dataMode);
      const changeAmount =
        dto.fundingMethod === "CASH"
          ? (dto.tenderedAmount ?? dto.amount) - dto.amount
          : null;

      const voucher = await tx.valueVoucher.create({
        data: {
          code,
          initialBalance: dto.amount,
          currentBalance: dto.amount,
          eventId: dto.eventId,
          dataMode: context.dataMode,
          issuedByUserId: userId,
          issuedCashierSessionId: context.sessionId,
        },
      });
      const movement = await tx.valueVoucherMovement.create({
        data: {
          type: "ISSUE",
          balanceDelta: dto.amount,
          balanceBefore: 0,
          balanceAfter: dto.amount,
          voucherId: voucher.id,
          eventId: dto.eventId,
          dataMode: context.dataMode,
          actorUserId: userId,
          cashierSessionId: context.sessionId,
          fundingMethod: dto.fundingMethod,
          tenderedAmount:
            dto.fundingMethod === "CASH"
              ? (dto.tenderedAmount ?? dto.amount)
              : null,
          changeAmount,
          idempotencyKey: dto.idempotencyKey,
          requestFingerprint: fingerprint,
        },
      });
      await tx.printJob.create({
        data: {
          printerId: printer.id,
          jobType: "VALUE_VOUCHER_ISSUE",
          valueVoucherMovementId: movement.id,
          sourceKey: `value-voucher-issue:${movement.id}`,
          content: {
            title: "WERTGUTSCHEIN",
            eventName: context.eventName,
            voucherCode: code,
            initialBalance: dto.amount,
            dataMode: context.dataMode,
          },
        },
      });
      await this.audit.log(
        {
          action: "VALUE_VOUCHER_ISSUED",
          entityId: voucher.id,
          entityType: "ValueVoucher",
          userId,
          details: {
            eventId: dto.eventId,
            dataMode: context.dataMode,
            voucherCode: this.mask(code),
            amount: dto.amount,
            fundingMethod: dto.fundingMethod,
            cashierSessionId: context.sessionId,
          },
        },
        tx,
      );
      return this.issueResponse(voucher, movement.id);
    });
  }

  async quote(userId: string, role: string, query: ValueVoucherQueryDto) {
    this.assertQuoteOrRedeemRole(role);
    const context = await this.requireCashierContext(
      this.prisma,
      userId,
      query.eventId,
      query.cashierSessionId,
    );
    const voucher = await this.prisma.valueVoucher.findUnique({
      where: { code: this.normalizeCode(query.code) },
    });
    if (
      !voucher ||
      voucher.eventId !== query.eventId ||
      voucher.dataMode !== context.dataMode
    )
      throw new NotFoundException("Wertgutschein wurde nicht gefunden.");
    if (voucher.status !== "ACTIVE" || voucher.currentBalance <= 0)
      throw new BadRequestException("Wertgutschein ist nicht mehr einlösbar.");
    if (!query.orderId) {
      return {
        voucherCode: this.mask(voucher.code),
        balance: voucher.currentBalance,
        dataMode: voucher.dataMode,
      };
    }
    const order = await this.prisma.order.findUnique({
      where: { id: query.orderId },
      include: { payments: { where: { status: "COMPLETED" } } },
    });
    this.assertOrderContext(order, query.eventId, context.dataMode);
    const outstanding = this.outstanding(order);
    return {
      voucherCode: this.mask(voucher.code),
      balance: voucher.currentBalance,
      orderId: order.id,
      outstanding,
      redeemable: Math.min(voucher.currentBalance, outstanding),
      dataMode: voucher.dataMode,
    };
  }

  async redeem(userId: string, role: string, dto: RedeemValueVoucherDto) {
    this.assertQuoteOrRedeemRole(role);
    const fingerprint = this.fingerprint("REDEEM", dto);
    const replay = await this.findIdempotent(dto.idempotencyKey, fingerprint);
    if (replay) return replay;
    return this.serializable(async (tx) => {
      const replayInTransaction = await this.findIdempotent(
        dto.idempotencyKey,
        fingerprint,
        tx,
      );
      if (replayInTransaction) return replayInTransaction;
      const context = await this.requireCashierContext(
        tx,
        userId,
        dto.eventId,
        dto.cashierSessionId,
      );

      // Einheitliche Sperrreihenfolge verhindert tote Sperrzyklen mit dem
      // allgemeinen Zahlungsweg: zuerst Order, danach Wertgutschein.
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "Order" WHERE "id" = ${dto.orderId} FOR UPDATE`,
      );
      const order = await tx.order.findUnique({
        where: { id: dto.orderId },
        include: {
          payments: { where: { status: "COMPLETED" } },
          items: { orderBy: { createdAt: "asc" } },
        },
      });
      this.assertOrderContext(order, dto.eventId, context.dataMode);
      if (order.lifecycleStatus === "CANCELLED")
        throw new BadRequestException(
          "Stornierte Bestellungen können nicht bezahlt werden.",
        );
      const outstanding = this.outstanding(order);
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "ValueVoucher" WHERE "code" = ${this.normalizeCode(dto.code)} FOR UPDATE`,
      );
      const voucher = await tx.valueVoucher.findUnique({
        where: { code: this.normalizeCode(dto.code) },
      });
      if (
        !voucher ||
        voucher.eventId !== dto.eventId ||
        voucher.dataMode !== context.dataMode
      )
        throw new NotFoundException("Wertgutschein wurde nicht gefunden.");
      if (voucher.status !== "ACTIVE" || voucher.currentBalance <= 0)
        throw new BadRequestException(
          "Der Gutschein hat nicht genügend verfügbares Guthaben.",
        );
      const redeemedAmount = Math.min(voucher.currentBalance, outstanding);
      if (redeemedAmount <= 0)
        throw new BadRequestException(
          "Die Bestellung hat keinen offenen Betrag mehr.",
        );
      const expectedRemainder = outstanding - redeemedAmount;
      if (expectedRemainder > 0 && !dto.remainderPayment)
        throw new BadRequestException(
          "Für den offenen Restbetrag ist eine Zahlungsart erforderlich.",
        );
      if (expectedRemainder === 0 && dto.remainderPayment)
        throw new BadRequestException(
          "Für eine vollständig gedeckte Bestellung ist keine Restzahlung erlaubt.",
        );
      if (dto.remainderPayment)
        this.validateTender(
          expectedRemainder,
          dto.remainderPayment.method,
          dto.remainderPayment.tenderedAmount,
        );
      const printer = await this.requirePrinter(tx, dto.printerId);
      const nextBalance = voucher.currentBalance - redeemedAmount;
      const changed = await tx.valueVoucher.updateMany({
        where: {
          id: voucher.id,
          currentBalance: { gte: redeemedAmount },
          status: "ACTIVE",
          version: voucher.version,
        },
        data: {
          currentBalance: nextBalance,
          status: nextBalance === 0 ? "DEPLETED" : "ACTIVE",
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1)
        throw new ConflictException(
          "Gutschein wurde gleichzeitig verändert; bitte erneut prüfen.",
        );

      const voucherPayment = await tx.payment.create({
        data: {
          orderId: order.id,
          amount: redeemedAmount,
          method: "VOUCHER",
          status: "COMPLETED",
          cashierSessionId: context.sessionId,
        },
      });
      const movement = await tx.valueVoucherMovement.create({
        data: {
          type: "REDEEM",
          balanceDelta: -redeemedAmount,
          balanceBefore: voucher.currentBalance,
          balanceAfter: nextBalance,
          voucherId: voucher.id,
          eventId: dto.eventId,
          dataMode: context.dataMode,
          orderId: order.id,
          paymentId: voucherPayment.id,
          actorUserId: userId,
          cashierSessionId: context.sessionId,
          idempotencyKey: dto.idempotencyKey,
          requestFingerprint: fingerprint,
        },
      });
      if (dto.remainderPayment) {
        await tx.payment.create({
          data: {
            orderId: order.id,
            amount: expectedRemainder,
            method: dto.remainderPayment.method,
            status: "COMPLETED",
            cashierSessionId: context.sessionId,
            tenderedAmount:
              dto.remainderPayment.method === "CASH"
                ? (dto.remainderPayment.tenderedAmount ?? expectedRemainder)
                : null,
            changeAmount:
              dto.remainderPayment.method === "CASH"
                ? (dto.remainderPayment.tenderedAmount ?? expectedRemainder) -
                  expectedRemainder
                : 0,
          },
        });
      }
      const totalPaid =
        this.completedPaid(order) + redeemedAmount + expectedRemainder;
      const updatedOrder = await tx.order.update({
        where: { id: order.id },
        data: {
          paymentStatus:
            totalPaid === order.totalAmount ? "PAID" : "PARTIALLY_PAID",
        },
      });
      await this.createAllocations(
        tx,
        movement.id,
        order.items,
        redeemedAmount,
      );
      if (nextBalance > 0) {
        await tx.printJob.create({
          data: {
            printerId: printer.id,
            jobType: "VALUE_VOUCHER_BALANCE",
            valueVoucherMovementId: movement.id,
            sourceKey: `value-voucher-balance:${movement.id}`,
            content: {
              title: "GUTSCHEIN-RESTGUTHABEN",
              eventName: context.eventName,
              voucherCode: voucher.code,
              redeemedAmount,
              currentBalance: nextBalance,
              orderId: order.id,
            },
          },
        });
      }
      await this.audit.log(
        {
          action: "VALUE_VOUCHER_REDEEMED",
          entityId: voucher.id,
          entityType: "ValueVoucher",
          userId,
          details: {
            eventId: dto.eventId,
            dataMode: context.dataMode,
            voucherCode: this.mask(voucher.code),
            orderId: order.id,
            amount: redeemedAmount,
            balanceAfter: nextBalance,
            cashierSessionId: context.sessionId,
            remainderMethod: dto.remainderPayment?.method ?? null,
          },
        },
        tx,
      );
      return {
        voucherCode: this.mask(voucher.code),
        redeemedAmount,
        currentBalance: nextBalance,
        orderId: order.id,
        paymentStatus: updatedOrder.paymentStatus,
      };
    });
  }

  async history(userId: string, role: string, query: ValueVoucherQueryDto) {
    this.assertManagementRole(role);
    const context = await this.requireCashierContext(
      this.prisma,
      userId,
      query.eventId,
      query.cashierSessionId,
    );
    const voucher = await this.prisma.valueVoucher.findUnique({
      where: { code: this.normalizeCode(query.code) },
      include: {
        movements: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            type: true,
            balanceDelta: true,
            balanceBefore: true,
            balanceAfter: true,
            orderId: true,
            createdAt: true,
          },
        },
      },
    });
    if (
      !voucher ||
      voucher.eventId !== query.eventId ||
      voucher.dataMode !== context.dataMode
    )
      throw new NotFoundException("Wertgutschein wurde nicht gefunden.");
    return {
      id: voucher.id,
      code: this.mask(voucher.code),
      status: voucher.status,
      initialBalance: voucher.initialBalance,
      currentBalance: voucher.currentBalance,
      movements: voucher.movements,
    };
  }

  async cancel(userId: string, role: string, dto: CancelValueVoucherDto) {
    this.assertManagementRole(role);
    const fingerprint = this.fingerprint("CANCEL", dto);
    const replay = await this.findIdempotent(dto.idempotencyKey, fingerprint);
    if (replay) return replay;
    return this.serializable(async (tx) => {
      const known = await this.findIdempotent(
        dto.idempotencyKey,
        fingerprint,
        tx,
      );
      if (known) return known;
      const context = await this.requireCashierContext(
        tx,
        userId,
        dto.eventId,
        dto.cashierSessionId,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "ValueVoucher" WHERE "code" = ${this.normalizeCode(dto.code)} FOR UPDATE`,
      );
      const voucher = await tx.valueVoucher.findUnique({
        where: { code: this.normalizeCode(dto.code) },
      });
      if (
        !voucher ||
        voucher.eventId !== dto.eventId ||
        voucher.dataMode !== context.dataMode
      )
        throw new NotFoundException("Wertgutschein wurde nicht gefunden.");
      const movements = await tx.valueVoucherMovement.count({
        where: { voucherId: voucher.id },
      });
      if (
        movements !== 1 ||
        voucher.currentBalance !== voucher.initialBalance ||
        voucher.status !== "ACTIVE"
      )
        throw new BadRequestException(
          "Nur unbenutzte Wertgutscheine dürfen storniert werden.",
        );
      const updated = await tx.valueVoucher.updateMany({
        where: {
          id: voucher.id,
          version: voucher.version,
          currentBalance: voucher.initialBalance,
          status: "ACTIVE",
        },
        data: {
          currentBalance: 0,
          status: "CANCELLED",
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1)
        throw new ConflictException(
          "Gutschein wurde gleichzeitig verändert; bitte erneut prüfen.",
        );
      await tx.valueVoucherMovement.create({
        data: {
          type: "CANCEL",
          balanceDelta: -voucher.currentBalance,
          balanceBefore: voucher.currentBalance,
          balanceAfter: 0,
          voucherId: voucher.id,
          eventId: dto.eventId,
          dataMode: context.dataMode,
          actorUserId: userId,
          cashierSessionId: context.sessionId,
          reason: dto.reason.trim(),
          idempotencyKey: dto.idempotencyKey,
          requestFingerprint: fingerprint,
        },
      });
      // Kein VALUE_VOUCHER_BALANCE-Druck bei Saldo 0: Der Belegtyp steht
      // ausschließlich für verbleibendes Guthaben. Die Stornierung selbst
      // ist vollständig im Bewegungs- und Auditjournal nachvollziehbar.
      await this.audit.log(
        {
          action: "VALUE_VOUCHER_CANCELLED",
          entityId: voucher.id,
          entityType: "ValueVoucher",
          userId,
          details: {
            eventId: dto.eventId,
            dataMode: context.dataMode,
            voucherCode: this.mask(voucher.code),
            cashierSessionId: context.sessionId,
            reason: dto.reason.trim(),
          },
        },
        tx,
      );
      return {
        voucherCode: this.mask(voucher.code),
        status: "CANCELLED",
        currentBalance: 0,
      };
    });
  }

  private async createAllocations(
    tx: TransactionClient,
    movementId: string,
    items: Array<{
      id: string;
      quantity: number;
      priceAtTime: number;
      depositAtTime: number;
    }>,
    amount: number,
  ) {
    let remaining = amount;
    for (const item of items) {
      if (remaining <= 0) break;
      const itemTotal =
        item.quantity * (item.priceAtTime + (item.depositAtTime ?? 0));
      const allocated = Math.min(itemTotal, remaining);
      if (allocated > 0)
        await tx.valueVoucherAllocation.create({
          data: { movementId, orderItemId: item.id, amount: allocated },
        });
      remaining -= allocated;
    }
    if (remaining !== 0)
      throw new BadRequestException(
        "Gutscheinbetrag kann nicht auf die Bestellung verteilt werden.",
      );
  }

  private async requireCashierContext(
    client: PrismaClient | TransactionClient,
    userId: string,
    eventId: string,
    cashierSessionId: string,
  ) {
    const session = await client.cashierSession.findUnique({
      where: { id: cashierSessionId },
    });
    if (
      !session ||
      session.userId !== userId ||
      session.eventId !== eventId ||
      session.status !== "ACTIVE"
    )
      throw new ForbiddenException(
        "Eine eigene aktive Kassensitzung ist erforderlich.",
      );
    const event = await client.event.findUnique({
      where: { id: eventId },
      select: { name: true, status: true, testMode: true },
    });
    const dataMode: DataMode | null =
      event?.status === "ACTIVE" && !event.testMode
        ? "LIVE"
        : event?.status === "TEST_MODE" && event.testMode
          ? "TEST"
          : null;
    if (!dataMode || session.dataMode !== dataMode)
      throw new BadRequestException(
        "Veranstaltung und Kassensitzung gehören nicht zum selben aktiven Betriebsmodus.",
      );
    return { sessionId: session.id, dataMode, eventName: event?.name ?? "" };
  }

  private assertOrderContext(
    order: any,
    eventId: string,
    dataMode: DataMode,
  ): asserts order {
    if (!order || order.eventId !== eventId || order.dataMode !== dataMode)
      throw new NotFoundException("Bestellung wurde nicht gefunden.");
  }
  private completedPaid(order: {
    payments: Array<{ amount: number; method: string }>;
  }) {
    return order.payments.reduce(
      (sum, payment) =>
        sum + (payment.method === "REFUND" ? 0 : payment.amount),
      0,
    );
  }
  private outstanding(order: {
    totalAmount: number;
    payments: Array<{ amount: number; method: string }>;
  }) {
    return Math.max(0, order.totalAmount - this.completedPaid(order));
  }
  private validateTender(amount: number, method: string, tendered?: number) {
    if (method === "CASH" && (tendered === undefined || tendered < amount))
      throw new BadRequestException(
        "Bei Barzahlung muss der gegebene Betrag mindestens dem Gutscheinwert entsprechen.",
      );
    if (method === "CARD" && tendered !== undefined)
      throw new BadRequestException(
        "Bei Kartenzahlung darf kein gegebener Betrag angegeben werden.",
      );
  }
  private assertIssueRole(role: string) {
    if (role !== "ADMINISTRATOR" && role !== "CASHIER")
      throw new ForbiddenException(
        "Nur Kasse oder Administration dürfen Wertgutscheine ausgeben.",
      );
  }
  private assertQuoteOrRedeemRole(role: string) {
    if (role !== "ADMINISTRATOR" && role !== "CASHIER" && role !== "WAITER")
      throw new ForbiddenException(
        "Nur Service, Kasse oder Administration dürfen Wertgutscheine einlösen.",
      );
  }
  private assertManagementRole(role: string) {
    if (
      role !== "ADMINISTRATOR" &&
      role !== "EVENT_MANAGER" &&
      role !== "REVISION"
    )
      throw new ForbiddenException(
        "Nur Administration, Veranstaltungsleitung oder Revision dürfen Gutscheinverläufe verwalten.",
      );
  }
  private normalizeCode(code: string) {
    return code.trim().toUpperCase();
  }
  private mask(code: string) {
    return `${code.slice(0, 5)}…${code.slice(-4)}`;
  }
  private newCode(dataMode: DataMode) {
    return `${dataMode}-${randomBytes(12).toString("hex").toUpperCase()}`;
  }
  private fingerprint(action: string, data: unknown) {
    return createHash("sha256")
      .update(JSON.stringify({ action, data }))
      .digest("hex");
  }
  private async requirePrinter(
    client: PrismaClient | TransactionClient,
    printerId: string | undefined,
  ) {
    // CashierSession besitzt derzeit keine Druckerrelation. Der explizit vom
    // Kassenplatz übergebene Drucker wird deshalb transaktional auf aktiv
    // geprüft; eine künftige Platz-zu-Drucker-Zuordnung muss hier ergänzt
    // werden, damit deren Zugehörigkeit zusätzlich erzwungen wird.
    if (!printerId)
      throw new BadRequestException(
        "Für Wertgutscheine muss ein aktiver Drucker ausgewählt werden.",
      );
    const printer = await client.printer.findFirst({
      where: { id: printerId, isActive: true },
      select: { id: true },
    });
    if (!printer)
      throw new BadRequestException(
        "Für Wertgutscheine ist ein aktiver Drucker erforderlich.",
      );
    return printer;
  }
  private async findIdempotent(
    key: string,
    fingerprint: string,
    client: PrismaClient | TransactionClient = this.prisma,
  ) {
    const movement = await client.valueVoucherMovement.findUnique({
      where: { idempotencyKey: key },
      include: { voucher: true },
    });
    if (!movement) return null;
    if (movement.requestFingerprint !== fingerprint)
      throw new ConflictException(
        "Idempotenzschlüssel wurde mit abweichender Anfrage wiederverwendet.",
      );
    return {
      voucherCode: this.mask(movement.voucher.code),
      movementId: movement.id,
      currentBalance: movement.balanceAfter,
      replayed: true,
    };
  }
  private serializable<T>(callback: (tx: TransactionClient) => Promise<T>) {
    return this.prisma.$transaction(callback, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  }
  private issueResponse(
    voucher: { code: string; currentBalance: number; status: string },
    movementId: string,
  ) {
    return {
      voucherCode: voucher.code,
      currentBalance: voucher.currentBalance,
      status: voucher.status,
      movementId,
    };
  }
}
