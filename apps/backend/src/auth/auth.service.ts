import { HttpException, HttpStatus, Injectable, Inject } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Prisma, PrismaClient } from "@vereinorder/database";
import { PRISMA_CLIENT } from "../prisma/prisma.module";
import * as bcrypt from "bcryptjs";

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 5 * 60 * 1000;
const DUMMY_PIN_HASH = bcrypt.hashSync("invalid-pin-placeholder", 10);

@Injectable()
export class AuthService {
  constructor(
    @Inject(PRISMA_CLIENT) private prisma: PrismaClient,
    private jwtService: JwtService,
  ) {}

  private async audit(
    action: string,
    entityId: string,
    userId: string | null,
    details: Prisma.InputJsonValue,
    entityType = "Auth",
  ) {
    await this.prisma.auditLog.create({
      data: { action, entityId, entityType, userId, details },
    });
  }

  async validateUser(usernameInput: string, pinInput: string): Promise<any> {
    const username =
      typeof usernameInput === "string" ? usernameInput.trim() : "";
    const pin = typeof pinInput === "string" ? pinInput : "";
    const throttleKey = username.toLocaleLowerCase("en-US") || "unknown";
    const now = new Date();
    const throttle = await this.prisma.authThrottle.findUnique({
      where: { key: throttleKey },
    });
    const expiredLock = Boolean(
      throttle?.lockedUntil && throttle.lockedUntil <= now,
    );

    if (throttle?.lockedUntil && throttle.lockedUntil > now) {
      await this.audit("AUTH_RATE_LIMITED", throttleKey, null, {
        lockedUntil: throttle.lockedUntil.toISOString(),
      });
      throw new HttpException(
        "Zu viele Anmeldeversuche. Bitte später erneut versuchen.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = username
      ? await this.prisma.user.findUnique({ where: { username } })
      : null;
    const validShape = /^\d{4,12}$/.test(pin);
    const pinMatches = await bcrypt.compare(
      validShape ? pin : "invalid",
      user?.pinHash || DUMMY_PIN_HASH,
    );

    if (user?.isActive && validShape && pinMatches) {
      await this.prisma.authThrottle.deleteMany({
        where: { key: throttleKey },
      });
      const { pinHash, ...result } = user;
      return result;
    }

    const attempt = await this.prisma.authThrottle.upsert({
      where: { key: throttleKey },
      create: { key: throttleKey, failedAttempts: 1 },
      update: expiredLock
        ? { failedAttempts: 1, lockedUntil: null }
        : { failedAttempts: { increment: 1 }, lockedUntil: null },
    });
    const lockedUntil =
      attempt.failedAttempts >= MAX_FAILED_ATTEMPTS
        ? new Date(now.getTime() + LOCK_DURATION_MS)
        : null;
    if (lockedUntil) {
      await this.prisma.authThrottle.update({
        where: { key: throttleKey },
        data: { lockedUntil },
      });
    }

    await this.audit("FAILED_LOGIN", throttleKey, user?.id || null, {
      attempt: attempt.failedAttempts,
      lockedUntil: lockedUntil?.toISOString() || null,
      reason:
        user?.isActive === false
          ? "Inactive user"
          : user
            ? "Invalid PIN"
            : "Unknown user",
    });

    if (lockedUntil) {
      throw new HttpException(
        "Zu viele Anmeldeversuche. Bitte später erneut versuchen.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return null;
  }

  async login(user: any, action = "LOGIN", previousUserId?: string) {
    const payload = { username: user.username, sub: user.id, role: user.role };

    await this.audit(
      action,
      user.id,
      user.id,
      {
        username: user.username,
        role: user.role,
        previousUserId: previousUserId || null,
      },
      "User",
    );

    return {
      access_token: this.jwtService.sign(payload),
    };
  }
}
