import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
  ParseUUIDPipe,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import {
  CorrectInventoryDto,
  InitializeInventoryDto,
  InventoryModeDto,
  UpdateInventorySettingsDto,
} from "./inventory.dto";
import { InventoryService } from "./inventory.service";
@Controller("inventory/products")
@UseGuards(JwtAuthGuard, RolesGuard)
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}
  @Get(":productId")
  @Roles("ADMINISTRATOR", "EVENT_MANAGER", "WAITER", "CASHIER", "STATION")
  detail(
    @Param("productId", new ParseUUIDPipe({ version: "4" })) id: string,
    @Query() q: InventoryModeDto,
  ) {
    return this.inventory.detail(id, q.eventId, q.dataMode);
  }
  @Get(":productId/history") @Roles("ADMINISTRATOR", "EVENT_MANAGER") history(
    @Param("productId", new ParseUUIDPipe({ version: "4" })) id: string,
    @Query() q: InventoryModeDto,
  ) {
    return this.inventory.history(id, q.eventId, q.dataMode);
  }
  @Post(":productId/initialize")
  @Roles("ADMINISTRATOR", "EVENT_MANAGER")
  initialize(
    @Request() r: any,
    @Param("productId", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body() b: InitializeInventoryDto,
  ) {
    return this.inventory.initialize(id, b, r.user.userId);
  }
  @Patch(":productId/settings")
  @Roles("ADMINISTRATOR", "EVENT_MANAGER")
  settings(
    @Request() r: any,
    @Param("productId", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body() b: UpdateInventorySettingsDto,
  ) {
    return this.inventory.settings(id, b, r.user.userId);
  }
  @Post(":productId/correction")
  @Roles("ADMINISTRATOR", "EVENT_MANAGER")
  correction(
    @Request() r: any,
    @Param("productId", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body() b: CorrectInventoryDto,
  ) {
    return this.inventory.correction(id, b, r.user.userId);
  }
}
