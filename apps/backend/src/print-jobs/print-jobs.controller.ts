import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
} from "@nestjs/common";
import { PrinterInput, PrintJobsService } from "./print-jobs.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { PrintWorkerGuard } from "./print-worker.guard";

@Controller("print-jobs")
export class PrintJobsController {
  constructor(private readonly printJobsService: PrintJobsService) {}

  @Post("claim")
  @HttpCode(HttpStatus.OK)
  @UseGuards(PrintWorkerGuard)
  async claimNextJob() {
    return this.printJobsService.claimNextJob();
  }

  @Patch(":id/status")
  @UseGuards(PrintWorkerGuard)
  async updateStatus(
    @Param("id") id: string,
    @Body("status") status: string,
    @Body("errorMessage") errorMessage?: string,
  ) {
    return this.printJobsService.updateJobStatus(id, status, errorMessage);
  }

  /**
   * Ergebnis eines einzelnen Auftrags. Die Administration fragt damit den
   * Ausgang eines Testdrucks ab; die Rollenprüfung erfolgt im Backend.
   */
  @Get(":id/status")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("ADMINISTRATOR", "EVENT_MANAGER")
  async getJobStatus(@Param("id") id: string) {
    return this.printJobsService.findJobStatus(id);
  }

  // --- ADMIN PRINTER MANAGEMENT ---

  @Get("printers")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("ADMINISTRATOR", "EVENT_MANAGER")
  async getPrinters() {
    return this.printJobsService.findAllPrinters();
  }

  @Post("printers")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("ADMINISTRATOR", "EVENT_MANAGER")
  async createPrinter(@Body() data: PrinterInput) {
    return this.printJobsService.createPrinter(data);
  }

  @Patch("printers/:id")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("ADMINISTRATOR", "EVENT_MANAGER")
  async updatePrinter(@Param("id") id: string, @Body() data: PrinterInput) {
    return this.printJobsService.updatePrinter(id, data);
  }

  @Post("printers/:id/test")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("ADMINISTRATOR", "EVENT_MANAGER")
  async testPrinter(@Param("id") id: string) {
    return this.printJobsService.createTestJob(id);
  }
}
