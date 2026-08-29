import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { OperationalDataMode } from "@vereinorder/database";

const trim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;
export class InventoryModeDto {
  @IsUUID("4") eventId: string;
  @IsEnum(OperationalDataMode) dataMode: OperationalDataMode;
}
export class InitializeInventoryDto extends InventoryModeDto {
  @IsInt() @Min(0) @Max(2147483647) quantity: number;
  @IsInt() @Min(0) @Max(2147483647) lowStockThreshold: number;
  @IsOptional() @IsBoolean() trackingEnabled?: boolean;
  @IsOptional() @IsBoolean() manualBlocked?: boolean;
  @IsString() @IsNotEmpty() @MaxLength(128) idempotencyKey: string;
}
export class UpdateInventorySettingsDto extends InventoryModeDto {
  @IsOptional() @IsInt() @Min(0) @Max(2147483647) lowStockThreshold?: number;
  @IsOptional() @IsBoolean() manualBlocked?: boolean;
}
export class CorrectInventoryDto extends InventoryModeDto {
  @IsInt() @Min(0) @Max(2147483647) quantity: number;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(500) reason: string;
  @IsString() @IsNotEmpty() @MaxLength(128) idempotencyKey: string;
}
