import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Patch,
  Param,
  ParseUUIDPipe,
  Body,
  Request,
  UseGuards,
} from "@nestjs/common";
import { PrintJobsService } from "./print-jobs.service";
import {
  CreatePrinterDto,
  PrintHeartbeatDto,
  ReportPrintOutcomeDto,
  ResolvePrintJobDto,
  TransitionPrintPhaseDto,
  UpdatePrinterDto,
} from "./print-jobs.dto";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { PrintWorkerGuard } from "./print-worker.guard";

@Controller("print-jobs")
export class PrintJobsController {
  constructor(private readonly printJobsService: PrintJobsService) {}

  // --- WORKER-VERTRAG (hinter PrintWorkerGuard, Architekturvorgabe 5.5) ---

  @Post("claim")
  @HttpCode(HttpStatus.OK)
  @UseGuards(PrintWorkerGuard)
  async claimNextJob() {
    return this.printJobsService.claimNextJob();
  }

  @Patch(":id/phase")
  @UseGuards(PrintWorkerGuard)
  async transitionPhase(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body() body: TransitionPrintPhaseDto,
  ) {
    return this.printJobsService.transitionPhase(
      id,
      body.leaseId,
      body.phase,
      body.cupsJobId,
    );
  }

  @Post(":id/heartbeat")
  @HttpCode(HttpStatus.OK)
  @UseGuards(PrintWorkerGuard)
  async heartbeat(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body() body: PrintHeartbeatDto,
  ) {
    return this.printJobsService.heartbeat(id, body.leaseId);
  }

  @Patch(":id/status")
  @UseGuards(PrintWorkerGuard)
  async reportOutcome(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body() body: ReportPrintOutcomeDto,
  ) {
    return this.printJobsService.reportOutcome(id, body);
  }

  // --- ADMIN: unklare Druckaufträge (Architekturvorgabe Abschnitt 6.2) ---

  @Get("unresolved")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("ADMINISTRATOR", "EVENT_MANAGER")
  async getUnresolvedJobs() {
    return this.printJobsService.findUnresolvedJobs();
  }

  @Post(":id/resolve")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("ADMINISTRATOR", "EVENT_MANAGER")
  async resolveJob(
    @Request() req,
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body() body: ResolvePrintJobDto,
  ) {
    return this.printJobsService.resolveJob(
      id,
      body,
      req.user?.userId,
      req.user?.role,
    );
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
  async createPrinter(@Request() req, @Body() data: CreatePrinterDto) {
    return this.printJobsService.createPrinter(data, req.user?.userId);
  }

  @Patch("printers/:id")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("ADMINISTRATOR", "EVENT_MANAGER")
  async updatePrinter(
    @Request() req,
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body() data: UpdatePrinterDto,
  ) {
    return this.printJobsService.updatePrinter(id, data, req.user?.userId);
  }

  @Post("printers/:id/test")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("ADMINISTRATOR", "EVENT_MANAGER")
  async testPrinter(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
  ) {
    return this.printJobsService.createTestJob(id);
  }
}
