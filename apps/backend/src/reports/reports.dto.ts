import { IsEnum, IsUUID } from "class-validator";
import { OperationalDataMode } from "@vereinorder/database";

/**
 * Der Bestandsbericht ist immer an genau eine Veranstaltung und Betriebsart
 * gebunden. Ein optionaler Modus wuerde TEST- und LIVE-Ledger vermischen.
 */
export class InventoryReportQueryDto {
  @IsUUID("4")
  eventId: string;

  @IsEnum(OperationalDataMode)
  dataMode: OperationalDataMode;
}
