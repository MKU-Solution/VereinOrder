import { Injectable, Inject } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@vereinorder/database';
import { PRISMA_CLIENT } from '../prisma/prisma.module';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class AuthService {
  constructor(
    @Inject(PRISMA_CLIENT) private prisma: PrismaClient,
    private jwtService: JwtService
  ) {}

  async validateUser(username: string, pin: string): Promise<any> {
    const user = await this.prisma.user.findUnique({ where: { username } });
    if (user && await bcrypt.compare(pin, user.pinHash)) {
      const { pinHash, ...result } = user;
      return result;
    }

    // Log failed login attempt
    try {
      await this.prisma.auditLog.create({
        data: {
          action: 'FAILED_LOGIN',
          entityId: username || 'UNKNOWN',
          entityType: 'Auth',
          userId: user?.id || null,
          details: {
            username,
            reason: user ? 'Invalid PIN' : 'User not found',
            timestamp: new Date().toISOString()
          }
        }
      });
    } catch (e) {
      // Ignore logging error
    }

    return null;
  }

  async login(user: any) {
    const payload = { username: user.username, sub: user.id, role: user.role };

    // Log successful login
    try {
      await this.prisma.auditLog.create({
        data: {
          action: 'LOGIN',
          entityId: user.id,
          entityType: 'User',
          userId: user.id,
          details: {
            username: user.username,
            role: user.role,
            timestamp: new Date().toISOString()
          }
        }
      });
    } catch (e) {
      // Ignore logging error
    }

    return {
      access_token: this.jwtService.sign(payload),
    };
  }
}
