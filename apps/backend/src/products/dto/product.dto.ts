import { Type, Transform } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
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
  ValidateNested,
} from "class-validator";
import {
  ProductAvailability,
  ProductOptionPriceMode,
  ProductOptionSelectionType,
} from "@vereinorder/database";

const trim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

class ProductOptionDto {
  @IsOptional() @IsUUID("4") id?: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(200) name: string;
  @IsInt() @Min(-1000000) @Max(1000000) priceEffect: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsInt() @Min(0) @Max(2147483647) sortOrder: number;
}

class ProductOptionGroupDto {
  @IsOptional() @IsUUID("4") id?: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(200) name: string;
  @IsEnum(ProductOptionSelectionType) selectionType: ProductOptionSelectionType;
  @IsBoolean() isRequired: boolean;
  @IsInt() @Min(0) @Max(2147483647) minSelect: number;
  @IsOptional() @IsInt() @Min(1) @Max(2147483647) maxSelect: number | null;
  @IsEnum(ProductOptionPriceMode) priceMode: ProductOptionPriceMode;
  @IsBoolean() quickSaleTiles: boolean;
  @IsInt() @Min(0) @Max(2147483647) sortOrder: number;
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ProductOptionDto)
  options: ProductOptionDto[];
}

class ProductFieldsDto {
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
  @MaxLength(2000)
  description?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(2147483647) price?: number;
  @IsOptional() @IsInt() @Min(0) @Max(2147483647) deposit?: number;
  @IsOptional() @IsInt() @Min(0) @Max(2147483647) taxRate?: number;
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  color?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(2147483647) sortOrder?: number;
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  imageUrl?: string | null;
  @IsOptional() @IsEnum(ProductAvailability) availability?: ProductAvailability;
  @IsOptional() @IsUUID("4") categoryId?: string;
  @IsOptional() @IsUUID("4") targetStationId?: string | null;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ProductOptionGroupDto)
  optionGroups?: ProductOptionGroupDto[];
}

export class CreateProductDto extends ProductFieldsDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(200) name: string;
  @IsInt() @Min(0) @Max(2147483647) price: number;
  @IsUUID("4") categoryId: string;
  @IsUUID("4") eventId: string;
}
export class UpdateProductDto extends ProductFieldsDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;
}

export class UpdateAvailabilityDto {
  @IsEnum(ProductAvailability) availability: ProductAvailability;
}

class CategoryFieldsDto {
  @IsOptional() @IsInt() @Min(0) @Max(2147483647) sortOrder?: number;
  @IsOptional() @IsInt() @Min(0) @Max(2147483647) deposit?: number;
  @IsOptional() @IsUUID("4") targetStationId?: string | null;
}
export class CreateCategoryDto extends CategoryFieldsDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(200) name: string;
  @IsUUID("4") eventId: string;
}
export class UpdateCategoryDto extends CategoryFieldsDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;
}
