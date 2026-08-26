import {
  Injectable,
  Inject,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { PrismaClient, Prisma } from "@vereinorder/database";
import { PRISMA_CLIENT } from "../prisma/prisma.module";
import { randomBytes } from "crypto";
import { resolveTargetStationId } from "../common/target-station";
import { drawPickupNumber } from "../common/pickup-number";
import { AuditService } from "../audit/audit.service";
import {
  ORDER_REJECTION_CODES,
  ORDER_REJECTION_MESSAGES,
} from "@vereinorder/shared";
import {
  CreateOrderDto,
  DiscardOfflineQueueDto,
  PaymentInputDto,
  QuickSaleServiceDto,
  SplitPaymentItemDto,
} from "./dto/orders.dto";
import { orderRejection } from "./order-rejection";

// Snapshot einer aufgeloesten Bestellposition. variantId/variantName/extras
// entsprechen exakt den gleichnamigen OrderItem-Spalten (unveraendert seit
// Issue #75, siehe docs/development/produktoptionen-datenmodell.md,
// "OrderItem bleibt unveraendert").
interface ResolvedOrderItemPricing {
  priceAtTime: number;
  variantId?: string;
  variantName?: string;
  extras: {
    id: string;
    name: string;
    price: number;
    groupId: string;
    groupName: string;
  }[];
}

type ProductWithOptionGroups = {
  id: string;
  name: string;
  price: number;
  optionGroups: {
    id: string;
    name: string;
    minSelect: number;
    maxSelect: number | null;
    priceMode: "ABSOLUTE" | "SURCHARGE";
    options: {
      id: string;
      name: string;
      priceEffect: number;
      isActive: boolean;
    }[];
  }[];
};

interface PrintOptions {
  receiptTitle?: string;
  tenderedAmount?: number;
  changeAmount?: number;
  vouchers?: {
    code: string;
    orderItemId: string;
    productId: string;
    productName: string;
    variantName?: string | null;
    stationId?: string | null;
    issuedAt: Date;
  }[];
  // Issue #98: ein Nachdruck darf der Station keinen neuen Arbeitsauftrag
  // schicken. Vorgabe true, damit der reguläre Verkauf (createOrder,
  // createQuickSale) unveraendert Stationsbons erzeugt, ohne diesen Schalter
  // je zu setzen; nur reprintOrder setzt ihn explizit auf false.
  includeStationTickets?: boolean;
  // Issue #98: Zeitpunkt des Nachdrucks. Nur gesetzt, wenn dieser Druck ein
  // Nachdruck ist; steuert die Kopiekennzeichnung auf Beleg und Produktbons.
  reprintedAt?: Date;
  // Issue #66, Stationskasse: die je Veranstaltung und Betriebsart
  // fortlaufende Abholnummer. Nur bei einem Stationsverkauf gesetzt (siehe
  // apps/backend/src/common/pickup-number.ts); ein Zentralverkauf ohne
  // Station laesst das Feld weg, und die Nutzlast traegt es dann nicht -
  // Bestandsbons duerfen sich dadurch nicht veraendern.
  pickupNumber?: number;
}

@Injectable()
export class OrdersService {
  constructor(
    @Inject(PRISMA_CLIENT) private prisma: PrismaClient,
    // Verpflichtend, nicht optional: discardOfflineQueueEntry (Issue #65,
    // Abschnitt 8 Punkt 2) darf ein Verwerfen nicht erfolgreich abschliessen
    // koennen, ohne dass das Audit-Ereignis tatsaechlich geschrieben wurde.
    // Ein optionales `?.log(...)` liesse das Verwerfen lautlos ohne Spur
    // durchlaufen, wenn die Einbindung fehlt - das widerspricht sowohl dem
    // Issue (Audit-Ereignis nach Serverkontakt) als auch den
    // unverhandelbaren Projektregeln zu auditierbaren Aktionen mit Geldbezug.
    private readonly auditService: AuditService,
  ) {}

  /** Zweite Verteidigung hinter den Request-DTOs für direkte Serviceaufrufe. */
  private validateItems(
    items: { productId: string; quantity: number; optionIds?: string[] }[],
  ): number {
    if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
      throw new BadRequestException(
        orderRejection(
          ORDER_REJECTION_CODES.VALIDATION,
          "Eine Bestellung braucht mindestens eine und höchstens 50 Positionen.",
        ),
      );
    }

    const totalQuantity = items.reduce((sum, item) => {
      if (
        !item ||
        typeof item.productId !== "string" ||
        !Number.isInteger(item.quantity) ||
        item.quantity < 1 ||
        item.quantity > 100 ||
        (item.optionIds !== undefined &&
          (!Array.isArray(item.optionIds) ||
            item.optionIds.length > 50 ||
            item.optionIds.some((optionId) => typeof optionId !== "string")))
      ) {
        throw new BadRequestException(
          orderRejection(
            ORDER_REJECTION_CODES.VALIDATION,
            "Jede Position braucht ein Produkt und eine Menge zwischen 1 und 100.",
          ),
        );
      }
      return sum + item.quantity;
    }, 0);

    if (totalQuantity > 100) {
      throw new BadRequestException(
        orderRejection(
          ORDER_REJECTION_CODES.VALIDATION,
          "Eine Bestellung darf insgesamt höchstens 100 Einheiten enthalten.",
        ),
      );
    }
    return totalQuantity;
  }

  /** Validiert Centbeträge und ihre Summe, bevor irgendeine Zahlung entsteht. */
  private validatePayments(payments: PaymentInputDto[]): number {
    if (!Array.isArray(payments) || payments.length > 50) {
      throw new BadRequestException(
        orderRejection(
          ORDER_REJECTION_CODES.VALIDATION,
          "Ungültige Anzahl an Zahlungen.",
        ),
      );
    }

    let total = 0;
    for (const payment of payments) {
      if (
        !payment ||
        !Number.isInteger(payment.amount) ||
        payment.amount <= 0 ||
        payment.amount > 2_147_483_647 ||
        !["CASH", "CARD", "VOUCHER"].includes(payment.method)
      ) {
        throw new BadRequestException(
          orderRejection(
            ORDER_REJECTION_CODES.VALIDATION,
            "Zahlungen müssen positive ganzzahlige Centbeträge mit gültiger Zahlungsart sein.",
          ),
        );
      }
      total += payment.amount;
      if (!Number.isSafeInteger(total) || total > 2_147_483_647) {
        throw new BadRequestException(
          orderRejection(
            ORDER_REJECTION_CODES.VALIDATION,
            "Die Summe der Zahlungen überschreitet den zulässigen Centbetrag.",
          ),
        );
      }
    }
    return total;
  }

  private normalizeCancellationReason(reason: string): string {
    const normalized = typeof reason === "string" ? reason.trim() : "";
    if (normalized.length === 0 || normalized.length > 500) {
      throw new BadRequestException(
        "Ein Stornogrund mit höchstens 500 Zeichen ist erforderlich.",
      );
    }
    return normalized;
  }

  async getQuickSaleContext(userId: string) {
    const [events, sessions, activePrinter] = await Promise.all([
      this.prisma.event.findMany({
        where: { status: { in: ["ACTIVE", "TEST_MODE"] } },
        select: {
          id: true,
          name: true,
          status: true,
          testMode: true,
          products: {
            where: { availability: { not: "DISABLED" } },
            select: {
              id: true,
              name: true,
              shortName: true,
              price: true,
              color: true,
              sortOrder: true,
              availability: true,
              // Issue #66, Stationskasse: Zielstation von Produkt und
              // Kategorie. Getragen fuer die Anzeige, nicht fuer die
              // Verkaufstransaktion selbst (die prueft Station und
              // Sortiment serverseitig eigenstaendig ueber
              // productAtStationFilter, common/target-station.ts) - aber
              // sowohl die Stationskasse (StationSaleDashboard.tsx) als
              // auch die Kachelableitung dort filtern das angezeigte
              // Sortiment nach genau diesen beiden Feldern, per
              // resolveTargetStationId-Logik: Station des Produkts, sonst
              // Station seiner Kategorie, sonst null. Fehlen sie hier,
              // loest jedes Produkt clientseitig auf "keine Station" auf,
              // und jede Station zeigt ein leeres Kachelraster - genau der
              // Fehler, der diesen Kommentar veranlasst hat. Bewusst auch
              // im zentralen Pfad (getQuickSaleContext) mitgeliefert, nicht
              // nur im Stationszweig: zwei Skalarfelder mehr sind billiger
              // als zwei auseinanderlaufende Selects fuer dieselbe
              // Produktliste; die zentrale Bonkasse ignoriert sie einfach.
              targetStationId: true,
              category: {
                select: {
                  id: true,
                  name: true,
                  sortOrder: true,
                  targetStationId: true,
                },
              },
              // Volle Gruppenliste, dieselben Felder und dieselbe Sortierung
              // wie GET /products (findAllActive). Der Schnellverkauf
              // entscheidet selbst anhand von quickSaleTiles UND der
              // uebrigen Pflichtgruppen, ob und wie ein Produkt angeboten
              // wird (docs/development/produktoptionen-datenmodell.md,
              // "Schnellverkauf") -- ein auf die Kachelgruppe verengtes
              // Feld traegt diese Entscheidung nicht. Verbindlich berechnet
              // wird ohnehin erst bei der Bestellannahme in
              // resolveOrderItemPricing; hier sind Kachelpreise reine
              // Anzeige.
              optionGroups: {
                select: {
                  id: true,
                  name: true,
                  selectionType: true,
                  isRequired: true,
                  minSelect: true,
                  maxSelect: true,
                  priceMode: true,
                  quickSaleTiles: true,
                  sortOrder: true,
                  options: {
                    where: { isActive: true },
                    select: {
                      id: true,
                      name: true,
                      priceEffect: true,
                      isActive: true,
                      sortOrder: true,
                    },
                    orderBy: [
                      { sortOrder: "asc" },
                      { name: "asc" },
                      { id: "asc" },
                    ],
                  },
                },
                orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }],
              },
            },
            orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }],
          },
        },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.cashierSession.findMany({
        where: { userId, status: "ACTIVE" },
        select: {
          id: true,
          eventId: true,
          startingBalance: true,
          startTime: true,
        },
      }),
      this.prisma.printer.findFirst({
        where: { isActive: true },
        select: { id: true },
      }),
    ]);
    const sessionsByEvent = new Map(
      sessions.map((session) => [session.eventId, session]),
    );

    return events.map((event) => ({
      ...event,
      activeSession: sessionsByEvent.get(event.id) || null,
      printingReady: Boolean(activePrinter),
    }));
  }

  /**
   * Kontext der Stationskasse (Issue #66, docs/development/stationskasse.md
   * Abschnitt 2 und 4): derselbe Kontext wie getQuickSaleContext, ergaenzt um
   * die aktiven Stationen je Veranstaltung.
   *
   * Benutzt bewusst NICHT StationsService.findAllActive (GET /stations):
   * jene Methode filtert auf `event: { status: "ACTIVE" }`
   * (stations.service.ts) und blendet damit Stationen einer Veranstaltung im
   * Testbetrieb (TEST_MODE) vollstaendig aus. Eine Stationskasse, die eine
   * Testveranstaltung uebt, faende dort keine einzige Station. Stattdessen
   * wird hier direkt gegen die bereits ermittelten Veranstaltungen
   * (ACTIVE oder TEST_MODE, siehe getQuickSaleContext) gefiltert.
   */
  async getStationSaleContext(userId: string) {
    const events = await this.getQuickSaleContext(userId);
    const eventIds = events.map((event) => event.id);
    const stations = eventIds.length
      ? await this.prisma.station.findMany({
          where: { isActive: true, eventId: { in: eventIds } },
          select: {
            id: true,
            name: true,
            shortName: true,
            color: true,
            sortOrder: true,
            eventId: true,
          },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }],
        })
      : [];

    const stationsByEvent = new Map<string, typeof stations>();
    for (const station of stations) {
      const list = stationsByEvent.get(station.eventId) ?? [];
      list.push(station);
      stationsByEvent.set(station.eventId, list);
    }

    return events.map((event) => ({
      ...event,
      stations: stationsByEvent.get(event.id) ?? [],
    }));
  }

  /**
   * Loest die gewaehlten optionIds einer Bestellposition gegen das Produkt
   * auf und berechnet den Preis nach
   * docs/development/produktoptionen-datenmodell.md
   * ("Preisberechnung einer Bestellposition") sowie
   * docs/development/produktoptionen-schnittstelle.md ("Bestellannahme").
   * Wird von createOrder und createQuickSale gleichermassen verwendet, damit
   * beide dieselben Regeln durchsetzen.
   */
  private resolveOrderItemPricing(
    product: ProductWithOptionGroups,
    optionIds: string[],
  ): ResolvedOrderItemPricing {
    const optionsById = new Map<
      string,
      {
        option: ProductWithOptionGroups["optionGroups"][number]["options"][number];
        group: ProductWithOptionGroups["optionGroups"][number];
      }
    >();
    for (const group of product.optionGroups) {
      for (const option of group.options) {
        optionsById.set(option.id, { option, group });
      }
    }

    const selectedByGroup = new Map<
      string,
      {
        group: ProductWithOptionGroups["optionGroups"][number];
        options: ProductWithOptionGroups["optionGroups"][number]["options"];
      }
    >();
    const seenOptionIds = new Set<string>();
    for (const optionId of optionIds) {
      // Eine doppelt angegebene Kennung deutet auf einen Fehler beim
      // Aufrufer hin (Doppelklick, kaputter Warenkorb-Zustand). Stilles
      // Entdoppeln wuerde diesen Fehler verdecken und in einer
      // MULTIPLE-Gruppe ohne maxSelect den Aufpreis verdoppeln, ohne dass
      // die Auswahl das rechtfertigt. Der Vertrag macht die Backend-Pruefung
      // zur Zusage, deshalb wird abgewiesen statt still repariert.
      if (seenOptionIds.has(optionId)) {
        throw new BadRequestException(
          orderRejection(
            ORDER_REJECTION_CODES.PRICE_OR_OPTION,
            `Die Antwort ${optionId} wurde für ${product.name} mehrfach angegeben.`,
          ),
        );
      }
      seenOptionIds.add(optionId);

      const found = optionsById.get(optionId);
      if (!found || !found.option.isActive) {
        throw new BadRequestException(
          orderRejection(
            ORDER_REJECTION_CODES.PRICE_OR_OPTION,
            `Die Antwort ${optionId} gehört zu keiner aktiven Auswahlgruppe von ${product.name}.`,
          ),
        );
      }
      const entry = selectedByGroup.get(found.group.id) ?? {
        group: found.group,
        options: [],
      };
      entry.options.push(found.option);
      selectedByGroup.set(found.group.id, entry);
    }

    for (const group of product.optionGroups) {
      const selectedCount = selectedByGroup.get(group.id)?.options.length ?? 0;
      if (selectedCount < group.minSelect) {
        throw new BadRequestException(
          orderRejection(
            ORDER_REJECTION_CODES.PRICE_OR_OPTION,
            `Die Auswahlgruppe „${group.name}" von ${product.name} braucht mindestens ${group.minSelect} Antwort(en).`,
          ),
        );
      }
      if (group.maxSelect !== null && selectedCount > group.maxSelect) {
        throw new BadRequestException(
          orderRejection(
            ORDER_REJECTION_CODES.PRICE_OR_OPTION,
            `Die Auswahlgruppe „${group.name}" von ${product.name} erlaubt höchstens ${group.maxSelect} Antwort(en).`,
          ),
        );
      }
    }

    let basePrice = product.price;
    let variantId: string | undefined;
    let variantName: string | undefined;
    const extras: ResolvedOrderItemPricing["extras"] = [];

    for (const entry of selectedByGroup.values()) {
      if (entry.group.priceMode === "ABSOLUTE") {
        const option = entry.options[0];
        basePrice = option.priceEffect;
        variantId = option.id;
        variantName = option.name;
      } else {
        for (const option of entry.options) {
          extras.push({
            id: option.id,
            name: option.name,
            price: option.priceEffect,
            groupId: entry.group.id,
            groupName: entry.group.name,
          });
        }
      }
    }

    const surcharge = extras.reduce((sum, extra) => sum + extra.price, 0);
    const priceAtTime = basePrice + surcharge;
    if (!Number.isInteger(priceAtTime) || priceAtTime < 0) {
      throw new BadRequestException(
        orderRejection(
          ORDER_REJECTION_CODES.PRICE_OR_OPTION,
          `Der Endpreis für ${product.name} darf nicht negativ sein.`,
        ),
      );
    }

    return { priceAtTime, variantId, variantName, extras };
  }

  /**
   * Idempotenzkurzschluss von createQuickSale (Issue #52, erweitert um
   * Issue #66, Stationskasse). Wird sowohl innerhalb der Verkaufstransaktion
   * aufgerufen (regulaerer Kurzschluss, bevor irgendetwas angelegt wird) als
   * auch aus dem P2002-Auffangen heraus, nachdem die Transaktion an der
   * eindeutigen Spalte "idempotencyKey" gescheitert ist - damit in beiden
   * Faellen dieselbe Pruefung entscheidet, statt eine der beiden Stellen
   * ungeprueft zurueckzugeben. Gibt `null` zurueck, wenn (noch) keine
   * Bestellung zu diesem Schluessel existiert; wirft, wenn eine existiert,
   * aber nicht zur Anfrage passt.
   *
   * Zwei Abweichungsgruende zusaetzlich zu den bestehenden aus Issue #52
   * (docs/development/stationskasse.md, Abschnitt 3 "Zusammenspiel mit der
   * Idempotenz"):
   * - existingOrder.stationId weicht von dto.stationId ab: ohne diese
   *   Pruefung koennte ein Idempotenzschluessel einer anderen Station eine
   *   fremde Bestellung zurueckspielen.
   * - dto.stationId ist gesetzt, existingOrder.pickupNumber aber nicht: ein
   *   ueber den Stationsendpunkt wiederholter Zentralverkauf (derselbe
   *   Schluessel, urspruenglich ohne Station gebucht) wuerde sonst eine
   *   Bestellung ohne Abholnummer ausliefern.
   */
  private async resolveIdempotentQuickSale(
    tx: PrismaClient | Prisma.TransactionClient,
    userId: string,
    dto: QuickSaleServiceDto,
  ) {
    const existingOrder = await tx.order.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
      include: {
        items: { include: { product: true } },
        payments: true,
        vouchers: true,
      },
    });
    if (!existingOrder) return null;

    const payment = existingOrder.payments[0];
    // Idempotenzschluessel nach docs/development/produktoptionen-schnittstelle.md
    // ("Idempotenz des Schnellverkaufs"): alle gewaehlten Antwortkennungen
    // gehen aufsteigend sortiert ein, sonst gelten zwei verschiedene
    // Zusammenstellungen desselben Produkts als Wiederholung derselben
    // Bestellung.
    const requestedItems = dto.items
      .map((item) => {
        const optionIds = [...(item.optionIds ?? [])].sort();
        return `${item.productId}:${item.quantity}:${optionIds.join(",")}`;
      })
      .sort();
    const storedItems = existingOrder.items
      .map((item) => {
        const extras = Array.isArray(item.extras)
          ? (item.extras as { id: string }[])
          : [];
        const optionIds = [
          ...(item.variantId ? [item.variantId] : []),
          ...extras.map((extra) => extra.id),
        ].sort();
        return `${item.productId}:${item.quantity}:${optionIds.join(",")}`;
      })
      .sort();
    const sameTenderedAmount =
      dto.paymentMethod === "CASH"
        ? payment?.tenderedAmount === dto.tenderedAmount
        : dto.tenderedAmount === undefined ||
          dto.tenderedAmount === existingOrder.totalAmount;
    if (
      existingOrder.userId !== userId ||
      existingOrder.eventId !== dto.eventId ||
      !existingOrder.cashierSessionId ||
      existingOrder.vouchers.length === 0 ||
      existingOrder.payments.length !== 1 ||
      payment?.method !== dto.paymentMethod ||
      !sameTenderedAmount ||
      requestedItems.length !== storedItems.length ||
      requestedItems.some((item, index) => item !== storedItems[index]) ||
      // Issue #66, Stationskasse: beide Seiten werden normalisiert
      // (?? null), nicht nur dto.stationId. existingOrder stammt hier aus
      // einem findUnique ohne select, liefert also heute immer alle
      // Skalarspalten und damit null statt undefined - aber sollte diese
      // Abfrage spaeter ein select bekommen (sie laedt bereits Positionen,
      // Zahlungen und Gutscheine mit, ein enger select waere naheliegend),
      // kaeme stationId/pickupNumber als undefined zurueck. Ohne die
      // Normalisierung auf existingOrder wuerde die erste Zeile dann jeden
      // regulaeren Zentralverkauf als Abweichung werten (undefined !== null),
      // und die zweite Zeile faellt in die falsche Richtung um: eine
      // Stationswiederholung ohne Nummer (pickupNumber undefined) ginge
      // lautlos durch, statt abgewiesen zu werden.
      (existingOrder.stationId ?? null) !== (dto.stationId ?? null) ||
      (Boolean(dto.stationId) && (existingOrder.pickupNumber ?? null) === null)
    ) {
      throw new BadRequestException(
        orderRejection(
          ORDER_REJECTION_CODES.DUPLICATE_KEY_MISMATCH,
          ORDER_REJECTION_MESSAGES.IDEMPOTENCY_KEY_CONFLICT,
        ),
      );
    }
    return {
      order: existingOrder,
      vouchersIssued: existingOrder.vouchers.length,
      tenderedAmount: payment?.tenderedAmount || existingOrder.totalAmount,
      changeAmount: payment?.changeAmount || 0,
      pickupNumber: existingOrder.pickupNumber ?? undefined,
      idempotentReplay: true,
    };
  }

  async createQuickSale(userId: string, dto: QuickSaleServiceDto) {
    if (!userId)
      throw new BadRequestException("Authenticated user is required");
    if (!dto?.eventId) throw new BadRequestException("eventId is required");
    if (
      typeof dto.idempotencyKey !== "string" ||
      dto.idempotencyKey.length < 8 ||
      dto.idempotencyKey.length > 128
    ) {
      throw new BadRequestException("A valid idempotencyKey is required");
    }
    this.validateItems(dto.items);
    if (!["CASH", "CARD"].includes(dto.paymentMethod)) {
      throw new BadRequestException(
        "Only CASH and CARD are supported for quick sales",
      );
    }
    if (dto.stationId !== undefined && typeof dto.stationId !== "string") {
      throw new BadRequestException("stationId muss eine Zeichenkette sein.");
    }
    // Stationskasse (Issue #66, docs/development/stationskasse.md
    // Abschnitt 2): Kartenzahlung ist erklaertes Nicht-Ziel des Stationsmodus.
    if (dto.stationId && dto.paymentMethod !== "CASH") {
      throw new BadRequestException(
        "Ein Stationsverkauf ist nur mit Barzahlung möglich.",
      );
    }

    let result;
    try {
      result = await this.prisma.$transaction(async (prisma) => {
        const idempotentResult = await this.resolveIdempotentQuickSale(
          prisma,
          userId,
          dto,
        );
        if (idempotentResult) return idempotentResult;

        const eventRows = await prisma.$queryRaw<
          { id: string; status: string; testMode: boolean }[]
        >(Prisma.sql`
        SELECT "id", "status", "testMode" FROM "Event" WHERE "id" = ${dto.eventId} FOR UPDATE
      `);
        const event = eventRows[0];
        const dataMode =
          event?.status === "ACTIVE" && !event.testMode
            ? "LIVE"
            : event?.status === "TEST_MODE" && event.testMode
              ? "TEST"
              : null;
        if (!dataMode)
          throw new BadRequestException(
            ORDER_REJECTION_MESSAGES.EVENT_NOT_ACTIVE_FOR_SALES,
          );

        const activePrinter = await prisma.printer.findFirst({
          where: { isActive: true },
          select: { id: true },
        });
        if (!activePrinter) {
          throw new BadRequestException(
            "Für den Bonverkauf ist ein aktiver Drucker erforderlich.",
          );
        }

        const activeSessions = await prisma.$queryRaw<
          { id: string; dataMode: "TEST" | "LIVE" }[]
        >(Prisma.sql`
        SELECT "id", "dataMode"
        FROM "CashierSession"
        WHERE "userId" = ${userId}
          AND "eventId" = ${dto.eventId}
          AND "status" = 'ACTIVE'
        ORDER BY "startTime" DESC
        LIMIT 1
        FOR UPDATE
      `);
        const cashierSessionId = activeSessions[0]?.id;
        if (!cashierSessionId) {
          throw new BadRequestException(
            "Für diesen Verkauf ist eine aktive Kassensitzung erforderlich.",
          );
        }
        if (activeSessions[0].dataMode !== dataMode)
          throw new ConflictException(
            "Die aktive Kassensitzung gehört zu einem anderen Betriebsmodus.",
          );

        // Stationskasse (Issue #66): Station pruefen, direkt nach der
        // Kassensitzung und vor allem anderen, das die Station bereits
        // voraussetzt (Sortiment, Abholnummer). Sperrreihenfolge Event ->
        // Kassensitzung -> Zaehler ist in common/pickup-number.ts festgehalten;
        // diese Pruefung liegt bewusst davor und fasst die Zaehlerzeile noch
        // nicht an. Eine Station muss existieren, aktiv sein und zu dieser
        // Veranstaltung gehoeren - sonst koennte eine Station einer fremden
        // Veranstaltung fuer diesen Verkauf durchgehen.
        if (dto.stationId) {
          const station = await prisma.station.findUnique({
            where: { id: dto.stationId },
            select: { id: true, isActive: true, eventId: true },
          });
          if (
            !station ||
            !station.isActive ||
            station.eventId !== dto.eventId
          ) {
            throw new BadRequestException(
              "Diese Station ist für diesen Verkauf nicht verfügbar. Bitte eine andere Station wählen.",
            );
          }
        }

        const productIds = [
          ...new Set(dto.items.map((item) => item.productId)),
        ];
        // Stationskasse (Issue #66): Produkte zunaechst nur gegen die
        // Veranstaltung aufloesen, OHNE den Stationsfilter in derselben
        // where-Klausel. Stand vorher beides in einem Filter
        // (productAtStationFilter direkt in "where"), war ein Produkt einer
        // anderen Station derselben Veranstaltung nicht von einem Produkt zu
        // unterscheiden, das es in dieser Veranstaltung gar nicht gibt -
        // beides fehlte im Ergebnis und landete unten in derselben Meldung
        // "gehört nicht zu dieser Veranstaltung". Das schickt die Bedienung
        // an der Kasse in die falsche Richtung (sie prueft eine Veranstaltung,
        // die stimmt, statt die Station zu wechseln). Die Stationszugehoerigkeit
        // wird deshalb als zweiter, eigener Schritt weiter unten geprueft -
        // mit derselben Funktion (resolveTargetStationId), nicht mit einem
        // zweiten, selbstgebauten Filter. "category" wird dafuer zusaetzlich
        // geladen, weil resolveTargetStationId sie im Parametertyp verlangt.
        const products = await prisma.product.findMany({
          where: { id: { in: productIds }, eventId: dto.eventId },
          include: {
            optionGroups: { include: { options: true } },
            category: { select: { targetStationId: true } },
          },
        });
        const productsById = new Map(
          products.map((product) => [product.id, product]),
        );

        let totalAmount = 0;
        const orderItemsData = dto.items.map((item) => {
          const product = productsById.get(item.productId);
          if (!product)
            throw new BadRequestException(
              ORDER_REJECTION_MESSAGES.PRODUCT_NOT_IN_EVENT_QUICK_SALE,
            );
          // Zweiter Schritt: das Produkt gehoert zur Veranstaltung (siehe
          // oben), aber gehoert es auch zur gewaehlten Station? Dieselbe
          // Regel wie der fruehere where-Filter (productAtStationFilter),
          // nur jetzt mit einer eigenen, praezisen Meldung statt der
          // Veranstaltungsmeldung. Ohne dto.stationId (zentraler
          // Schnellverkauf) entfaellt diese Pruefung unveraendert wie bisher.
          if (
            dto.stationId &&
            resolveTargetStationId(product) !== dto.stationId
          ) {
            throw new BadRequestException(
              ORDER_REJECTION_MESSAGES.PRODUCT_NOT_AT_STATION_QUICK_SALE,
            );
          }
          if (
            product.availability === "OUT_OF_STOCK" ||
            product.availability === "DISABLED"
          ) {
            throw new BadRequestException(
              ORDER_REJECTION_MESSAGES.PRODUCT_OUT_OF_STOCK(product.name),
            );
          }

          const { priceAtTime, variantId, variantName, extras } =
            this.resolveOrderItemPricing(product, item.optionIds ?? []);
          totalAmount += priceAtTime * item.quantity;

          return {
            productId: product.id,
            quantity: item.quantity,
            priceAtTime,
            status: "PENDING" as const,
            variantId,
            variantName,
            extras: extras.length > 0 ? (extras as any) : undefined,
          };
        });
        if (
          !Number.isSafeInteger(totalAmount) ||
          totalAmount <= 0 ||
          totalAmount > 2_147_483_647
        ) {
          throw new BadRequestException(
            "Der Gesamtbetrag dieses Verkaufs ist ungültig. Bitte den Verkauf neu zusammenstellen.",
          );
        }

        let tenderedAmount: number;
        let changeAmount = 0;
        if (dto.paymentMethod === "CASH") {
          tenderedAmount = dto.tenderedAmount as number;
          if (
            !Number.isInteger(tenderedAmount) ||
            tenderedAmount < totalAmount ||
            tenderedAmount > 2_147_483_647
          ) {
            throw new BadRequestException(
              "Der gegebene Barbetrag muss den Gesamtbetrag vollständig abdecken.",
            );
          }
          changeAmount = tenderedAmount - totalAmount;
        } else {
          if (
            dto.tenderedAmount !== undefined &&
            dto.tenderedAmount !== totalAmount
          ) {
            throw new BadRequestException(
              "Der Kartenbetrag muss dem Gesamtbetrag entsprechen. Bitte den Betrag korrigieren.",
            );
          }
          tenderedAmount = totalAmount;
        }

        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user?.isActive)
          throw new BadRequestException(
            ORDER_REJECTION_MESSAGES.USER_NOT_ACTIVE,
          );

        // Stationskasse (Issue #66): Abholnummer ziehen, unmittelbar vor dem
        // Anlegen der Bestellung und nach allen Pruefungen (siehe
        // common/pickup-number.ts fuer Sperrreihenfolge und
        // Ueberlaufpruefung). Nur beim Stationsverkauf - die zentrale
        // Bonkasse bekommt bewusst keine Nummer (Entscheidung 5 der
        // Projektleitung, docs/development/stationskasse.md).
        const pickupNumber = dto.stationId
          ? await drawPickupNumber(prisma, dto.eventId, dataMode)
          : undefined;

        const order = await prisma.order.create({
          data: {
            totalAmount,
            lifecycleStatus: "SUBMITTED",
            paymentStatus: "PAID",
            fulfillmentStatus: "PENDING",
            userId,
            eventId: dto.eventId,
            dataMode,
            idempotencyKey: dto.idempotencyKey,
            tableName: null,
            areaId: null,
            cashierSessionId,
            pickupNumber: pickupNumber ?? null,
            stationId: dto.stationId ?? null,
            items: { create: orderItemsData },
            payments: {
              create: {
                amount: totalAmount,
                method: dto.paymentMethod,
                status: "COMPLETED",
                cashierSessionId,
                tenderedAmount:
                  dto.paymentMethod === "CASH" ? tenderedAmount : null,
                changeAmount,
              },
            },
          },
          include: {
            items: {
              include: {
                product: { include: { category: true } },
              },
            },
            payments: true,
          },
        });

        const vouchers: PrintOptions["vouchers"] = [];
        for (const item of order.items) {
          for (let unit = 0; unit < item.quantity; unit += 1) {
            const voucher = await prisma.productVoucher.create({
              data: {
                code: randomBytes(12).toString("hex").toUpperCase(),
                eventId: dto.eventId,
                productId: item.productId,
                orderId: order.id,
                orderItemId: item.id,
                issuedByUserId: userId,
                cashierSessionId,
              },
            });
            vouchers.push({
              code: voucher.code,
              orderItemId: item.id,
              productId: item.productId,
              productName: item.product.name,
              variantName: item.variantName,
              stationId: resolveTargetStationId(item.product),
              issuedAt: voucher.issuedAt,
            });
          }
        }

        await this.dispatchPrintJobs(prisma, order, user, {
          receiptTitle: "INTERNER ZAHLUNGSNACHWEIS",
          tenderedAmount,
          changeAmount,
          vouchers,
          pickupNumber,
        });

        await prisma.auditLog.create({
          data: {
            // Stationskasse (Issue #66): eigene Aktion, wenn eine Station
            // gesetzt ist, sonst unveraendert QUICK_SALE_COMPLETED.
            action: dto.stationId
              ? "STATION_SALE_COMPLETED"
              : "QUICK_SALE_COMPLETED",
            entityId: order.id,
            entityType: "Order",
            userId,
            details: {
              eventId: dto.eventId,
              cashierSessionId,
              paymentMethod: dto.paymentMethod,
              totalAmount,
              tenderedAmount,
              changeAmount,
              vouchersIssued: vouchers.length,
              idempotencyKey: dto.idempotencyKey,
              stationId: dto.stationId ?? null,
              pickupNumber: pickupNumber ?? null,
            },
          },
        });

        return {
          order,
          vouchersIssued: vouchers.length,
          tenderedAmount,
          changeAmount,
          pickupNumber,
          idempotentReplay: false,
        };
      });
    } catch (error) {
      // Issue #66, Entscheidung 6 der Projektleitung: derselbe P2002-Fang
      // wie in createOrder (siehe isIdempotencyKeyViolation weiter unten).
      // Zwei echt gleichzeitige Anfragen mit demselben Schluessel lesen in
      // resolveIdempotentQuickSale oben beide "nicht vorhanden"; ohne
      // diesen Fang scheitert die unterlegene Anfrage mit einem
      // unbehandelten Unique-Verstoss (P2002, also 500) statt mit der
      // Wiederholungsantwort. Nur dieser konkrete Verstoss wird als
      // Wiederholung behandelt, jeder andere Fehler wird unveraendert
      // weitergereicht.
      if (
        dto.idempotencyKey &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002" &&
        this.isIdempotencyKeyViolation(error)
      ) {
        const idempotentResult = await this.resolveIdempotentQuickSale(
          this.prisma,
          userId,
          dto,
        );
        if (idempotentResult) return idempotentResult;
      }
      throw error;
    }

    return result;
  }

  private async dispatchPrintJobs(
    prisma: any,
    order: any,
    user?: any,
    options: PrintOptions = {},
  ) {
    const event = await prisma.event.findUnique({
      where: { id: order.eventId },
    });
    const defaultPrinter = await prisma.printer.findFirst({
      where: { isActive: true },
    });
    const stations = await prisma.station.findMany({
      where: { eventId: order.eventId },
      include: { printer: true },
    });
    const stationMap = new Map(stations.map((s: any) => [s.id, s]));

    if (!defaultPrinter && stations.every((s: any) => !s.printer?.isActive)) {
      return; // No printers configured
    }

    // 1. Group items by targetStation for STATION_TICKETS
    //
    // Issue #98: ein Nachdruck (reprintOrder) darf keinen Arbeitsauftrag an
    // eine Station erzeugen - die Speisen wurden bereits einmal zubereitet.
    // includeStationTickets ist nur beim Nachdruck false; der reguläre
    // Verkauf (createOrder, createQuickSale) lässt den Schalter unangetastet
    // (Vorgabe true) und erzeugt Stationsbons wie bisher.
    if (options.includeStationTickets ?? true) {
      const itemsByStation = new Map<string, any[]>();
      for (const item of order.items) {
        const stationId =
          (item.product && resolveTargetStationId(item.product)) ||
          "NO_STATION";
        if (!itemsByStation.has(stationId)) {
          itemsByStation.set(stationId, []);
        }
        itemsByStation.get(stationId)!.push(item);
      }

      for (const [stationId, stationItems] of itemsByStation.entries()) {
        const station = stationMap.get(stationId) as any;
        const targetPrinter = station?.printer?.isActive
          ? station.printer
          : defaultPrinter;
        if (targetPrinter) {
          await prisma.printJob.create({
            data: {
              printerId: targetPrinter.id,
              jobType: "STATION_TICKET",
              orderId: order.id,
              content: {
                title: "ABHOL-/KÜCHENBON",
                stationName: station?.name || "Zentrale Ausgabe",
                orderNumber: order.orderNumber,
                orderId: order.id,
                tableName: order.tableName || "Theke / Ohne Tisch",
                waiterName: user?.name || user?.username || "Kellner",
                isPriority: order.isPriority,
                createdAt: order.createdAt,
                // Issue #66, Stationskasse: nur bei einem Stationsverkauf
                // gesetzt (siehe PrintOptions.pickupNumber); ein
                // Zentralverkauf ohne Station laesst das Feld weg.
                pickupNumber: options.pickupNumber,
                items: stationItems.map((i) => ({
                  productName: i.product.name,
                  quantity: i.quantity,
                  variantName: i.variantName,
                  extras: i.extras,
                })),
              },
            },
          });
        }
      }
    }

    for (const voucher of options.vouchers || []) {
      const station = voucher.stationId
        ? (stationMap.get(voucher.stationId) as any)
        : null;
      const targetPrinter = station?.printer?.isActive
        ? station.printer
        : defaultPrinter;
      if (!targetPrinter) continue;

      await prisma.printJob.create({
        data: {
          printerId: targetPrinter.id,
          jobType: "PRODUCT_VOUCHER",
          orderId: order.id,
          content: {
            title: "PRODUKTBON",
            eventName: event?.name || "Vereinsfest",
            orderNumber: order.orderNumber,
            voucherCode: voucher.code,
            productName: voucher.productName,
            variantName: voucher.variantName,
            quantity: 1,
            stationName: station?.name || "Zentrale Ausgabe",
            issuedAt: voucher.issuedAt,
            rksvDisclaimer: "VereinOrder ist keine RKSV-Registrierkasse.",
            // Issue #98: Kopiekennzeichnung, sobald dieser Druck ein
            // Nachdruck ist (documents.ts liest isCopy/reprintedAt).
            isCopy: Boolean(options.reprintedAt),
            reprintedAt: options.reprintedAt,
            // Issue #66, Stationskasse: nur bei einem Stationsverkauf
            // gesetzt; ein Zentralverkauf ohne Station laesst das Feld weg,
            // documents.ts belaesst das Druckbild dann unveraendert.
            pickupNumber: options.pickupNumber,
          },
        },
      });
    }

    // 2. Create Customer/Cashier RECEIPT
    if (defaultPrinter && defaultPrinter.isActive) {
      const totalPaid =
        order.payments?.reduce((sum: number, p: any) => sum + p.amount, 0) || 0;
      const changeAmount =
        options.changeAmount ?? Math.max(0, totalPaid - order.totalAmount);

      await prisma.printJob.create({
        data: {
          printerId: defaultPrinter.id,
          jobType: "RECEIPT",
          orderId: order.id,
          content: {
            title: options.receiptTitle || "KASSENBELEG",
            eventName: event?.name || "Vereinsfest",
            orderNumber: order.orderNumber,
            orderId: order.id,
            tableName: order.tableName || "Theke",
            waiterName: user?.name || user?.username || "Kellner",
            createdAt: order.createdAt,
            items: order.items.map((i: any) => ({
              productName: i.product.name,
              quantity: i.quantity,
              price: i.priceAtTime,
              variantName: i.variantName,
              extras: i.extras,
              totalPrice: i.priceAtTime * i.quantity,
            })),
            totalAmount: order.totalAmount,
            payments:
              order.payments?.map((p: any) => ({
                amount: p.amount,
                method: p.method,
                tenderedAmount: p.tenderedAmount,
                changeAmount: p.changeAmount,
              })) || [],
            tenderedAmount: options.tenderedAmount,
            changeAmount,
            rksvDisclaimer: "VereinOrder ist keine RKSV-Registrierkasse.",
            // Issue #98: Kopiekennzeichnung, sobald dieser Druck ein
            // Nachdruck ist (documents.ts liest isCopy/reprintedAt).
            isCopy: Boolean(options.reprintedAt),
            reprintedAt: options.reprintedAt,
            // Issue #66, Stationskasse: nur bei einem Stationsverkauf
            // gesetzt; ein Zentralverkauf ohne Station laesst das Feld weg.
            pickupNumber: options.pickupNumber,
          },
        },
      });
    }
  }

  /**
   * Idempotenzkurzschluss von createOrder (Issue #86, siehe
   * orders.idempotency.spec.ts). Gibt eine vorhandene Bestellung nur dann
   * zurueck, wenn Benutzer, Veranstaltung, Positionen und Zahlungen
   * tatsaechlich der Anfrage entsprechen; sonst wird abgelehnt, ohne
   * Inhalt der fremden Bestellung preiszugeben. Reihenfolgen (Positionen
   * wie darin enthaltene Auswahlkennungen, sowie Zahlungen) sind dabei
   * irrelevant.
   *
   * Wird sowohl vor der Transaktion (regulaerer Kurzschluss) als auch aus
   * dem P2002-Auffangen heraus verwendet (Issue #65, Abschnitt 8 Punkt 4),
   * damit in beiden Faellen dieselbe Pruefung entscheidet, statt eine der
   * beiden Stellen ungeprueft zurueckzugeben.
   */
  private async resolveIdempotentOrder(userId: string, dto: CreateOrderDto) {
    if (!dto.idempotencyKey) return null;

    const existingOrder = await this.prisma.order.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
      include: {
        items: { include: { product: true } },
        payments: true,
      },
    });
    if (!existingOrder) return null;

    const normalizeItems = (
      items: { productId: string; quantity: number; optionIds: string[] }[],
    ) =>
      items
        .map((item) => {
          const optionIds = [...item.optionIds].sort();
          return `${item.productId}:${item.quantity}:${optionIds.join(",")}`;
        })
        .sort();

    const requestedItems = normalizeItems(
      dto.items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        optionIds: item.optionIds ?? [],
      })),
    );
    // Die gespeicherte Bestellposition haelt die getroffene Auswahl als
    // Momentaufnahme in variantId (ABSOLUTE-Gruppe) und im JSON-Feld
    // extras (uebrige Gruppen). Beides zusammen entspricht den
    // optionIds der Anfrage, siehe requestedItems oben in
    // createQuickSale.
    const storedItems = normalizeItems(
      existingOrder.items.map((item) => {
        const extras = Array.isArray(item.extras)
          ? (item.extras as { id: string }[])
          : [];
        const optionIds = [
          ...(item.variantId ? [item.variantId] : []),
          ...extras.map((extra) => extra.id),
        ];
        return {
          productId: item.productId,
          quantity: item.quantity,
          optionIds,
        };
      }),
    );

    const normalizePayments = (
      payments: { amount: number; method: string }[],
    ) => payments.map((p) => `${p.amount}:${p.method}`).sort();

    const requestedPayments = normalizePayments(dto.payments ?? []);
    const storedPayments = normalizePayments(existingOrder.payments);

    const sameItems =
      requestedItems.length === storedItems.length &&
      requestedItems.every((item, index) => item === storedItems[index]);
    const samePayments =
      requestedPayments.length === storedPayments.length &&
      requestedPayments.every(
        (payment, index) => payment === storedPayments[index],
      );

    if (
      existingOrder.userId !== userId ||
      existingOrder.eventId !== dto.eventId ||
      !sameItems ||
      !samePayments
    ) {
      throw new BadRequestException(
        orderRejection(
          ORDER_REJECTION_CODES.DUPLICATE_KEY_MISMATCH,
          ORDER_REJECTION_MESSAGES.IDEMPOTENCY_KEY_CONFLICT,
        ),
      );
    }
    return existingOrder;
  }

  async createOrder(userId: string, dto: CreateOrderDto) {
    this.validateItems(dto?.items);
    const requestedPayments = dto.payments ?? [];
    const totalPaid = this.validatePayments(requestedPayments);

    const idempotentOrder = await this.resolveIdempotentOrder(userId, dto);
    if (idempotentOrder) return idempotentOrder;

    try {
      return await this.prisma.$transaction(async (prisma) => {
        const eventRows = await prisma.$queryRaw<
          { status: string; testMode: boolean }[]
        >(
          Prisma.sql`SELECT "status", "testMode" FROM "Event" WHERE "id" = ${dto.eventId} FOR UPDATE`,
        );
        const event = eventRows[0];
        const orderDataMode =
          event?.status === "ACTIVE" && !event.testMode
            ? "LIVE"
            : event?.status === "TEST_MODE" && event.testMode
              ? "TEST"
              : null;
        if (!orderDataMode)
          throw new BadRequestException(
            orderRejection(
              ORDER_REJECTION_CODES.EVENT_MODE,
              ORDER_REJECTION_MESSAGES.EVENT_NOT_ACTIVE_FOR_ORDERS,
            ),
          );

        // Alle eventgebundenen Referenzen werden in derselben Transaktion
        // wie der Write aufgelöst. So kann keine Position vor der Prüfung
        // angelegt werden und ein Fehler führt stets zum vollständigen
        // Rollback statt zu einer Teilbuchung.
        const productIds = [
          ...new Set(dto.items.map((item) => item.productId)),
        ];
        const products = await prisma.product.findMany({
          where: { id: { in: productIds }, eventId: dto.eventId },
          include: { optionGroups: { include: { options: true } } },
        });
        const productMap = new Map(
          products.map((product) => [product.id, product]),
        );
        if (productMap.size !== productIds.length) {
          const missingProductId = productIds.find((id) => !productMap.has(id));
          throw new BadRequestException(
            orderRejection(
              ORDER_REJECTION_CODES.PRODUCT_UNAVAILABLE,
              ORDER_REJECTION_MESSAGES.PRODUCT_NOT_IN_EVENT(missingProductId),
            ),
          );
        }

        if (dto.areaId) {
          const area = await prisma.area.findFirst({
            where: { id: dto.areaId, eventId: dto.eventId },
            select: { id: true },
          });
          if (!area) {
            throw new BadRequestException(
              orderRejection(
                ORDER_REJECTION_CODES.VALIDATION,
                ORDER_REJECTION_MESSAGES.AREA_NOT_IN_EVENT,
              ),
            );
          }
        }

        const activeSession = userId
          ? await prisma.cashierSession.findFirst({
              where: { userId, eventId: dto.eventId, status: "ACTIVE" },
            })
          : null;
        if (activeSession && activeSession.dataMode !== orderDataMode)
          throw new ConflictException(
            orderRejection(
              ORDER_REJECTION_CODES.EVENT_MODE,
              "Die aktive Kassensitzung gehört zu einem anderen Betriebsmodus.",
            ),
          );
        // Issue #65, Abschnitt 8 Punkt 5 (Befund B7): ist eine erfasste
        // Kassensitzung angegeben, muss sie der heute aktiven Sitzung
        // dieses Benutzers fuer diese Veranstaltung entsprechen. Fehlt das
        // Feld, bleibt das Verhalten unveraendert - heutige
        // Online-Bestellungen ohne Sitzung laufen weiter ohne Sitzung.
        if (
          dto.cashierSessionId &&
          dto.cashierSessionId !== activeSession?.id
        ) {
          throw new ConflictException(
            orderRejection(
              ORDER_REJECTION_CODES.SESSION_CLOSED,
              "Die erfasste Kassensitzung ist nicht mehr aktiv.",
            ),
          );
        }
        const cashierSessionId = activeSession?.id || null;
        const user = userId
          ? await prisma.user.findUnique({ where: { id: userId } })
          : null;
        if (!user?.isActive) {
          throw new BadRequestException(
            orderRejection(
              ORDER_REJECTION_CODES.FORBIDDEN,
              ORDER_REJECTION_MESSAGES.USER_NOT_ACTIVE,
            ),
          );
        }

        let totalAmount = 0;
        const orderItemsData = dto.items.map((item) => {
          const product = productMap.get(item.productId);
          if (
            product.availability === "OUT_OF_STOCK" ||
            product.availability === "DISABLED"
          ) {
            throw new BadRequestException(
              orderRejection(
                ORDER_REJECTION_CODES.PRODUCT_UNAVAILABLE,
                ORDER_REJECTION_MESSAGES.PRODUCT_OUT_OF_STOCK(product.name),
              ),
            );
          }

          const { priceAtTime, variantId, variantName, extras } =
            this.resolveOrderItemPricing(product, item.optionIds ?? []);
          totalAmount += priceAtTime * item.quantity;
          if (
            !Number.isSafeInteger(totalAmount) ||
            totalAmount > 2_147_483_647
          ) {
            throw new BadRequestException(
              orderRejection(
                ORDER_REJECTION_CODES.VALIDATION,
                "Der Gesamtbetrag der Bestellung überschreitet den zulässigen Centbetrag.",
              ),
            );
          }

          return {
            productId: product.id,
            quantity: item.quantity,
            priceAtTime,
            status: "PENDING" as const,
            variantId,
            variantName,
            extras: extras.length > 0 ? (extras as any) : undefined,
          };
        });

        const initialPaymentStatus =
          totalPaid >= totalAmount
            ? "PAID"
            : totalPaid > 0
              ? "PARTIALLY_PAID"
              : "OPEN";

        const order = await prisma.order.create({
          data: {
            totalAmount,
            lifecycleStatus: "SUBMITTED",
            paymentStatus: initialPaymentStatus,
            fulfillmentStatus: "PENDING",
            userId,
            eventId: dto.eventId,
            dataMode: orderDataMode,
            idempotencyKey: dto.idempotencyKey,
            tableName: dto.tableName,
            areaId: dto.areaId,
            cashierSessionId,
            items: {
              create: orderItemsData,
            },
            payments:
              requestedPayments.length > 0
                ? {
                    create: requestedPayments.map((p) => ({
                      amount: p.amount,
                      method: p.method,
                      status: "COMPLETED",
                      cashierSessionId,
                    })),
                  }
                : undefined,
          },
          include: {
            items: {
              include: {
                product: { include: { category: true } },
              },
            },
            payments: true,
          },
        });

        // Dispatch smart PrintJobs
        await this.dispatchPrintJobs(prisma, order, user);

        return order;
      });
    } catch (error) {
      // Issue #65, Abschnitt 8 Punkt 4 (Befund B5): die Idempotenzpruefung
      // liegt vor der Transaktion, zwei gleichzeitige Versuche mit
      // demselben Schluessel koennen beide daran vorbeikommen. Die
      // eindeutige Spalte auf "idempotencyKey" (schema.prisma) verhindert
      // die Doppelbestellung, meldet den unterlegenen Versuch aber als
      // P2002. Nur dieser konkrete Verstoss wird als Wiederholung
      // behandelt - jeder andere Prisma-Fehler (Fremdschluessel,
      // sonstige eindeutige Spalten) wird unveraendert weitergereicht,
      // damit ein zu weit gefasstes Auffangen keine echten Fehler
      // verschluckt.
      if (
        dto.idempotencyKey &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002" &&
        this.isIdempotencyKeyViolation(error)
      ) {
        const idempotentOrder = await this.resolveIdempotentOrder(userId, dto);
        if (idempotentOrder) return idempotentOrder;
      }
      throw error;
    }
  }

  /**
   * Prueft, ob ein P2002-Fehler tatsaechlich die eindeutige Spalte
   * "idempotencyKey" auf Order betrifft (Issue #65, Abschnitt 8 Punkt 4).
   * Prisma liefert den betroffenen Spaltennamen in error.meta.target,
   * abhaengig vom Datenbanktreiber entweder als Array oder als
   * zusammengesetzte Zeichenkette (z. B. Indexname). Beide Formen werden
   * beruecksichtigt, damit weder ein Fremdschluesselverstoss (P2003) noch
   * ein Verstoss gegen eine andere eindeutige Spalte hier faelschlich als
   * Wiederholung durchgeht.
   */
  private isIdempotencyKeyViolation(
    error: Prisma.PrismaClientKnownRequestError,
  ): boolean {
    const target = error.meta?.target;
    if (Array.isArray(target)) {
      return target.includes("idempotencyKey");
    }
    if (typeof target === "string") {
      return target.includes("idempotencyKey");
    }
    return false;
  }

  /**
   * Issue #65, Abschnitt 8 Punkt 1: schmale Auskunft ueber eine Bestellung
   * anhand ihres idempotencyKey, fuer den Verwerfen-Ablauf (Abschnitt 7)
   * der Offline-Warteschlange. Liefert absichtlich nicht die vollstaendige
   * Bestellung.
   *
   * Ein fremder Schluessel (existiert, gehoert aber einem anderen
   * Benutzer, der nicht ADMINISTRATOR oder EVENT_MANAGER ist) muss sich
   * fuer den Aufrufer nicht von einem unbekannten Schluessel
   * unterscheiden - deshalb in beiden Faellen NotFoundException (404),
   * nie ForbiddenException (403). Ein 403 wuerde bereits verraten, dass
   * der Schluessel existiert.
   */
  async getOrderByIdempotencyKey(
    userId: string,
    role: string,
    idempotencyKey: string,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { idempotencyKey },
      select: {
        id: true,
        orderNumber: true,
        createdAt: true,
        totalAmount: true,
        eventId: true,
        dataMode: true,
        paymentStatus: true,
        userId: true,
      },
    });

    const canSeeForeignOrders =
      role === "ADMINISTRATOR" || role === "EVENT_MANAGER";
    if (!order || (order.userId !== userId && !canSeeForeignOrders)) {
      throw new NotFoundException("Order not found");
    }

    const { userId: _ownerUserId, ...result } = order;
    return result;
  }

  /**
   * Issue #65, Abschnitt 8 Punkt 2 und Abschnitt 7 ("Verwerfen"): nimmt
   * das Verwerfen einer lokalen Vormerkung entgegen, nachdem der Client
   * ueber GET .../by-idempotency-key/:key bereits bestaetigt bekommen hat,
   * dass der Server die Bestellung nicht kennt. Prueft das hier
   * unabhaengig erneut (sonst 409) und schreibt danach das
   * Audit-Ereignis. Loescht selbst nichts - das Loeschen des lokalen
   * Datensatzes erfolgt erst clientseitig nach der 2xx-Antwort.
   *
   * Autorisierung nach den Entscheidungen der Projektleitung
   * (Abschnitt 11, Punkte 2, 5 und 6):
   * - Eine Vormerkung mit Zahlungen darf ausschliesslich ADMINISTRATOR
   *   verwerfen, unabhaengig von Herkunft oder erfassendem Benutzer.
   * - Ein uebernommener Altbestand (legacy) darf sonst nur von
   *   ADMINISTRATOR oder EVENT_MANAGER verworfen werden.
   * - Alles Uebrige darf der erfassende Benutzer oder ADMINISTRATOR
   *   verwerfen.
   */
  async discardOfflineQueueEntry(
    userId: string,
    role: string,
    dto: DiscardOfflineQueueDto,
  ) {
    if (
      typeof dto?.idempotencyKey !== "string" ||
      dto.idempotencyKey.length < 8 ||
      dto.idempotencyKey.length > 128
    ) {
      throw new BadRequestException("A valid idempotencyKey is required");
    }
    const reason = this.normalizeCancellationReason(dto.reason);
    const payments = dto.payments ?? [];
    this.validatePayments(payments);

    // Serverkontakt zuerst, aber auch hier erneut geprueft: existiert die
    // Bestellung bereits, wird nichts geloescht (Abschnitt 7 "Verwerfen").
    const existingOrder = await this.prisma.order.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
      select: { id: true },
    });
    if (existingOrder) {
      throw new ConflictException(
        "Diese Vormerkung liegt bereits als Bestellung beim Server vor und wurde nicht verworfen.",
      );
    }

    const hasPayments = payments.length > 0;
    const isLegacy = dto.legacy === true;
    const isAdmin = role === "ADMINISTRATOR";
    const isEventManager = role === "EVENT_MANAGER";
    const isCapturingUser =
      !!dto.capturedByUserId && dto.capturedByUserId === userId;

    let allowed: boolean;
    if (hasPayments) {
      allowed = isAdmin;
    } else if (isLegacy) {
      allowed = isAdmin || isEventManager;
    } else {
      allowed = isAdmin || isCapturingUser;
    }

    if (!allowed) {
      throw new ForbiddenException(
        "Diese Vormerkung darf von Ihnen nicht verworfen werden.",
      );
    }

    // Audit zuerst, Loeschen danach (Abschnitt 7 "Verwerfen"): das
    // Loeschen des lokalen Datensatzes erfolgt erst clientseitig nach
    // einer 2xx-Antwort. Scheitert das Schreiben des Audit-Ereignisses,
    // muss deshalb auch diese Anfrage scheitern - sonst saehe es fuer den
    // Client wie ein erfolgreiches Verwerfen aus, waehrend die Spur fehlt.
    // Kein try/catch: der Fehler soll unveraendert nach oben durchschlagen.
    await this.auditService.log({
      action: "OFFLINE_QUEUE_DISCARDED",
      entityId: dto.idempotencyKey,
      entityType: "Order",
      userId,
      details: {
        reason,
        capturedByUserId: dto.capturedByUserId ?? null,
        legacy: isLegacy,
        eventId: dto.eventId ?? null,
        totalAtCapture: dto.totalAtCapture ?? null,
        payments,
      },
    });

    return { success: true };
  }

  /**
   * Issue #98: Wiederholungsdruck. Gibt aus, was die Kundschaft braucht
   * (Produktbons und Beleg), löst aber keinen Arbeitsauftrag an eine Station
   * erneut aus (dispatchPrintJobs erhält includeStationTickets: false) und
   * kennzeichnet Beleg wie Produktbons deutlich als Kopie samt Zeitpunkt.
   *
   * Bestellung, Zahlung und Gutscheine werden ausschließlich gelesen, nie
   * verändert - es entstehen keine neuen ProductVoucher-Zeilen, die
   * bestehenden werden lediglich erneut gedruckt.
   */
  async reprintOrder(orderId: string, userId?: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { product: { include: { category: true } } } },
        payments: true,
        vouchers: true,
      },
    });
    if (!order) throw new NotFoundException("Order not found");

    // Issue #98, Punkt 5: der Nachdruck ist auf Bestellungen der
    // Veranstaltung beschränkt, in der die aufrufende Person gerade
    // arbeitet. Einziger tragfähiger Anhaltspunkt dafür ist die aktive
    // Kassensitzung (siehe createOrder/createQuickSale, die genau darüber
    // die Veranstaltung des Verkaufs bestimmen) - ohne eine solche Sitzung
    // in exakt dieser Veranstaltung lässt sich die Zugehörigkeit nicht
    // feststellen, und der Nachdruck wird abgewiesen statt sie zu erraten.
    //
    // Ausnahme ADMINISTRATOR (Rückmeldung der Projektleitung): der Nachdruck
    // wird in der Oberfläche ausschließlich aus "Offene Tische" aufgerufen
    // (UnpaidOrders.tsx), das auch ADMINISTRATOR offensteht. Dort hilft ein
    // Administrator typischerweise ohne eigene Kassensitzung aus (z. B. bei
    // einem Druckerausfall) - er ist der Eskalationsweg und jede Aktion ist
    // ohnehin auditiert (REPRINT_ORDER unten). Für alle anderen Rollen bleibt
    // die Sitzungspflicht bestehen, das ist die eigentliche Zusage des
    // Issues.
    //
    // STATION bleibt bewusst in der Sitzungspflicht, obwohl der Endpunkt die
    // Rolle zulässt: es gibt heute keinen Bildschirm, der für STATION einen
    // Nachdruck auslöst, und die Rolle kann noch keine Kassensitzung öffnen
    // (siehe docs/development/stationskasse.md, Vorbefund zu #66). Sobald
    // #66 Stationssitzungen einführt, greift diese Prüfung für STATION ohne
    // weitere Änderung korrekt - das ist kein Versehen, sondern Absicht.
    if (!userId) {
      throw new ForbiddenException(
        "Für den Nachdruck ist eine Anmeldung erforderlich.",
      );
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user?.role !== "ADMINISTRATOR") {
      const activeSession = await this.prisma.cashierSession.findFirst({
        where: { userId, eventId: order.eventId, status: "ACTIVE" },
      });
      if (!activeSession) {
        throw new ForbiddenException(
          "Der Nachdruck ist nur für Bestellungen der eigenen, aktiven Veranstaltung möglich.",
        );
      }
    }

    // Punkt 3: Titel wie beim ursprünglichen Verkauf. Der einzige Ort, an
    // dem er unverändert seit der Bestellung vorliegt, ist der zuerst
    // erzeugte RECEIPT-Druckauftrag selbst (Order trägt keinen eigenen
    // Titel). Gibt es keinen (z. B. weil beim Verkauf kein Drucker aktiv
    // war), bleibt receiptTitle weg und dispatchPrintJobs greift auf den
    // Standardtitel zurück - das ist kein Erfinden, sondern derselbe
    // Rückfall, den auch der ursprüngliche Verkauf genommen hätte.
    const originalReceiptJob = await this.prisma.printJob.findFirst({
      where: { orderId, jobType: "RECEIPT" },
      orderBy: { createdAt: "asc" },
    });
    const originalReceiptContent = originalReceiptJob?.content as any;
    const originalReceiptTitle: string | undefined =
      originalReceiptContent?.title;

    // Punkt 3: gegebener Betrag und Rückgeld kommen ausschließlich aus
    // Payment, nie erfunden. Nur eine Barzahlung mit gespeichertem
    // tenderedAmount belegt, dass tatsächlich Bargeld floss; fehlt das,
    // bleiben beide Felder weg statt mit einer falschen Null gefüllt zu
    // werden.
    const cashPayment = order.payments.find(
      (p) => p.method === "CASH" && p.tenderedAmount != null,
    );

    // Punkt 2: die Produktbons kommen ausschließlich aus den vorhandenen
    // ProductVoucher-Zeilen dieser Bestellung - es wird nichts angelegt.
    const vouchers: PrintOptions["vouchers"] = order.vouchers.map((voucher) => {
      const item = order.items.find((i) => i.id === voucher.orderItemId);
      return {
        code: voucher.code,
        orderItemId: voucher.orderItemId,
        productId: voucher.productId,
        productName: item?.product.name ?? "Produkt",
        variantName: item?.variantName,
        stationId: item?.product ? resolveTargetStationId(item.product) : null,
        issuedAt: voucher.issuedAt,
      };
    });

    const reprintedAt = new Date();

    await this.dispatchPrintJobs(this.prisma, order, user, {
      receiptTitle: originalReceiptTitle,
      tenderedAmount: cashPayment?.tenderedAmount ?? undefined,
      changeAmount: cashPayment ? cashPayment.changeAmount : undefined,
      vouchers,
      // Punkt 1: kein erneuter Arbeitsauftrag an eine Station.
      includeStationTickets: false,
      // Punkt 4: Beleg und Produktbons als Kopie kennzeichnen.
      reprintedAt,
      // Issue #66, Stationskasse: ein Nachdruck eines Stationsverkaufs
      // muss dieselbe Abholnummer weiterhin tragen. Bei einer Bestellung
      // ohne Station ist order.pickupNumber null, und die Nutzlast bleibt
      // dann wie gehabt ohne das Feld.
      pickupNumber: order.pickupNumber ?? undefined,
    });

    await this.prisma.auditLog.create({
      data: {
        action: "REPRINT_ORDER",
        entityId: orderId,
        entityType: "Order",
        userId,
        details: {
          orderNumber: order.orderNumber,
          totalAmount: order.totalAmount,
          reprintedAt,
          vouchersReprinted: vouchers.length,
        },
      },
    });

    return {
      success: true,
      message:
        "Nachdruckaufträge erfolgreich in die Druckerwarteschlange eingereiht",
    };
  }

  async getUnpaidOrders(eventId: string) {
    return this.prisma.order.findMany({
      where: {
        eventId,
        paymentStatus: { in: ["OPEN", "PARTIALLY_PAID"] },
        lifecycleStatus: { not: "CANCELLED" },
      },
      include: {
        items: {
          include: {
            product: true,
          },
        },
        payments: true,
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async addPaymentsToOrder(
    orderId: string,
    payments: PaymentInputDto[],
    userId: string,
  ) {
    if (!payments || payments.length === 0) {
      throw new BadRequestException("No payments provided");
    }
    const newPaid = this.validatePayments(payments);

    return await this.prisma.$transaction(async (prisma) => {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { payments: true },
      });

      if (!order) throw new NotFoundException("Order not found");
      if (order.paymentStatus === "PAID")
        throw new BadRequestException("Order is already fully paid");

      const currentPaid = order.payments.reduce((sum, p) => sum + p.amount, 0);
      const totalPaid = currentPaid + newPaid;
      if (!Number.isSafeInteger(totalPaid) || totalPaid > 2_147_483_647) {
        throw new BadRequestException(
          "Die Summe aller Zahlungen überschreitet den zulässigen Centbetrag.",
        );
      }

      const newPaymentStatus =
        totalPaid >= order.totalAmount ? "PAID" : "PARTIALLY_PAID";

      const activeSession = userId
        ? await prisma.cashierSession.findFirst({
            where: { userId, eventId: order.eventId, status: "ACTIVE" },
          })
        : null;
      const cashierSessionId = activeSession?.id || null;

      await prisma.payment.createMany({
        data: payments.map((p) => ({
          orderId: order.id,
          amount: p.amount,
          method: p.method,
          status: "COMPLETED",
          cashierSessionId,
        })),
      });

      const updatedOrder = await prisma.order.update({
        where: { id: orderId },
        data: { paymentStatus: newPaymentStatus },
        include: { items: { include: { product: true } }, payments: true },
      });

      if (userId) {
        await prisma.auditLog.create({
          data: {
            action: "PAYMENT_RECEIVED",
            entityId: orderId,
            entityType: "Order",
            userId,
            details: {
              orderNumber: order.orderNumber,
              paymentsCount: payments.length,
              amountPaid: newPaid,
              totalAmount: order.totalAmount,
              newPaymentStatus,
            },
          },
        });
      }

      return updatedOrder;
    });
  }

  async splitPaymentOrder(
    orderId: string,
    items: SplitPaymentItemDto[],
    payments: PaymentInputDto[],
    userId: string,
  ) {
    if (!items || items.length === 0) {
      throw new BadRequestException(
        "Keine Positionen für die Teilzahlung angegeben.",
      );
    }
    if (!payments || payments.length === 0) {
      throw new BadRequestException("Keine Zahlungen angegeben.");
    }
    const newPaid = this.validatePayments(payments);

    return await this.prisma.$transaction(async (prisma) => {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          items: { include: { product: true } },
          payments: true,
          event: true,
        },
      });

      if (!order) {
        throw new NotFoundException(
          "Diese Bestellung wurde nicht gefunden. Bitte die Ansicht aktualisieren.",
        );
      }
      if (order.lifecycleStatus === "CANCELLED") {
        throw new BadRequestException(
          "Eine stornierte Bestellung kann nicht bezahlt werden.",
        );
      }
      if (order.paymentStatus === "PAID") {
        throw new BadRequestException(
          "Diese Bestellung ist bereits vollständig bezahlt.",
        );
      }

      const orderItemMap = new Map(order.items.map((i) => [i.id, i]));
      const requestedQuantities = new Map<string, number>();

      for (const item of items) {
        if (!item.orderItemId || !orderItemMap.has(item.orderItemId)) {
          throw new BadRequestException(
            "Mindestens eine ausgewählte Position gehört nicht zu dieser Bestellung.",
          );
        }
        const cur = requestedQuantities.get(item.orderItemId) ?? 0;
        requestedQuantities.set(item.orderItemId, cur + item.quantity);
      }

      let expectedSplitTotal = 0;
      for (const [itemId, qty] of requestedQuantities.entries()) {
        const orderItem = orderItemMap.get(itemId)!;
        const unpaidQuantity =
          orderItem.quantity - (orderItem.paidQuantity ?? 0);
        if (qty > unpaidQuantity) {
          throw new BadRequestException(
            `Die gewählte Menge (${qty}) für "${orderItem.product.name}" übersteigt die offene Restmenge (${unpaidQuantity}).`,
          );
        }
        expectedSplitTotal += orderItem.priceAtTime * qty;
      }

      if (
        !Number.isSafeInteger(expectedSplitTotal) ||
        expectedSplitTotal > 2_147_483_647
      ) {
        throw new BadRequestException(
          "Der berechnete Teilbetrag überschreitet den zulässigen Betragsrahmen.",
        );
      }

      if (newPaid !== expectedSplitTotal) {
        throw new BadRequestException(
          `Der Zahlungsbetrag (${newPaid} Cent) stimmt nicht mit der Summe der ausgewählten Positionen (${expectedSplitTotal} Cent) überein.`,
        );
      }

      const activeSession = userId
        ? await prisma.cashierSession.findFirst({
            where: { userId, eventId: order.eventId, status: "ACTIVE" },
          })
        : null;
      const cashierSessionId = activeSession?.id || null;

      // Update paidQuantity for split items
      for (const [itemId, qty] of requestedQuantities.entries()) {
        const orderItem = orderItemMap.get(itemId)!;
        await prisma.orderItem.update({
          where: { id: itemId },
          data: { paidQuantity: orderItem.paidQuantity + qty },
        });
      }

      // Record payments
      await prisma.payment.createMany({
        data: payments.map((p) => ({
          orderId: order.id,
          amount: p.amount,
          method: p.method,
          status: "COMPLETED",
          cashierSessionId,
        })),
      });

      // Check if all items on the order are now fully paid
      let allItemsFullyPaid = true;
      for (const orderItem of order.items) {
        const additionalPaid = requestedQuantities.get(orderItem.id) ?? 0;
        const finalItemPaid = (orderItem.paidQuantity ?? 0) + additionalPaid;
        if (finalItemPaid < orderItem.quantity) {
          allItemsFullyPaid = false;
        }
      }

      const newPaymentStatus = allItemsFullyPaid ? "PAID" : "PARTIALLY_PAID";

      const updatedOrder = await prisma.order.update({
        where: { id: orderId },
        data: { paymentStatus: newPaymentStatus },
        include: { items: { include: { product: true } }, payments: true },
      });

      if (userId) {
        await prisma.auditLog.create({
          data: {
            action: "ORDER_SPLIT_PAYMENT",
            entityId: orderId,
            entityType: "Order",
            userId,
            details: {
              orderNumber: order.orderNumber,
              tableName: order.tableName,
              splitItems: Array.from(requestedQuantities.entries()).map(
                ([id, qty]) => ({
                  orderItemId: id,
                  productName: orderItemMap.get(id)?.product?.name,
                  quantity: qty,
                  priceAtTime: orderItemMap.get(id)?.priceAtTime,
                  totalCents: (orderItemMap.get(id)?.priceAtTime ?? 0) * qty,
                }),
              ),
              amountPaid: newPaid,
              newPaymentStatus,
              cashierSessionId,
            },
          },
        });
      }

      return updatedOrder;
    });
  }

  async cancelOrder(orderId: string, reason: string, userId: string) {
    const normalizedReason = this.normalizeCancellationReason(reason);
    return await this.prisma.$transaction(async (prisma) => {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { items: true, payments: true },
      });

      if (!order)
        throw new NotFoundException(
          "Diese Bestellung wurde nicht gefunden. Bitte die Ansicht aktualisieren.",
        );
      if (order.lifecycleStatus === "CANCELLED")
        throw new BadRequestException(
          "Diese Bestellung ist bereits storniert.",
        );

      const updatedOrder = await prisma.order.update({
        where: { id: orderId },
        data: {
          lifecycleStatus: "CANCELLED",
        },
        include: { items: true, payments: true },
      });

      await prisma.orderItem.updateMany({
        where: { orderId },
        data: { status: "CANCELLED" },
      });

      const cancelledVouchers = await prisma.productVoucher.updateMany({
        where: { orderId, status: "ISSUED" },
        data: { status: "CANCELLED" },
      });

      await prisma.auditLog.create({
        data: {
          action: "CANCEL_ORDER",
          entityId: orderId,
          entityType: "Order",
          userId,
          details: {
            reason: normalizedReason,
            totalAmount: order.totalAmount,
            paymentsCount: order.payments.length,
            vouchersCancelled: cancelledVouchers.count,
          },
        },
      });

      return updatedOrder;
    });
  }

  async cancelOrderItem(orderItemId: string, reason: string, userId: string) {
    const normalizedReason = this.normalizeCancellationReason(reason);
    return await this.prisma.$transaction(async (prisma) => {
      const item = await prisma.orderItem.findUnique({
        where: { id: orderItemId },
        include: { order: { include: { items: true } } },
      });

      if (!item)
        throw new NotFoundException(
          "Diese Position wurde nicht gefunden. Bitte die Ansicht aktualisieren.",
        );
      if (item.status === "CANCELLED")
        throw new BadRequestException("Diese Position ist bereits storniert.");

      const updatedItem = await prisma.orderItem.update({
        where: { id: orderItemId },
        data: { status: "CANCELLED" },
      });

      const cancelledVouchers = await prisma.productVoucher.updateMany({
        where: { orderItemId, status: "ISSUED" },
        data: { status: "CANCELLED" },
      });

      const order = item.order;
      const remainingItems = order.items.filter(
        (i) => i.id !== orderItemId && i.status !== "CANCELLED",
      );

      const newTotal = remainingItems.reduce(
        (sum, i) => sum + i.priceAtTime * i.quantity,
        0,
      );
      const isAllCancelled = remainingItems.length === 0;

      await prisma.order.update({
        where: { id: order.id },
        data: {
          totalAmount: newTotal,
          lifecycleStatus: isAllCancelled ? "CANCELLED" : order.lifecycleStatus,
        },
      });

      await prisma.auditLog.create({
        data: {
          action: "CANCEL_ORDER_ITEM",
          entityId: orderItemId,
          entityType: "OrderItem",
          userId,
          details: {
            reason: normalizedReason,
            orderId: order.id,
            productId: item.productId,
            itemPrice: item.priceAtTime,
            quantity: item.quantity,
            vouchersCancelled: cancelledVouchers.count,
          },
        },
      });

      return updatedItem;
    });
  }

  async updatePriority(orderId: string, isPriority: boolean) {
    return this.prisma.order.update({
      where: { id: orderId },
      data: { isPriority },
    });
  }
}
