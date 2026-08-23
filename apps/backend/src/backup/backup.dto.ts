import { Matches, MaxLength } from "class-validator";

export class BackupFilenameParamDto {
  @MaxLength(255)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/)
  filename: string;
}
