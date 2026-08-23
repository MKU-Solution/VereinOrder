import {
  Controller,
  Get,
  Post,
  Param,
  UseGuards,
  Request,
  Res,
} from "@nestjs/common";
import { BackupService } from "./backup.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { MaintenancePublic } from "../maintenance/maintenance.decorator";
import * as fs from "fs";

// Issue #67: "alles unter /backup" bleibt laut Entwurf Abschnitt 6 auch bei
// LOCKED erreichbar, weiterhin nur fuer ADMINISTRATOR (JwtAuthGuard +
// RolesGuard unten bleiben unveraendert in Kraft) - der Wartungsmodus nimmt
// nur die eigene Sperre zurueck, nicht Anmeldung oder Rolle.
@MaintenancePublic()
@Controller("backup")
@UseGuards(JwtAuthGuard, RolesGuard)
export class BackupController {
  constructor(private readonly backupService: BackupService) {}

  @Post("create")
  @Roles("ADMINISTRATOR")
  async createBackup(@Request() req: any) {
    const userId = req.user?.userId;
    return this.backupService.createBackup(userId);
  }

  @Get("list")
  @Roles("ADMINISTRATOR")
  async listBackups() {
    return this.backupService.listBackups();
  }

  @Get("download/:filename")
  @Roles("ADMINISTRATOR")
  async downloadBackup(@Param("filename") filename: string, @Res() res: any) {
    const filePath = this.backupService.getBackupFilePath(filename);
    const stat = fs.statSync(filePath);

    if (res.header) {
      res.header("Content-Type", "application/json; charset=utf-8");
      res.header("Content-Disposition", `attachment; filename="${filename}"`);
      res.header("Content-Length", stat.size);
    } else if (res.setHeader) {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`,
      );
      res.setHeader("Content-Length", stat.size);
    }

    const stream = fs.createReadStream(filePath);
    return res.send ? res.send(stream) : stream.pipe(res);
  }

  @Post("restore/:filename")
  @Roles("ADMINISTRATOR")
  async restoreBackup(
    @Request() req: any,
    @Param("filename") filename: string,
  ) {
    const userId = req.user?.userId;
    return this.backupService.restoreBackup(filename, userId);
  }
}
