import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@vereinorder/database';
import { PRISMA_CLIENT } from '../prisma/prisma.module';

@Injectable()
export class EventsService {
  constructor(@Inject(PRISMA_CLIENT) private prisma: PrismaClient) {}

  async findAll() {
    return this.prisma.event.findMany({
      orderBy: { createdAt: 'desc' }
    });
  }

  async findOne(id: string) {
    const event = await this.prisma.event.findUnique({ where: { id } });
    if (!event) throw new NotFoundException('Event not found');
    return event;
  }

  async create(data: any) {
    return this.prisma.event.create({
      data: {
        name: data.name,
        organizer: data.organizer,
        location: data.location,
        startTime: data.startTime ? new Date(data.startTime) : null,
        endTime: data.endTime ? new Date(data.endTime) : null,
        status: data.status,
        testMode: data.testMode
      }
    });
  }

  async update(id: string, data: any) {
    return this.prisma.event.update({
      where: { id },
      data: {
        name: data.name,
        organizer: data.organizer,
        location: data.location,
        startTime: data.startTime ? new Date(data.startTime) : undefined,
        endTime: data.endTime ? new Date(data.endTime) : undefined,
        status: data.status,
        testMode: data.testMode
      }
    });
  }
}
