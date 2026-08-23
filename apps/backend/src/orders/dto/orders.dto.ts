import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  Equals,
  IsArray,
  IsBoolean,
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
  Quantity,
  TrimmedText,
} from "../../common/validation/validation-decorators";

export const PaymentInputMethod = {
  CASH: "CASH",
  CARD: "CARD",
  VOUCHER: "VOUCHER",
} as const;

export type PaymentInputMethod =
  (typeof PaymentInputMethod)[keyof typeof PaymentInputMethod];

const QuickSalePaymentMethod = {
  CASH: PaymentInputMethod.CASH,
  CARD: PaymentInputMethod.CARD,
} as const;

export class OrderItemInputDto {
  @IsUUID("4")
  productId: string;

  @Quantity()
  quantity: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID("4", { each: true })
  optionIds?: string[];
}

export class PaymentInputDto {
  @Int32()
  @Min(1)
  amount: number;

  @IsEnum(PaymentInputMethod)
  method: PaymentInputMethod;
}

export class CreateOrderDto {
  @IsUUID("4")
  eventId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => OrderItemInputDto)
  items: OrderItemInputDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PaymentInputDto)
  payments?: PaymentInputDto[];

  @IsOptional()
  @IsString()
  @Length(8, 128)
  idempotencyKey?: string;

  @IsOptional()
  @TrimmedText(200)
  tableName?: string;

  @IsOptional()
  @IsUUID("4")
  areaId?: string;

  @IsOptional()
  @IsUUID("4")
  cashierSessionId?: string;
}

export class CreateQuickSaleDto {
  @IsUUID("4")
  eventId: string;

  @IsString()
  @Length(8, 128)
  idempotencyKey: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => OrderItemInputDto)
  items: OrderItemInputDto[];

  @IsEnum(QuickSalePaymentMethod)
  paymentMethod: "CASH" | "CARD";

  @IsOptional()
  @NonNegativeInt32()
  tenderedAmount?: number;
}

export class CreateStationSaleDto {
  @IsUUID("4")
  eventId: string;

  @IsString()
  @Length(8, 128)
  idempotencyKey: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => OrderItemInputDto)
  items: OrderItemInputDto[];

  @Equals(PaymentInputMethod.CASH)
  paymentMethod: "CASH";

  @IsOptional()
  @NonNegativeInt32()
  tenderedAmount?: number;

  @IsUUID("4")
  stationId: string;
}

export type QuickSaleServiceDto = CreateQuickSaleDto & {
  stationId?: string;
};

export class DiscardOfflineQueueDto {
  @IsString()
  @Length(8, 128)
  idempotencyKey: string;

  @TrimmedText(500)
  reason: string;

  @IsOptional()
  @IsUUID("4")
  capturedByUserId?: string | null;

  @IsOptional()
  @IsBoolean()
  legacy?: boolean;

  @IsOptional()
  @IsUUID("4")
  eventId?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PaymentInputDto)
  payments?: PaymentInputDto[];

  @IsOptional()
  @NonNegativeInt32()
  totalAtCapture?: number | null;
}

export class AddPaymentsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PaymentInputDto)
  payments: PaymentInputDto[];
}

export class CancelOrderDto {
  @TrimmedText(500)
  reason: string;
}

export class UpdatePriorityDto {
  @IsBoolean()
  isPriority: boolean;
}
