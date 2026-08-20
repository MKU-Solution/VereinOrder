import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { PrismaClient, PrintJob, Printer } from '@vereinorder/database';
import { PRISMA_CLIENT } from '../prisma/prisma.module';

@Injectable()
export class PrintJobsService {
  constructor(@Inject(PRISMA_CLIENT) private prisma: PrismaClient) {}

  async getPendingJobs(): Promise<PrintJob[]> {
    return this.prisma.printJob.findMany({
      where: { status: 'PENDING' },
      include: { printer: true },
      orderBy: { createdAt: 'asc' }
    });
  }

  async updateJobStatus(id: string, status: string, errorMessage?: string): Promise<PrintJob> {
    return this.prisma.printJob.update({
      where: { id },
      data: {
        status: status as any,
        errorMessage
      }
    });
  }

  async findAllPrinters(): Promise<Printer[]> {
    return this.prisma.printer.findMany({
      include: { stations: true },
      orderBy: { name: 'asc' }
    });
  }

  async createPrinter(data: { name: string; type: string; ipAddress?: string; port?: number }): Promise<Printer> {
    return this.prisma.printer.create({ data });
  }

  async updatePrinter(id: string, data: any): Promise<Printer> {
    return this.prisma.printer.update({
      where: { id },
      data
    });
  }

  async createTestJob(printerId: string): Promise<PrintJob> {
    const printer = await this.prisma.printer.findUnique({ where: { id: printerId } });
    if (!printer) throw new NotFoundException('Printer not found');

    return this.prisma.printJob.create({
      data: {
        printerId,
        jobType: 'RECEIPT',
        content: {
          title: 'TEST-DRUCK',
          printerName: printer.name,
          printerType: printer.type,
          timestamp: new Date().toISOString(),
          message: 'Druckerschnittstelle erfolgreich verbunden!'
        }
      }
    });
  }
}
