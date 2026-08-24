import { Module } from "@nestjs/common";
import { BackupService } from "./backup.service";
import { BackupController } from "./backup.controller";
import { NativeBackupService } from "./native-backup.service";
import { PostgreSqlBackupTools } from "./postgresql-backup.tools";
import { NativeRestoreService } from "./native-restore.service";
import { RestoreProcessRestartService } from "./restore-process-restart.service";

@Module({
  controllers: [BackupController],
  providers: [
    BackupService,
    NativeBackupService,
    PostgreSqlBackupTools,
    RestoreProcessRestartService,
    NativeRestoreService,
  ],
  exports: [BackupService, NativeBackupService],
})
export class BackupModule {}
