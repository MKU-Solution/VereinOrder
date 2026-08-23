import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from "class-validator";

const trim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

class StationFieldsDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(12)
  shortName?: string | null;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  color?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2147483647)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsUUID("4")
  printerId?: string | null;
}

export class CreateStationDto extends StationFieldsDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @IsUUID("4")
  eventId: string;
}

export class UpdateStationDto extends StationFieldsDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;
}

export class UpdateOrderItemStatusDto {
  @IsIn(["PENDING", "PREPARING", "READY", "CANCELLED"])
  status: MutableStationItemStatus;
}

export type MutableStationItemStatus =
  | "PENDING"
  | "PREPARING"
  | "READY"
  | "CANCELLED";
