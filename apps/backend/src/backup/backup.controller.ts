import {
  Controller,
  Get,
  Post,
  Param,
  UseGuards,
  Request,
  Res,
  ConflictException,
} from "@nestjs/common";
import { BackupService } from "./backup.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { MaintenancePublic } from "../maintenance/maintenance.decorator";
import * as fs from "fs";
import { BackupFilenameParamDto } from "./backup.dto";
import { NativeBackupService } from "./native-backup.service";

// Issue #67: "alles unter /backup" bleibt laut Entwurf Abschnitt 6 auch bei
// LOCKED erreichbar, weiterhin nur fuer ADMINISTRATOR (JwtAuthGuard +
// RolesGuard unten bleiben unveraendert in Kraft) - der Wartungsmodus nimmt
// nur die eigene Sperre zurueck, nicht Anmeldung oder Rolle.
@MaintenancePublic()
@Controller("backup")
@UseGuards(JwtAuthGuard, RolesGuard)
export class BackupController {
  constructor(
    private readonly backupService: BackupService,
    private readonly nativeBackupService: NativeBackupService,
  ) {}

  @Post("create")
  @Roles("ADMINISTRATOR")
  async createBackup(@Request() req: any) {
    return this.nativeBackupService.createBackup("MANUAL", {
      userId: req.user.userId,
      username: req.user.username,
    });
  }

  @Get("list")
  @Roles("ADMINISTRATOR")
  async listBackups() {
    return this.nativeBackupService.listBackups();
  }

  @Post("verify-restore/:filename")
  @Roles("ADMINISTRATOR")
  async verifyRestore(
    @Request() req: any,
    @Param() params: BackupFilenameParamDto,
  ) {
    return this.nativeBackupService.verifyRestoration(params.filename, {
      userId: req.user.userId,
      username: req.user.username,
    });
  }

  @Get("download/:filename")
  @Roles("ADMINISTRATOR")
  async downloadBackup(
    @Param() params: BackupFilenameParamDto,
    @Res() res: any,
  ) {
    const { filename } = params;
    const filePath =
      await this.nativeBackupService.getDownloadFilePath(filename);
    const stat = fs.statSync(filePath);
    const contentType = filename.endsWith(".dump")
      ? "application/octet-stream"
      : "application/json; charset=utf-8";

    if (res.header) {
      res.header("Content-Type", contentType);
      res.header("Content-Disposition", `attachment; filename="${filename}"`);
      res.header("Content-Length", stat.size);
    } else if (res.setHeader) {
      res.setHeader("Content-Type", contentType);
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
    @Param() params: BackupFilenameParamDto,
  ) {
    if (
      !params.filename.endsWith(".json") ||
      params.filename.endsWith(".manifest.json")
    ) {
      throw new ConflictException(
        "Native PostgreSQL-Sicherungen können erst mit dem abgesicherten Restore-Folgeschnitt wiederhergestellt werden.",
      );
    }
    const userId = req.user?.userId;
    return this.backupService.restoreBackup(params.filename, userId);
  }
}
