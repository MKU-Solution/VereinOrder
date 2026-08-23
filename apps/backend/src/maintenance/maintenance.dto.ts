import { IsDateString, IsOptional } from "class-validator";
import { TrimmedText } from "../common/validation/validation-decorators";

export class StartMaintenanceDto {
  @IsOptional()
  @TrimmedText(500)
  reason?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  expectedUntil?: string;
}
