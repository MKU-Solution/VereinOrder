import { Type } from "class-transformer";
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
  ValidateNested,
} from "class-validator";
import {
  Int32,
  NonNegativeInt32,
} from "../../common/validation/validation-decorators";

export const VoucherFundingMethod = { CASH: "CASH", CARD: "CARD" } as const;
export type VoucherFundingMethod =
  (typeof VoucherFundingMethod)[keyof typeof VoucherFundingMethod];

export class IssueValueVoucherDto {
  @IsUUID("4")
  eventId: string;

  @IsUUID("4")
  cashierSessionId: string;

  /**
   * Der Kassenplatz waehlt den konkreten aktiven Drucker. Eine globale
   * Default-Auswahl waere bei mehreren Kassen nicht nachvollziehbar.
   */
  @IsOptional()
  @IsUUID("4")
  printerId?: string;

  @Int32()
  @Min(1)
  amount: number;

  @IsEnum(VoucherFundingMethod)
  fundingMethod: VoucherFundingMethod;

  @IsOptional()
  @NonNegativeInt32()
  tenderedAmount?: number;

  @IsString()
  @Length(8, 128)
  idempotencyKey: string;
}

export class VoucherRemainderPaymentDto {
  @IsEnum(VoucherFundingMethod)
  method: VoucherFundingMethod;

  @IsOptional()
  @NonNegativeInt32()
  tenderedAmount?: number;
}

export class RedeemValueVoucherDto {
  @IsUUID("4")
  eventId: string;

  @IsUUID("4")
  cashierSessionId: string;

  @IsUUID("4")
  orderId: string;

  @IsString()
  @Length(8, 40)
  code: string;

  @IsOptional()
  @IsUUID("4")
  printerId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => VoucherRemainderPaymentDto)
  remainderPayment?: VoucherRemainderPaymentDto;

  @IsString()
  @Length(8, 128)
  idempotencyKey: string;
}

export class ValueVoucherQueryDto {
  @IsUUID("4")
  eventId: string;

  @IsUUID("4")
  cashierSessionId: string;

  @IsUUID("4")
  @IsOptional()
  orderId?: string;

  @IsString()
  @Length(8, 40)
  code: string;
}

export class CancelValueVoucherDto {
  @IsUUID("4")
  eventId: string;

  @IsUUID("4")
  cashierSessionId: string;

  @IsString()
  @Length(8, 40)
  code: string;

  @IsString()
  @Length(8, 128)
  idempotencyKey: string;

  @IsString()
  @Length(1, 500)
  reason: string;
}
