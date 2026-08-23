import { IsUUID } from "class-validator";

export class IdParamDto {
  @IsUUID("4")
  id: string;
}

export class ItemIdParamDto {
  @IsUUID("4")
  itemId: string;
}

export class OrderIdParamDto {
  @IsUUID("4")
  orderId: string;
}

export class SourceIdParamDto {
  @IsUUID("4")
  sourceId: string;
}
