import {
  Equals,
  IsISO8601,
  IsString,
  Matches,
  MaxLength,
} from "class-validator";

export class BackupFilenameParamDto {
  @MaxLength(255)
  @Matches(
    /^(?:vereinorder_[A-Za-z0-9._-]+_(?:manual|schedule|prerestore|premigration)(?:-\d+)?\.(?:dump|manifest\.json)|vereinorder_(?:backup_)?[A-Za-z0-9._-]+\.json)$/,
  )
  filename: string;
}

export class PrepareNativeRestoreDto {
  @IsString()
  @MaxLength(64)
  @IsISO8601({ strict: true, strictSeparator: true })
  confirmedCreatedAt: string;

  @Equals(true)
  queuesConfirmed: true;
}
