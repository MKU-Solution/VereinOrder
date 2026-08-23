import { Matches, MaxLength } from "class-validator";

export class BackupFilenameParamDto {
  @MaxLength(255)
  @Matches(
    /^(?:vereinorder_[A-Za-z0-9._-]+_(?:manual|schedule|prerestore|premigration)(?:-\d+)?\.(?:dump|manifest\.json)|vereinorder_(?:backup_)?[A-Za-z0-9._-]+\.json)$/,
  )
  filename: string;
}
