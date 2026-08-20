import { Injectable, Inject, NotFoundException } from "@nestjs/common";
import { PrismaClient } from "@vereinorder/database";
import { PRISMA_CLIENT } from "../prisma/prisma.module";
import * as bcrypt from "bcryptjs";

@Injectable()
export class UsersService {
  constructor(@Inject(PRISMA_CLIENT) private prisma: PrismaClient) {}

  async findAll() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        username: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async create(data: any, createdByUserId?: string) {
    const salt = await bcrypt.genSalt(10);
    const pinHash = await bcrypt.hash(data.pin, salt);

    const user = await this.prisma.user.create({
      data: {
        username: data.username,
        role: data.role,
        isActive: data.isActive ?? true,
        pinHash,
      },
      select: { id: true, username: true, role: true, isActive: true },
    });

    if (createdByUserId) {
      await this.prisma.auditLog.create({
        data: {
          action: "USER_CREATED",
          entityId: user.id,
          entityType: "User",
          userId: createdByUserId,
          details: {
            username: user.username,
            role: user.role,
          },
        },
      });
    }

    return user;
  }

  async update(id: string, data: any, updatedByUserId?: string) {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("User not found");

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        username: data.username,
        role: data.role,
        isActive: data.isActive,
      },
      select: { id: true, username: true, role: true, isActive: true },
    });

    if (existing.username !== updated.username) {
      await this.prisma.authThrottle.deleteMany({
        where: {
          key: {
            in: [
              existing.username.toLocaleLowerCase("en-US"),
              updated.username.toLocaleLowerCase("en-US"),
            ],
          },
        },
      });
    }

    if (updatedByUserId) {
      await this.prisma.auditLog.create({
        data: {
          action: "USER_UPDATED",
          entityId: id,
          entityType: "User",
          userId: updatedByUserId,
          details: {
            username: updated.username,
            previousRole: existing.role,
            newRole: updated.role,
            previousActive: existing.isActive,
            newActive: updated.isActive,
          },
        },
      });
    }

    return updated;
  }

  async updatePin(id: string, pin: string, updatedByUserId?: string) {
    const salt = await bcrypt.genSalt(10);
    const pinHash = await bcrypt.hash(pin, salt);

    const updated = await this.prisma.user.update({
      where: { id },
      data: { pinHash },
      select: { id: true, username: true },
    });
    await this.prisma.authThrottle.deleteMany({
      where: { key: updated.username.toLocaleLowerCase("en-US") },
    });

    if (updatedByUserId) {
      await this.prisma.auditLog.create({
        data: {
          action: "USER_PIN_CHANGED",
          entityId: id,
          entityType: "User",
          userId: updatedByUserId,
          details: {
            username: updated.username,
          },
        },
      });
    }

    return updated;
  }
}
