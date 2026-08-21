import {
  BadRequestException,
  Injectable,
  Inject,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, PrismaClient, PrintJob, Printer } from "@vereinorder/database";
import { PRISMA_CLIENT } from "../prisma/prisma.module";

/** Druckertypen, die der Print-Worker tatsächlich bedienen kann. */
export const SUPPORTED_PRINTER_TYPES = ["CONSOLE", "ESC_POS_NETWORK"] as const;
export const SUPPORTED_PAPER_WIDTHS = [58, 80];
export const SUPPORTED_CODEPAGES = ["CP437", "CP850", "CP858"];
export const SUPPORTED_CUT_MODES = ["NONE", "PARTIAL", "FULL"];

const HOST_PATTERN = /^[A-Za-z0-9._-]+$/;

export interface PrinterInput {
  name?: string;
  type?: string;
  ipAddress?: string | null;
  port?: number | null;
  isActive?: boolean;
  paperWidth?: number;
  codepage?: string;
  cutMode?: string;
  copies?: number;
  timeoutMs?: number;
}

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

  /**
   * Zustand eines einzelnen Auftrags. Die Administration fragt damit das
   * Ergebnis eines Testdrucks ab, ohne die gesamte Warteschlange zu laden.
   */
  async findJobStatus(id: string) {
    const job = await this.prisma.printJob.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        errorMessage: true,
        jobType: true,
        printerId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!job) throw new NotFoundException("Print job not found");
    return job;
  }

  async findAllPrinters(): Promise<Printer[]> {
    return this.prisma.printer.findMany({
      include: { stations: true },
      orderBy: { name: "asc" },
    });
  }

  async createPrinter(data: PrinterInput): Promise<Printer> {
    const values = this.sanitizePrinter(data, { partial: false });
    return this.prisma.printer.create({ data: values as any });
  }

  async updatePrinter(id: string, data: PrinterInput): Promise<Printer> {
    const existing = await this.prisma.printer.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Printer not found");

    const values = this.sanitizePrinter(data, {
      partial: true,
      existingType: existing.type,
    });
    return this.prisma.printer.update({ where: { id }, data: values as any });
  }

  /**
   * Legt einen Testbon an. Der Auftrag durchläuft dieselbe Warteschlange und
   * denselben Transport wie ein echter Bon, damit der Test aussagekräftig ist.
   */
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
          kind: "TEST_PRINT",
          title: "TEST-DRUCK",
          printerName: printer.name,
          printerType: printer.type,
          paperWidth: printer.paperWidth,
          codepage: printer.codepage,
          timestamp: new Date().toISOString(),
          message: "Druckerschnittstelle erfolgreich verbunden!",
        },
      },
    });
  }

  /**
   * Prüft die Eingaben der Administration. Ein Drucker, den der Worker nicht
   * bedienen kann, darf gar nicht erst gespeichert werden.
   */
  private sanitizePrinter(
    data: PrinterInput,
    options: { partial: boolean; existingType?: string },
  ): PrinterInput {
    const values: PrinterInput = {};
    const has = (key: keyof PrinterInput) =>
      data[key] !== undefined && data[key] !== null;

    if (has("name") || !options.partial) {
      const name = String(data.name ?? "").trim();
      if (name.length === 0) {
        throw new BadRequestException("Der Druckername darf nicht leer sein.");
      }
      values.name = name;
    }

    const providedType =
      data.type !== undefined ? String(data.type).toUpperCase() : undefined;
    if (providedType !== undefined || !options.partial) {
      if (!SUPPORTED_PRINTER_TYPES.includes(providedType as any)) {
        throw new BadRequestException(
          `Druckertyp "${providedType ?? ""}" wird nicht unterstützt. Erlaubt: ${SUPPORTED_PRINTER_TYPES.join(", ")}.`,
        );
      }
      values.type = providedType;
    }

    // Adresse nur prüfen, wenn Typ oder Adresse selbst geändert werden.
    const effectiveType =
      providedType ?? String(options.existingType ?? "").toUpperCase();
    const touchesTransport =
      providedType !== undefined || data.ipAddress !== undefined;

    if (effectiveType === "ESC_POS_NETWORK") {
      if (touchesTransport) {
        const host = String(data.ipAddress ?? "").trim();
        if (host.length === 0) {
          throw new BadRequestException(
            "Netzwerkdrucker brauchen eine IP-Adresse oder einen Hostnamen.",
          );
        }
        if (!HOST_PATTERN.test(host)) {
          throw new BadRequestException(
            `"${host}" ist keine gültige IP-Adresse und kein gültiger Hostname.`,
          );
        }
        values.ipAddress = host;
      }
    } else if (data.ipAddress !== undefined) {
      values.ipAddress = null;
    }

    if (has("port")) {
      values.port = this.expectRange(data.port, "Port", 1, 65535);
    }
    if (has("copies")) {
      values.copies = this.expectRange(data.copies, "Kopienzahl", 1, 9);
    }
    if (has("timeoutMs")) {
      values.timeoutMs = this.expectRange(
        data.timeoutMs,
        "Zeitlimit",
        250,
        120000,
      );
    }
    if (has("paperWidth")) {
      const width = Number(data.paperWidth);
      if (!SUPPORTED_PAPER_WIDTHS.includes(width)) {
        throw new BadRequestException(
          `Papierbreite muss ${SUPPORTED_PAPER_WIDTHS.join(" oder ")} Millimeter sein.`,
        );
      }
      values.paperWidth = width;
    }
    if (has("codepage")) {
      const codepage = String(data.codepage).toUpperCase();
      if (!SUPPORTED_CODEPAGES.includes(codepage)) {
        throw new BadRequestException(
          `Zeichensatz muss einer von ${SUPPORTED_CODEPAGES.join(", ")} sein.`,
        );
      }
      values.codepage = codepage;
    }
    if (has("cutMode")) {
      const cutMode = String(data.cutMode).toUpperCase();
      if (!SUPPORTED_CUT_MODES.includes(cutMode)) {
        throw new BadRequestException(
          `Schnittart muss einer von ${SUPPORTED_CUT_MODES.join(", ")} sein.`,
        );
      }
      values.cutMode = cutMode;
    }
    if (data.isActive !== undefined) {
      values.isActive = Boolean(data.isActive);
    }

    return values;
  }

  private expectRange(
    value: unknown,
    label: string,
    min: number,
    max: number,
  ): number {
    const parsed = Math.trunc(Number(value));
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
      throw new BadRequestException(
        `${label} muss zwischen ${min} und ${max} liegen.`,
      );
    }
    return parsed;
  }
}
