import { Injectable, Inject } from '@nestjs/common';
import { PrismaClient, PrintJob } from '@vereinorder/database';
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
}
