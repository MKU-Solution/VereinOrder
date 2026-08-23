import { Module } from "@nestjs/common";
import { BackupService } from "./backup.service";
import { BackupController } from "./backup.controller";
import { NativeBackupService } from "./native-backup.service";
import { PostgreSqlBackupTools } from "./postgresql-backup.tools";

@Module({
  controllers: [BackupController],
  providers: [BackupService, NativeBackupService, PostgreSqlBackupTools],
  exports: [BackupService, NativeBackupService],
})
export class BackupModule {}
