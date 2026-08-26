import {
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsUUID,
  Min,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { NonNegativeInt32 } from "../../common/validation/validation-decorators";

export class StartSessionDto {
  @IsUUID("4")
  eventId: string;

  @NonNegativeInt32()
  startingBalance: number;
}

export class OfflineQueueWarningDto {
  @IsBoolean()
  hasOpenOrders: boolean;

  @IsInt()
  @Min(0)
  openCount: number;

  @IsInt()
  @Min(0)
  openTotalCents: number;

  @IsBoolean()
  acknowledged: boolean;
}

export class CloseSessionDto {
  @NonNegativeInt32()
  closingBalance: number;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => OfflineQueueWarningDto)
  offlineQueueWarning?: OfflineQueueWarningDto;
}
