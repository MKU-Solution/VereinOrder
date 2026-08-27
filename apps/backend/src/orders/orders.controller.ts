import {
  BadRequestException,
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  UseFilters,
  Request,
  Optional,
} from "@nestjs/common";
import { OrdersService } from "./orders.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { IdParamDto, ItemIdParamDto } from "../common/validation/request.dto";
import {
  AddPaymentsDto,
  CancelOrderDto,
  CreateOrderDto,
  CreateQuickSaleDto,
  CreateStationSaleDto,
  DiscardOfflineQueueDto,
  SplitPaymentDto,
  UpdatePriorityDto,
} from "./dto/orders.dto";
import { OrderSubmissionExceptionFilter } from "./order-submission-exception.filter";
import { RealtimeService } from "../realtime/realtime.service";

interface AuthenticatedRequest {
  user?: { userId?: string; role?: string };
}

@Controller("orders")
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    @Optional() private readonly realtimeService?: RealtimeService,
  ) {}

  private broadcastTableStatus(order: any) {
    if (!order?.eventId || !order?.areaId || !order?.tableName) return;
    this.realtimeService?.broadcast(order.eventId, "TABLE_STATUS_CHANGED", {
      areaId: order.areaId,
      tableName: order.tableName,
    });
  }

  @Get("quick-sale/context")
  @Roles("ADMINISTRATOR", "CASHIER")
  async getQuickSaleContext(@Request() req: AuthenticatedRequest) {
    return this.ordersService.getQuickSaleContext(req.user?.userId);
  }

  @Post("quick-sale")
  @Roles("ADMINISTRATOR", "CASHIER")
  async createQuickSale(
    @Request() req: AuthenticatedRequest,
    @Body() body: CreateQuickSaleDto,
  ) {
    // Stationskasse (Issue #66, docs/development/stationskasse.md
    // Abschnitt 2): stationId ist ausschließlich über POST
    // /orders/station-sale erreichbar. Ein stationId im Rumpf dieses
    // Endpunkts wird abgewiesen, sonst wäre der Stationsmodus über den
    // falschen, für STATION nicht zugänglichen Endpunkt erreichbar.
    if ((body as { stationId?: unknown })?.stationId !== undefined) {
      throw new BadRequestException(
        "Der zentrale Schnellverkauf akzeptiert kein stationId. Bitte den Stationsverkauf unter /orders/station-sale verwenden.",
      );
    }
    return this.ordersService.createQuickSale(req.user?.userId, body);
  }

  // Stationskasse (Issue #66): eigener Endpunkt für die Rollenmatrix
  // (zusätzlich STATION), leitet aber auf denselben Service wie
  // /quick-sale. createQuickSale bleibt die einzige Stelle, an der ein
  // bezahlter Bonverkauf entsteht - siehe
  // docs/development/stationskasse.md, Abschnitt 2.
  @Get("station-sale/context")
  @Roles("ADMINISTRATOR", "CASHIER", "STATION")
  async getStationSaleContext(@Request() req: AuthenticatedRequest) {
    return this.ordersService.getStationSaleContext(req.user?.userId);
  }

  @Post("station-sale")
  @Roles("ADMINISTRATOR", "CASHIER", "STATION")
  async createStationSale(
    @Request() req: AuthenticatedRequest,
    @Body() body: CreateStationSaleDto,
  ) {
    return this.ordersService.createQuickSale(req.user?.userId, body);
  }

  @Post()
  @Roles("ADMINISTRATOR", "WAITER", "CASHIER")
  @UseFilters(OrderSubmissionExceptionFilter)
  async createOrder(
    @Request() req: AuthenticatedRequest,
    @Body() body: CreateOrderDto,
  ) {
    const userId = req.user?.userId;
    const order = await this.ordersService.createOrder(userId, body);
    this.broadcastTableStatus(order);
    return order;
  }

  // Issue #65, Abschnitt 7 und Abschnitt 8 Punkte 1 und 2: die beiden
  // folgenden Rollenlisten haengen zusammen und muessen es bleiben. Das
  // Verwerfen (POST offline-queue/discard, unten) verlangt laut Abschnitt 7
  // zwingend den Serverkontakt dieser Auskunft (GET by-idempotency-key/:key)
  // davor. Jede Rolle, die dort verwerfen darf, muss deshalb auch hier die
  // Auskunft abrufen duerfen - sonst scheitert eine erlaubte Rolle schon am
  // vorgeschriebenen Vorlauf mit 403 und erreicht das Verwerfen nie. Die
  // Auskunft darf umgekehrt mehr Rollen zulassen als das Verwerfen; das ist
  // keine Luecke. EVENT_MANAGER steht deshalb in beiden Listen -
  // Entscheidung 11.5 gibt ihm das Verwerfen uebernommener Altbestaende,
  // und der Service behandelt ihn hier ohnehin schon als jemanden, der
  // fremde Eintraege sehen darf (siehe canSeeForeignOrders in
  // getOrderByIdempotencyKey, orders.service.ts).
  @Get("by-idempotency-key/:key")
  @Roles("ADMINISTRATOR", "EVENT_MANAGER", "WAITER", "CASHIER")
  async getOrderByIdempotencyKey(
    @Request() req: AuthenticatedRequest,
    @Param("key") key: string,
  ) {
    return this.ordersService.getOrderByIdempotencyKey(
      req.user?.userId,
      req.user?.role,
      key,
    );
  }

  // Rollenliste ist eine Teilmenge der Liste bei getOrderByIdempotencyKey
  // oben, und muss es bleiben (siehe Kommentar dort): jede Rolle hier
  // braucht zwingend Zugriff auf die Auskunft davor. Die feingranulare
  // Pruefung - wer im Einzelfall verwerfen darf, abhaengig von Herkunft
  // (legacy) und Zahlungen - liegt im Service (discardOfflineQueueEntry),
  // nicht im Rollen-Gate.
  @Post("offline-queue/discard")
  @Roles("ADMINISTRATOR", "EVENT_MANAGER", "WAITER", "CASHIER")
  async discardOfflineQueueEntry(
    @Request() req: AuthenticatedRequest,
    @Body() body: DiscardOfflineQueueDto,
  ) {
    return this.ordersService.discardOfflineQueueEntry(
      req.user?.userId,
      req.user?.role,
      body,
    );
  }

  @Get("unpaid")
  @Roles("ADMINISTRATOR", "WAITER", "CASHIER")
  async getUnpaidOrders(@Query("eventId") eventId: string) {
    return this.ordersService.getUnpaidOrders(eventId);
  }

  @Post(":id/payments")
  @Roles("ADMINISTRATOR", "WAITER", "CASHIER")
  async addPayments(
    @Request() req: AuthenticatedRequest,
    @Param() params: IdParamDto,
    @Body() body: AddPaymentsDto,
  ) {
    const userId = req.user?.userId;
    const order = await this.ordersService.addPaymentsToOrder(
      params.id,
      body.payments,
      userId,
    );
    this.broadcastTableStatus(order);
    return order;
  }

  @Post(":id/split-payment")
  @Roles("ADMINISTRATOR", "WAITER", "CASHIER")
  async splitPayment(
    @Request() req: AuthenticatedRequest,
    @Param() params: IdParamDto,
    @Body() body: SplitPaymentDto,
  ) {
    const userId = req.user?.userId;
    const order = await this.ordersService.splitPaymentOrder(
      params.id,
      body.items,
      body.payments,
      userId,
    );
    this.broadcastTableStatus(order);
    return order;
  }

  @Post(":id/reprint")
  @Roles("ADMINISTRATOR", "WAITER", "CASHIER", "STATION")
  async reprintOrder(
    @Request() req: AuthenticatedRequest,
    @Param() params: IdParamDto,
  ) {
    const userId = req.user?.userId;
    return this.ordersService.reprintOrder(params.id, userId);
  }

  @Post(":id/cancel")
  @Roles("ADMINISTRATOR", "WAITER", "CASHIER")
  async cancelOrder(
    @Request() req: AuthenticatedRequest,
    @Param() params: IdParamDto,
    @Body() body: CancelOrderDto,
  ) {
    const userId = req.user?.userId;
    const order = await this.ordersService.cancelOrder(
      params.id,
      body.reason,
      userId,
    );
    this.broadcastTableStatus(order);
    return order;
  }

  @Post("items/:itemId/cancel")
  @Roles("ADMINISTRATOR", "WAITER", "CASHIER")
  async cancelOrderItem(
    @Request() req: AuthenticatedRequest,
    @Param() params: ItemIdParamDto,
    @Body() body: CancelOrderDto,
  ) {
    const userId = req.user?.userId;
    const item = await this.ordersService.cancelOrderItem(
      params.itemId,
      body.reason,
      userId,
    );
    this.broadcastTableStatus(item?.order);
    return item;
  }

  @Patch(":id/priority")
  @Roles("ADMINISTRATOR", "WAITER", "CASHIER", "STATION")
  async updatePriority(
    @Param() params: IdParamDto,
    @Body() body: UpdatePriorityDto,
  ) {
    return this.ordersService.updatePriority(params.id, body.isPriority);
  }
}
