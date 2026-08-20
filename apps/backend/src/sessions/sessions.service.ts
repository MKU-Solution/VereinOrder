import {
  Injectable,
  Inject,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, PrismaClient } from "@vereinorder/database";
import { PRISMA_CLIENT } from "../prisma/prisma.module";

@Injectable()
export class SessionsService {
  constructor(@Inject(PRISMA_CLIENT) private prisma: PrismaClient) {}

  async getContext(userId: string) {
    const [events, sessions] = await Promise.all([
      this.prisma.event.findMany({
        where: { status: { in: ["ACTIVE", "TEST_MODE"] } },
        select: { id: true, name: true, status: true, testMode: true },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.cashierSession.findMany({
        where: { userId, status: "ACTIVE" },
        select: {
          id: true,
          eventId: true,
          startingBalance: true,
          startTime: true,
        },
      }),
    ]);
    const sessionsByEvent = new Map(
      sessions.map((session) => [session.eventId, session]),
    );
    return events.map((event) => ({
      ...event,
      activeSession: sessionsByEvent.get(event.id) || null,
    }));
  }

  async getActiveSession(userId: string, eventId: string) {
    return this.prisma.cashierSession.findFirst({
      where: {
        userId,
        eventId,
        status: "ACTIVE",
      },
    });
  }

  async startSession(userId: string, eventId: string, startingBalance: number) {
    if (!userId || !eventId)
      throw new BadRequestException("User and event are required");
    if (
      !Number.isInteger(startingBalance) ||
      startingBalance < 0 ||
      startingBalance > 2_147_483_647
    ) {
      throw new BadRequestException(
        "Starting balance must be a non-negative amount in cents",
      );
    }

    try {
      return await this.prisma.$transaction(async (prisma) => {
        const event = await prisma.event.findFirst({
          where: { id: eventId, status: { in: ["ACTIVE", "TEST_MODE"] } },
          select: { id: true },
        });
        if (!event)
          throw new BadRequestException(
            "Event is not active for cashier sessions",
          );

        const existing = await prisma.cashierSession.findFirst({
          where: { userId, eventId, status: "ACTIVE" },
        });
        if (existing) {
          throw new BadRequestException(
            "User already has an active session for this event",
          );
        }

        const session = await prisma.cashierSession.create({
          data: { userId, eventId, startingBalance, status: "ACTIVE" },
        });
        await prisma.auditLog.create({
          data: {
            action: "CASHIER_SESSION_STARTED",
            entityId: session.id,
            entityType: "CashierSession",
            userId,
            details: { eventId, startingBalance },
          },
        });
        return session;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new BadRequestException(
          "User already has an active session for this event",
        );
      }
      throw error;
    }
  }

  async getSummary(id: string, userId: string) {
    const session = await this.prisma.cashierSession.findUnique({
      where: { id },
      include: { payments: true },
    });

    if (!session) throw new NotFoundException("Session not found");
    if (session.userId !== userId)
      throw new BadRequestException("Not your session");

    let cashSales = 0;
    let cardSales = 0;
    let otherSales = 0;

    for (const p of session.payments) {
      if (p.status === "COMPLETED") {
        if (p.method === "CASH") cashSales += p.amount;
        else if (p.method === "CARD") cardSales += p.amount;
        else otherSales += p.amount;
      } else if (p.status === "REFUNDED") {
        if (p.method === "CASH") cashSales -= p.amount;
        else if (p.method === "CARD") cardSales -= p.amount;
        else otherSales -= p.amount;
      }
    }

    const expectedCash = session.startingBalance + cashSales;

    return {
      id: session.id,
      status: session.status,
      startingBalance: session.startingBalance,
      cashSales,
      cardSales,
      otherSales,
      expectedCash,
      startTime: session.startTime,
      closingBalance: session.closingBalance,
      endTime: session.endTime,
    };
  }

  async closeSession(id: string, userId: string, closingBalance: number) {
    if (
      !Number.isInteger(closingBalance) ||
      closingBalance < 0 ||
      closingBalance > 2_147_483_647
    ) {
      throw new BadRequestException(
        "Closing balance must be a non-negative amount in cents",
      );
    }

    return this.prisma.$transaction(async (prisma) => {
      const lockedSessions = await prisma.$queryRaw<
        {
          id: string;
          userId: string;
          eventId: string;
          status: string;
          startingBalance: number;
        }[]
      >(Prisma.sql`
        SELECT "id", "userId", "eventId", "status", "startingBalance"
        FROM "CashierSession"
        WHERE "id" = ${id}
        FOR UPDATE
      `);
      const session = lockedSessions[0];
      if (!session) throw new NotFoundException("Session not found");
      if (session.userId !== userId)
        throw new BadRequestException("Not your session");
      if (session.status === "CLOSED")
        throw new BadRequestException("Session already closed");

      const payments = await prisma.payment.findMany({
        where: { cashierSessionId: id, status: "COMPLETED" },
        select: { amount: true, method: true },
      });
      const cashSales = payments
        .filter((payment) => payment.method === "CASH")
        .reduce((sum, payment) => sum + payment.amount, 0);
      const expectedCash = session.startingBalance + cashSales;
      const endTime = new Date();
      const updated = await prisma.cashierSession.update({
        where: { id },
        data: { status: "CLOSED", closingBalance, endTime },
      });
      await prisma.auditLog.create({
        data: {
          action: "CASHIER_SESSION_CLOSED",
          entityId: id,
          entityType: "CashierSession",
          userId,
          details: {
            eventId: session.eventId,
            startingBalance: session.startingBalance,
            cashSales,
            expectedCash,
            closingBalance,
            difference: closingBalance - expectedCash,
          },
        },
      });
      return updated;
    });
  }
}
