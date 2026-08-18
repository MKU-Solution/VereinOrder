import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@vereinorder/database';
import { PRISMA_CLIENT } from '../prisma/prisma.module';
import * as bcrypt from 'bcryptjs';

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
        updatedAt: true
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  async create(data: any) {
    const salt = await bcrypt.genSalt(10);
    const pinHash = await bcrypt.hash(data.pin, salt);

    return this.prisma.user.create({
      data: {
        username: data.username,
        role: data.role,
        isActive: data.isActive ?? true,
        pinHash
      },
      select: { id: true, username: true, role: true, isActive: true }
    });
  }

  async update(id: string, data: any) {
    return this.prisma.user.update({
      where: { id },
      data: {
        username: data.username,
        role: data.role,
        isActive: data.isActive
      },
      select: { id: true, username: true, role: true, isActive: true }
    });
  }

  async updatePin(id: string, pin: string) {
    const salt = await bcrypt.genSalt(10);
    const pinHash = await bcrypt.hash(pin, salt);

    return this.prisma.user.update({
      where: { id },
      data: { pinHash },
      select: { id: true, username: true }
    });
  }
}
