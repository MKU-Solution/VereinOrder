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
  Request,
} from "@nestjs/common";
import { OrdersService } from "./orders.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";

@Controller("orders")
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get("quick-sale/context")
  @Roles("ADMINISTRATOR", "CASHIER")
  async getQuickSaleContext(@Request() req: any) {
    return this.ordersService.getQuickSaleContext(req.user?.userId);
  }

  @Post("quick-sale")
  @Roles("ADMINISTRATOR", "CASHIER")
  async createQuickSale(
    @Request() req: any,
    @Body()
    body: {
      eventId: string;
      idempotencyKey: string;
      items: { productId: string; quantity: number; optionIds?: string[] }[];
      paymentMethod: "CASH" | "CARD";
      tenderedAmount?: number;
    },
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
  async getStationSaleContext(@Request() req: any) {
    return this.ordersService.getStationSaleContext(req.user?.userId);
  }

  @Post("station-sale")
  @Roles("ADMINISTRATOR", "CASHIER", "STATION")
  async createStationSale(
    @Request() req: any,
    @Body()
    body: {
      eventId: string;
      idempotencyKey: string;
      items: { productId: string; quantity: number; optionIds?: string[] }[];
      paymentMethod: "CASH";
      tenderedAmount?: number;
      stationId: string;
    },
  ) {
    return this.ordersService.createQuickSale(req.user?.userId, body);
  }

  @Post()
  @Roles("ADMINISTRATOR", "WAITER", "CASHIER")
  async createOrder(@Request() req: any, @Body() body: any) {
    const userId = req.user?.userId;
    return this.ordersService.createOrder(userId, body);
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
    @Request() req: any,
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
  async discardOfflineQueueEntry(@Request() req: any, @Body() body: any) {
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
    @Request() req: any,
    @Param("id") id: string,
    @Body("payments")
    payments: { amount: number; method: "CASH" | "CARD" | "VOUCHER" }[],
  ) {
    const userId = req.user?.userId;
    return this.ordersService.addPaymentsToOrder(id, payments, userId);
  }

  @Post(":id/reprint")
  @Roles("ADMINISTRATOR", "WAITER", "CASHIER", "STATION")
  async reprintOrder(@Request() req: any, @Param("id") id: string) {
    const userId = req.user?.userId;
    return this.ordersService.reprintOrder(id, userId);
  }

  @Post(":id/cancel")
  @Roles("ADMINISTRATOR", "WAITER", "CASHIER")
  async cancelOrder(
    @Request() req: any,
    @Param("id") id: string,
    @Body("reason") reason: string,
  ) {
    const userId = req.user?.userId;
    return this.ordersService.cancelOrder(id, reason, userId);
  }

  @Post("items/:itemId/cancel")
  @Roles("ADMINISTRATOR", "WAITER", "CASHIER")
  async cancelOrderItem(
    @Request() req: any,
    @Param("itemId") itemId: string,
    @Body("reason") reason: string,
  ) {
    const userId = req.user?.userId;
    return this.ordersService.cancelOrderItem(itemId, reason, userId);
  }

  @Patch(":id/priority")
  @Roles("ADMINISTRATOR", "WAITER", "CASHIER", "STATION")
  async updatePriority(
    @Param("id") id: string,
    @Body("isPriority") isPriority: boolean,
  ) {
    return this.ordersService.updatePriority(id, isPriority);
  }
}
