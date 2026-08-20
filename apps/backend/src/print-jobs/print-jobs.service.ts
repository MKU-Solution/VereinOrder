import {
  BadRequestException,
  Injectable,
  Inject,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, PrismaClient, PrintJob, Printer } from "@vereinorder/database";
import { PRISMA_CLIENT } from "../prisma/prisma.module";

@Injectable()
export class PrintJobsService {
  constructor(@Inject(PRISMA_CLIENT) private prisma: PrismaClient) {}

  async claimNextJob(): Promise<(PrintJob & { printer: Printer }) | null> {
    return this.prisma.$transaction(async (prisma) => {
      const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
        UPDATE "PrintJob"
        SET
          "status" = 'PROCESSING',
          "errorMessage" = NULL,
          "updatedAt" = NOW()
        WHERE "id" = (
          SELECT "id"
          FROM "PrintJob"
          WHERE "status" = 'PENDING'
             OR (
               "status" = 'PROCESSING'
               AND "updatedAt" < NOW() - INTERVAL '5 minutes'
             )
          ORDER BY "createdAt" ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        RETURNING "id"
      `);
      const id = rows[0]?.id;
      if (!id) return null;

      return prisma.printJob.findUniqueOrThrow({
        where: { id },
        include: { printer: true },
      });
    });
  }

  async updateJobStatus(
    id: string,
    status: string,
    errorMessage?: string,
  ): Promise<PrintJob> {
    if (!["PRINTED", "FAILED"].includes(status)) {
      throw new BadRequestException("Invalid terminal print-job status");
    }
    const updated = await this.prisma.printJob.updateMany({
      where: { id, status: "PROCESSING" },
      data: {
        status: status as "PRINTED" | "FAILED",
        errorMessage,
      },
    });
    if (updated.count === 0) {
      const exists = await this.prisma.printJob.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!exists) throw new NotFoundException("Print job not found");
      throw new BadRequestException("Print job is not reserved by a worker");
    }
    return (await this.prisma.printJob.findUnique({ where: { id } }))!;
  }

  async findAllPrinters(): Promise<Printer[]> {
    return this.prisma.printer.findMany({
      include: { stations: true },
      orderBy: { name: "asc" },
    });
  }

  async createPrinter(data: {
    name: string;
    type: string;
    ipAddress?: string;
    port?: number;
  }): Promise<Printer> {
    return this.prisma.printer.create({ data });
  }

  async updatePrinter(id: string, data: any): Promise<Printer> {
    return this.prisma.printer.update({
      where: { id },
      data,
    });
  }

  async createTestJob(printerId: string): Promise<PrintJob> {
    const printer = await this.prisma.printer.findUnique({
      where: { id: printerId },
    });
    if (!printer) throw new NotFoundException("Printer not found");

    return this.prisma.printJob.create({
      data: {
        printerId,
        jobType: "RECEIPT",
        content: {
          title: "TEST-DRUCK",
          printerName: printer.name,
          printerType: printer.type,
          timestamp: new Date().toISOString(),
          message: "Druckerschnittstelle erfolgreich verbunden!",
        },
      },
    });
  }
}
