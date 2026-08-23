import { IsUUID } from "class-validator";
import { NonNegativeInt32 } from "../../common/validation/validation-decorators";

export class StartSessionDto {
  @IsUUID("4")
  eventId: string;

  @NonNegativeInt32()
  startingBalance: number;
}

export class CloseSessionDto {
  @NonNegativeInt32()
  closingBalance: number;
}
