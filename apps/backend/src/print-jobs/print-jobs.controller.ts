import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Patch,
  Param,
  Body,
  Request,
  UseGuards,
} from "@nestjs/common";
import {
  PrinterInput,
  PrintAttemptPhaseTarget,
  PrintJobsService,
  ReportOutcomeInput,
  ResolveJobInput,
} from "./print-jobs.service";
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
    @Param("id") id: string,
    @Body("leaseId") leaseId: string,
    @Body("phase") phase: PrintAttemptPhaseTarget,
    @Body("cupsJobId") cupsJobId?: number,
  ) {
    return this.printJobsService.transitionPhase(id, leaseId, phase, cupsJobId);
  }

  @Post(":id/heartbeat")
  @HttpCode(HttpStatus.OK)
  @UseGuards(PrintWorkerGuard)
  async heartbeat(@Param("id") id: string, @Body("leaseId") leaseId: string) {
    return this.printJobsService.heartbeat(id, leaseId);
  }

  @Patch(":id/status")
  @UseGuards(PrintWorkerGuard)
  async reportOutcome(
    @Param("id") id: string,
    @Body() body: ReportOutcomeInput,
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
    @Param("id") id: string,
    @Body() body: ResolveJobInput,
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
  async createPrinter(@Request() req, @Body() data: PrinterInput) {
    return this.printJobsService.createPrinter(data, req.user?.userId);
  }

  @Patch("printers/:id")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("ADMINISTRATOR", "EVENT_MANAGER")
  async updatePrinter(
    @Request() req,
    @Param("id") id: string,
    @Body() data: PrinterInput,
  ) {
    return this.printJobsService.updatePrinter(id, data, req.user?.userId);
  }

  @Post("printers/:id/test")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("ADMINISTRATOR", "EVENT_MANAGER")
  async testPrinter(@Param("id") id: string) {
    return this.printJobsService.createTestJob(id);
  }
}
