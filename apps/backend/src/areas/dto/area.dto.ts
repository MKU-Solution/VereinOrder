import "reflect-metadata";
import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";

const trim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

export class CreateAreaDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2147483647)
  sortOrder?: number;

  @IsUUID("4")
  eventId: string;
}

export class UpdateAreaDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2147483647)
  sortOrder?: number;
}

export enum FloorPlanElementKind {
  TABLE_RECTANGLE = "TABLE_RECTANGLE",
  TABLE_ROUND = "TABLE_ROUND",
  TABLE_STANDING = "TABLE_STANDING",
  BAR = "BAR",
  STAGE = "STAGE",
  KITCHEN = "KITCHEN",
}

export class FloorPlanElementDto {
  @IsUUID("4")
  id: string;

  @IsEnum(FloorPlanElementKind)
  kind: FloorPlanElementKind;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  label: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  tableName?: string;

  @IsInt()
  @Min(0)
  @Max(960)
  x: number;

  @IsInt()
  @Min(0)
  @Max(660)
  y: number;

  @IsInt()
  @Min(40)
  @Max(400)
  width: number;

  @IsInt()
  @Min(40)
  @Max(300)
  height: number;

  @IsInt()
  @Min(-180)
  @Max(180)
  rotation: number;
}

export class SaveFloorPlanDto {
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => FloorPlanElementDto)
  elements: FloorPlanElementDto[];
}
