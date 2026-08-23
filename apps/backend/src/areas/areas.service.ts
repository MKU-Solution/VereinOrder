import {
  BadRequestException,
  Injectable,
  Inject,
  NotFoundException,
} from "@nestjs/common";
import { PrismaClient } from "@vereinorder/database";
import { PRISMA_CLIENT } from "../prisma/prisma.module";
import { CreateAreaDto, UpdateAreaDto } from "./dto/area.dto";

@Injectable()
export class AreasService {
  constructor(@Inject(PRISMA_CLIENT) private prisma: PrismaClient) {}

  async findAll(eventId: string) {
    return this.prisma.area.findMany({
      where: eventId ? { eventId } : undefined,
      orderBy: { sortOrder: "asc" },
    });
  }

  async create(data: CreateAreaDto) {
    const event = await this.prisma.event.findUnique({
      where: { id: data.eventId },
      select: { id: true },
    });
    if (!event) {
      throw new BadRequestException(
        "Die gewählte Veranstaltung existiert nicht.",
      );
    }
    return this.prisma.area.create({
      data: {
        name: data.name,
        sortOrder: data.sortOrder ?? 0,
        eventId: data.eventId,
      },
    });
  }

  async update(id: string, data: UpdateAreaDto) {
    const area = await this.prisma.area.findUnique({ where: { id } });
    if (!area) throw new NotFoundException("Area not found");

    return this.prisma.area.update({
      where: { id },
      data: {
        name: data.name !== undefined ? data.name : undefined,
        sortOrder: data.sortOrder !== undefined ? data.sortOrder : undefined,
      },
    });
  }

  async remove(id: string) {
    const area = await this.prisma.area.findUnique({ where: { id } });
    if (!area) throw new NotFoundException("Area not found");

    return this.prisma.area.delete({ where: { id } });
  }
}
