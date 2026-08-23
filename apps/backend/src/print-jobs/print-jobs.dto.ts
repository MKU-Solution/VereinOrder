import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import {
  PrinterInput,
  ReportOutcomeInput,
  ResolveJobInput,
  SUPPORTED_CODEPAGES,
  SUPPORTED_CUT_MODES,
  SUPPORTED_PAPER_WIDTHS,
  SUPPORTED_PRINTER_TYPES,
} from "./print-jobs.service";
import {
  NonNegativeInt32,
  TrimmedText,
} from "../common/validation/validation-decorators";

const PHASES = ["DELIVERING", "SPOOLED"] as const;
const OUTCOMES = ["PRINTED", "NOT_PRINTED", "UNCLEAR"] as const;
const RESOLUTIONS = ["REPRINTED", "CONFIRMED_PRINTED", "DISCARDED"] as const;

export class TransitionPrintPhaseDto {
  @IsUUID("4")
  leaseId: string;

  @IsIn(PHASES)
  phase: (typeof PHASES)[number];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2_147_483_647)
  cupsJobId?: number;
}

export class PrintHeartbeatDto {
  @IsUUID("4")
  leaseId: string;
}

export class ReportPrintOutcomeDto implements ReportOutcomeInput {
  @IsUUID("4")
  leaseId: string;

  @IsIn(OUTCOMES)
  outcome: (typeof OUTCOMES)[number];

  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MaxLength(100)
  errorCode?: string | null;

  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MaxLength(2_000)
  errorMessage?: string | null;

  @IsOptional()
  @NonNegativeInt32()
  bytesWritten?: number | null;

  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MaxLength(100)
  cupsJobState?: string | null;
}

export class ResolvePrintJobDto implements ResolveJobInput {
  @IsIn(RESOLUTIONS)
  resolution: (typeof RESOLUTIONS)[number];

  @IsOptional()
  @IsUUID("4")
  targetPrinterId?: string | null;

  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MaxLength(500)
  comment?: string | null;
}

class PrinterOptionalFieldsDto implements PrinterInput {
  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MaxLength(255)
  @Matches(/^[A-Za-z0-9._-]+$/)
  ipAddress?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65_535)
  port?: number | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsIn(SUPPORTED_PAPER_WIDTHS)
  paperWidth?: number;

  @IsOptional()
  @IsIn(SUPPORTED_CODEPAGES)
  codepage?: string;

  @IsOptional()
  @IsIn(SUPPORTED_CUT_MODES)
  cutMode?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(9)
  copies?: number;

  @IsOptional()
  @IsInt()
  @Min(250)
  @Max(120_000)
  timeoutMs?: number;

  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MaxLength(200)
  @Matches(/^[A-Za-z0-9_-]+$/)
  queueName?: string | null;

  @IsOptional()
  @IsUUID("4")
  fallbackPrinterId?: string | null;
}

export class CreatePrinterDto extends PrinterOptionalFieldsDto {
  @TrimmedText(200)
  declare name: string;

  @IsIn(SUPPORTED_PRINTER_TYPES)
  declare type: string;
}

export class UpdatePrinterDto extends PrinterOptionalFieldsDto {
  @IsOptional()
  @TrimmedText(200)
  name?: string;

  @IsOptional()
  @IsIn(SUPPORTED_PRINTER_TYPES)
  type?: string;
}
