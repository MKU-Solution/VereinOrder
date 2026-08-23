import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@vereinorder/database";
import { ORDER_REJECTION_MESSAGES } from "@vereinorder/shared";

// Einzige Vergabe der Abholnummer (Issue #66, Stationskasse). Wie
// target-station.ts fuer die Zielstation ist das hier die einzige Stelle, die
// die Regel kennt; wer sie an einer zweiten Stelle nachbaut, gibt frueher oder
// spaeter zwei Personen dieselbe Nummer.
//
// ---------------------------------------------------------------------------
// Warum ein eigener Zaehler und nicht "Order"."orderNumber"
// ---------------------------------------------------------------------------
// "Order"."orderNumber" ist @default(autoincrement()), in PostgreSQL also eine
// SERIAL. Drei Gruende, warum das die Zusage des Issues nicht erfuellt:
//   1. Sie zaehlt global ueber alle Veranstaltungen, nicht je Veranstaltung.
//   2. Test- und Echtverkaeufe ziehen aus derselben Sequenz. Das verletzt
//      "Test- und Echtbetrieb werden nie vermischt" unmittelbar.
//   3. nextval ist nicht transaktional. Jeder Rollback der Verkaufstransaktion
//      nach dem Anlegen der Bestellung - etwa ein Fehler bei der Gutschein-
//      oder Druckauftragserzeugung - verbrennt die Nummer dauerhaft. Am Tresen
//      ist das die Nummer, die nie aufgerufen wird.
// "EventPickupCounter" ist deshalb eine gewoehnliche Zeile, kein nextval:
// bricht die Transaktion nach der Vergabe ab, wird die Erhoehung mit
// zurueckgenommen und die naechste erfolgreiche Zahlung bekommt dieselbe
// Nummer. Genau das kann SERIAL nicht, und genau das ist die Begruendung fuer
// die eigene Tabelle.
//
// ---------------------------------------------------------------------------
// Sperrreihenfolge - hier nachlesen, bevor jemand sie aendert
// ---------------------------------------------------------------------------
// Innerhalb der Verkaufstransaktion (orders.service.ts, createQuickSale) gilt:
//
//     Event  ->  Kassensitzung  ->  Zaehler
//
// Die Veranstaltung wird als erstes mit SELECT ... FOR UPDATE gesperrt (seit
// Issue #52), danach die aktive Kassensitzung, und erst danach darf diese
// Vergabe laufen. Wer die Reihenfolge umstellt und den Zaehler vor die
// Veranstaltung zieht, baut eine Verklemmung: zwei Kassen derselben
// Veranstaltung haetten dann jede eine der beiden Zeilen und warteten
// wechselseitig auf die andere. Die Vergabe gehoert ans Ende der Pruefungen,
// unmittelbar vor das Anlegen der Bestellung - jede Ablehnung davor soll die
// Zeile gar nicht erst angefasst haben.
//
// Zusaetzliche Kosten entstehen dabei nicht: Verkaeufe derselben
// Veranstaltung laufen wegen der Eventsperre ohnehin streng nacheinander. Die
// Zaehlerzeile fuegt dem keine neue Engstelle hinzu.

// Obergrenze der vergebenen Nummer. Fuenfstellig, weil die Nummer laut
// aufrufbar bleiben muss. Der Wert ist im Festbetrieb unerreichbar; die
// Pruefung ist eine Reissleine gegen einen entlaufenen Zaehler, keine
// Betriebsgrenze.
export const MAX_PICKUP_NUMBER = 99_999;

/**
 * Zieht die naechste Abholnummer der Veranstaltung fuer die gegebene
 * Betriebsart und gibt sie zurueck.
 *
 * `tx` MUSS der Transaktionsclient des laufenden Verkaufs sein, niemals ein
 * eigener Client und niemals `this.prisma`. Laege die Vergabe ausserhalb der
 * Verkaufstransaktion, wuerde ein Abbruch des Verkaufs die Erhoehung nicht
 * mit zuruecknehmen - und damit waere die Luecke wieder da, gegen die diese
 * Tabelle ueberhaupt eingefuehrt wurde. Der Parametertyp
 * `Prisma.TransactionClient` haelt das fest: ein voller `PrismaClient` ist
 * damit zwar zuweisbar, aber die Absicht steht in der Signatur.
 *
 * Genau eine SQL-Anweisung. `INSERT ... ON CONFLICT DO UPDATE` legt die
 * Zeile beim ersten Verkauf einer Veranstaltung an und erhoeht sie sonst; der
 * Konfliktzweig sperrt die Zeile bis zum Commit, zwei gleichzeitige Kassen
 * koennen dieselbe Nummer also nicht ziehen - die zweite wartet. Ein
 * getrenntes SELECT mit anschliessendem UPDATE waere hier falsch: zwischen den
 * beiden Anweisungen liegt genau das Fenster, in dem zwei Kassen denselben
 * Stand lesen.
 *
 * Getrennt nach `dataMode`, weil der Primaerschluessel des Zaehlers
 * (eventId, dataMode) ist: Test- und Echtbetrieb haben getrennte Staende und
 * beginnen jeweils bei 1.
 */
export async function drawPickupNumber(
  tx: Prisma.TransactionClient,
  eventId: string,
  dataMode: "TEST" | "LIVE",
): Promise<number> {
  const rows = await tx.$queryRaw<{ lastNumber: number }[]>(Prisma.sql`
    INSERT INTO "EventPickupCounter" ("eventId", "dataMode", "lastNumber", "updatedAt")
    VALUES (${eventId}, ${dataMode}::"OperationalDataMode", 1, now())
    ON CONFLICT ("eventId", "dataMode")
    DO UPDATE SET "lastNumber" = "EventPickupCounter"."lastNumber" + 1,
                  "updatedAt" = now()
    RETURNING "lastNumber"
  `);

  const pickupNumber = rows[0]?.lastNumber;
  // Sollte nicht eintreten: RETURNING liefert bei INSERT wie bei DO UPDATE
  // genau eine Zeile. Wenn doch, ist ein Verkauf ohne Nummer die schlechtere
  // Antwort als eine Ablehnung - der Bon waere nicht abholbar.
  if (typeof pickupNumber !== "number" || !Number.isInteger(pickupNumber)) {
    throw new BadRequestException(
      ORDER_REJECTION_MESSAGES.PICKUP_NUMBER_EXHAUSTED,
    );
  }

  // Ueberlauf fuehrt zur Ablehnung, nicht zum Umbruch. Ein Umbruch (Modulo)
  // gaebe zwei Personen dieselbe Nummer, und eine gekuerzte Anzeige waere am
  // Tresen ebenso mehrdeutig. Da die Transaktion hier abbricht, bleibt der
  // Zaehler stehen und laeuft nicht weiter hoch.
  if (pickupNumber > MAX_PICKUP_NUMBER) {
    throw new BadRequestException(
      ORDER_REJECTION_MESSAGES.PICKUP_NUMBER_EXHAUSTED,
    );
  }

  return pickupNumber;
}
