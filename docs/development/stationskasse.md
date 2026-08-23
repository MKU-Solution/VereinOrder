# Stations- und Abholkassenmodus (Issue #66)

Entwurf zur Umsetzung. Verbindlich für Datenmodell, Backend, Druck und Oberfläche.
Ergänzt `produktoptionen-schnittstelle.md` (Bestellannahme, Idempotenz des
Schnellverkaufs) und `printing.md`.

Grundhaltung dieses Entwurfs: Der weitaus größte Teil von #66 ist durch die zentrale
Bonkasse (#52) und die Produktbons (#15) bereits gebaut. Neu gebaut wird nur, was
tatsächlich fehlt.

## 1. Ausgangslage

### Vorhanden

| Zusage aus #66                                                               | Fundstelle                                                                                   |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Atomare Erstellung Bestellung/Zahlung/Bons/Druckjob                          | `apps/backend/src/orders/orders.service.ts:369-660` (eine `$transaction`)                    |
| Idempotenz mit strenger Wiederholungsprüfung                                 | `orders.service.ts:373-431`                                                                  |
| Barzahlung mit Gegeben und Rückgeld                                          | `orders.service.ts:533-557`                                                                  |
| Ganzzahlige Centbeträge, Betragsgrenzen                                      | `orders.service.ts:317-322`, `524-532`                                                       |
| Test- und Echtbetrieb getrennt                                               | `orders.service.ts:436-447` (`dataMode` aus Event), `470-481` (Sitzungsmodus muss passen)    |
| Ausverkaufte Produkte nicht verkaufbar                                       | `orders.service.ts:499-509`, Kontext filtert `DISABLED` bei `orders.service.ts:132`          |
| Zeitnahe Sichtbarkeit von Verfügbarkeitsänderungen                           | `apps/backend/src/products/products.service.ts:123` (`PRODUCT_AVAILABILITY_CHANGED`)         |
| Ein `ProductVoucher` je verkaufter Einheit                                   | `orders.service.ts:600-620`                                                                  |
| Produktbon mit Veranstaltung, Station, Produkt, Variante, Zeit, RKSV-Hinweis | `orders.service.ts:738-757`, Druckbild `apps/print-worker/src/printing/documents.ts:136-181` |
| Wiederholungsdruck als Endpunkt, Rolle `STATION` bereits zugelassen          | `apps/backend/src/orders/orders.controller.ts:111-116`                                       |
| Zielstation eines Produkts, einzige Auflösung und fertiger Filter            | `apps/backend/src/common/target-station.ts:20-42`                                            |
| Auswahlgruppen/Kachelableitung für die Kasse                                 | `orders.service.ts:126-212`, `apps/frontend/src/pages/QuickSaleDashboard.tsx:216-262`        |

### Der Vorbefund der Projektleitung

Alle drei Punkte bestätigen sich.

1. **Keine Stationsbindung.** `QuickSaleDto` (`orders.service.ts:47-57`) kennt kein
   Stationsfeld; die Produktabfrage im Verkauf filtert nur nach Veranstaltung
   (`orders.service.ts:487`), der Kontext gar nicht (`orders.service.ts:130`). Die
   Station taucht erst nachgelagert bei der Bonleitung auf
   (`orders.service.ts:614`, `dispatchPrintJobs` ab `664`).
2. **Kein Zugang für `STATION`.** Frontend: `routeAccess.ts:15-19`. Backend:
   `orders.controller.ts:23` und `:29`. Beide Stellen führen nur `ADMINISTRATOR`
   und `CASHIER`.
3. **Keine callbare Abholnummer.** `orders.service.ts:605` erzeugt
   `randomBytes(12).toString("hex").toUpperCase()`, also 24 Hexzeichen.

### Was im Vorbefund fehlte

- **`reprintOrder` druckt die Produktbons nicht mit.** `orders.service.ts:1265` ruft
  `dispatchPrintJobs(this.prisma, order, user)` ohne viertes Argument auf.
  `options.vouchers` ist damit leer (`orders.service.ts:667`, `736`), und es
  entstehen nur Stationsbon und Beleg. Genau der Bon, den die Kundschaft am Tresen
  braucht, wird heute nicht nachgedruckt. Das ist die größte Lücke gegenüber dem
  Akzeptanzkriterium „Wiederholungsdruck".
- **Der Nachdruck weicht vom Original ab.** Ohne `options` fällt der Belegtitel auf
  `"KASSENBELEG"` zurück (`orders.service.ts:772` gegen `627`), `tenderedAmount`
  entfällt und `changeAmount` wird auf 0 gerechnet (`orders.service.ts:774-776`).
- **Keine Kopiekennzeichnung.** Weder Nutzlast noch Druckbild kennen sie
  (`documents.ts:136-181`). Ein nachgedruckter Abholschein ist vom Original nicht zu
  unterscheiden — bei Abholware heißt das doppelte Warenausgabe.
- **Der Nachdruck feuert den Arbeitsbon erneut.** `dispatchPrintJobs` erzeugt immer
  auch `STATION_TICKET` (`orders.service.ts:700-728`); die Station bekommt den
  Arbeitsauftrag ein zweites Mal.
- **Es gibt keine Einlösung.** `ProductVoucher.redeemedAt` und `redeemedAtStationId`
  (`packages/database/prisma/schema.prisma:415-417`) werden nirgends geschrieben; eine
  Suche über `apps/backend`, `apps/frontend` und `apps/print-worker` nach
  `redeem` liefert null Treffer. Der Bon-Code ist heute reiner Druckinhalt.
- **`STATION` kann keine Kassensitzung öffnen.** `sessions.controller.ts:19` setzt
  klassenweit `@Roles("ADMINISTRATOR", "WAITER", "CASHIER")`; `routeAccess.ts:34-38`
  (`/cashier`) ebenso. Ohne Sitzung weist `createQuickSale` jeden Verkauf ab
  (`orders.service.ts:474-479`). Ohne diese beiden Änderungen ist der Modus für die
  Zielrolle nicht benutzbar.
- **`GET /stations` blendet Testveranstaltungen aus.** `stations.service.ts:11-19`
  filtert `event: { status: "ACTIVE" }`. Eine Stationskasse im Testbetrieb fände dort
  keine Station. Der Kontext dieses Modus darf diesen Endpunkt deshalb nicht benutzen.
- **`createQuickSale` fängt `P2002` nicht ab.** Zwei echt gleichzeitige Anfragen mit
  demselben Schlüssel lesen beide bei `orders.service.ts:373` „nicht vorhanden";
  die zweite scheitert bei `order.create` (`:564`) mit einem unbehandelten
  Unique-Verstoß, also 500 statt Wiederholungsantwort. `createOrder` behandelt genau
  diesen Fall (`orders.service.ts:1062-1080`). Bestandslücke, mit der Abholnummer
  aber sichtbarer, weil die Bedienung nach dem 500 erneut drückt.

## 2. Abgrenzung zur zentralen Bonkasse

**Entscheidung: ein gemeinsamer Weg im Service, zwei getrennte Endpunkte und zwei
getrennte Oberflächen.**

`createQuickSale` bleibt die einzige Stelle, an der ein bezahlter Bonverkauf
entsteht. Sie bekommt ein optionales `stationId`. Ist es gesetzt, gilt der
Stationsmodus: Sortiment auf die Station eingeschränkt, Abholnummer gezogen, Station
auf der Bestellung vermerkt, nur Barzahlung.

Begründung:

- Atomizität, Idempotenzprüfung, Sperrreihenfolge, Datenmodus, Sitzungsprüfung,
  Preisauflösung, Betragsgrenzen und Druckerzeugung sind in beiden Modi identisch.
  Das sind rund 280 Zeilen. Ein zweiter Weg verdoppelt sie und damit jeden künftigen
  Fehler — der fehlende `P2002`-Fang oben ist der Beleg dafür, wie schnell zwei
  Wege auseinanderlaufen.
- Die Unterschiede sind eng und parametrisierbar: ein zusätzlicher `WHERE`-Zweig auf
  das Sortiment, eine Nummernvergabe, drei zusätzliche Felder in der Drucknutzlast.
  Das sind keine Sonderfälle, die den gemeinsamen Weg unübersichtlich machen.
- Was wirklich getrennt gehört, ist die **Rollenmatrix**, nicht die Transaktion.
  Getrennte Endpunkte lösen das: `POST /orders/quick-sale` bleibt bei
  `ADMINISTRATOR, CASHIER`, `POST /orders/station-sale` bekommt zusätzlich `STATION`.
  Damit erhält die Rolle `STATION` keinen Zugriff auf die zentrale Bonkasse, obwohl
  darunter derselbe Code läuft.

Neue Endpunkte (dünne Schalen, beide leiten auf denselben Service):

| Endpunkt                           | Rollen                                | Aufruf                                            |
| ---------------------------------- | ------------------------------------- | ------------------------------------------------- |
| `GET /orders/station-sale/context` | `ADMINISTRATOR`, `CASHIER`, `STATION` | `getStationSaleContext(userId)`                   |
| `POST /orders/station-sale`        | `ADMINISTRATOR`, `CASHIER`, `STATION` | `createQuickSale(userId, { ...body, stationId })` |

`GET /orders/quick-sale/context` und `POST /orders/quick-sale` bleiben unverändert.
Ein `stationId` im Rumpf von `/quick-sale` wird abgewiesen, damit der Modus nicht
über den falschen Endpunkt erreichbar ist.

## 3. Die Abholnummer

### Warum `orderNumber` nicht trägt

`Order.orderNumber` ist `@default(autoincrement())`
(`schema.prisma:318`), in Postgres also `SERIAL`
(`packages/database/prisma/migrations/20260818115353_feat_orders/migration.sql:10`).
Drei Gründe, warum das die Zusage des Issues nicht erfüllt:

1. **Nicht veranstaltungsbezogen.** Eine Sequenz zählt global über alle
   Veranstaltungen.
2. **Nicht getrennt nach Betriebsart.** Test- und Echtverkäufe ziehen aus derselben
   Sequenz. Das verletzt „Test- und Echtbetrieb werden nie vermischt" direkt.
3. **Lückenhaft.** `nextval` ist nicht transaktional. Jeder Rollback in
   `createQuickSale` nach `order.create` (`orders.service.ts:564`) — etwa ein
   Fehler bei der Gutschein- oder Druckauftragserzeugung — verbrennt die Nummer
   dauerhaft. Am Tresen ist das die Nummer, die nie aufgerufen wird.

Zusätzlich ist der Wert nach kurzer Zeit fünf- bis sechsstellig und damit nicht
rufbar.

### Vergabeverfahren

Eine eigene Zählertabelle, hochgezählt **innerhalb** der bestehenden
Verkaufstransaktion:

```prisma
model EventPickupCounter {
  eventId    String
  event      Event               @relation(fields: [eventId], references: [id], onDelete: Cascade)
  dataMode   OperationalDataMode
  lastNumber Int                 @default(0)
  updatedAt  DateTime            @updatedAt

  @@id([eventId, dataMode])
}
```

Vergabe als eine Anweisung, unmittelbar vor `prisma.order.create`
(`orders.service.ts:564`), also nach allen Prüfungen:

```sql
INSERT INTO "EventPickupCounter" ("eventId", "dataMode", "lastNumber")
VALUES ($1, $2, 1)
ON CONFLICT ("eventId", "dataMode")
DO UPDATE SET "lastNumber" = "EventPickupCounter"."lastNumber" + 1
RETURNING "lastNumber"
```

### Nebenläufigkeit

- `ON CONFLICT DO UPDATE` sperrt die Zählerzeile bis zum Commit. Zwei gleichzeitige
  Kassen können dieselbe Nummer nicht ziehen; die zweite wartet.
- **Keine Lücken.** Der Zähler ist eine gewöhnliche Zeile, kein `nextval`. Bricht die
  Transaktion nach der Vergabe ab, wird auch die Erhöhung zurückgenommen. Die
  nächste erfolgreiche Zahlung bekommt dieselbe Nummer. Genau das kann `SERIAL`
  nicht.
- **Die Serialisierung kostet nichts zusätzlich.** `createQuickSale` hält seit #52
  ohnehin ein `SELECT … FROM "Event" … FOR UPDATE` über die gesamte Transaktion
  (`orders.service.ts:436-439`). Verkäufe derselben Veranstaltung laufen also heute
  schon streng nacheinander. Die Zählerzeile fügt dem keine neue Engstelle hinzu.
- **Sperrreihenfolge:** Event (`:436`) → Kassensitzung (`:465`) → Zähler. Diese
  Reihenfolge ist einzuhalten, damit keine Verklemmung entstehen kann.
- Absicherung im Schema, nicht nur im Code:
  `@@unique([eventId, dataMode, pickupNumber])` auf `Order`. In Postgres gelten
  `NULL`-Werte als verschieden, Bestandsbestellungen ohne Nummer stören also nicht.

### Zusammenspiel mit der Idempotenz

Die Nummer steht auf der **Bestellung**, nicht auf dem Gutschein. Der
Wiederholungs-Kurzschluss (`orders.service.ts:373-431`) greift, bevor irgendetwas
angelegt wird, und gibt die gespeicherte Bestellung zurück. Damit zieht eine
Wiederholung strukturell keine zweite Nummer — es gibt keinen Pfad dorthin.

Drei Ergänzungen sind dafür nötig:

1. Die Wiederholungsantwort (`orders.service.ts:425-431`) muss `pickupNumber`
   mitliefern, sonst zeigt die Kasse nach einem Wiederholungsversuch keine Nummer an.
2. Die strenge Prüfung (`orders.service.ts:405-418`) bekommt zwei weitere
   Abweichungsgründe: `existingOrder.stationId !== (dto.stationId ?? null)` und, wenn
   `dto.stationId` gesetzt ist, `existingOrder.pickupNumber === null`. Ohne den
   ersten Punkt könnte ein Schlüssel einer anderen Station eine fremde Bestellung
   zurückspielen; ohne den zweiten liefert ein über den Stationsendpunkt wiederholter
   Zentralverkauf eine Bestellung ohne Nummer aus.
3. `P2002` bei `order.create` (`orders.service.ts:564`) ist abzufangen und auf
   dieselbe strenge Prüfung zu leiten, wie es `createOrder` bereits tut
   (`orders.service.ts:1062-1080`). Sonst sieht die Bedienung bei echter
   Gleichzeitigkeit einen Serverfehler und drückt erneut.

Ein Storno (`cancelOrder`, `orders.service.ts:1380-1428`) gibt die Nummer **nicht**
frei und vergibt sie nicht neu. Eine stornierte Bestellung behält ihre Nummer; der
Aufruf verhallt einmal. Das ist gewollt: Nummern wiederzuverwenden würde bedeuten,
dass zwei Personen nacheinander dieselbe Nummer halten.

### Wertebereich

- Gezählt wird **je Veranstaltung und Betriebsart**, beginnend bei 1.
- **Nicht je Station.** Begründung: Bei stationsweiser Zählung tragen zwei Stationen
  gleichzeitig eine „14". Ein Bon, der an der zentralen Ausgabe oder an der
  Nachbarstation vorgelegt wird, wäre dann mehrdeutig. Je Veranstaltung ist die
  Nummer im gesamten Fest eindeutig, und das Issue verlangt es wörtlich. Der Preis
  sind etwas längere Nummern; das ist bei einem Vereinsfest ein drei- bis
  vierstelliger Wert und bleibt rufbar.
- Gespeichert als `Int`. Gedruckt wird der volle Wert, ohne Verkürzung oder
  Modulo-Anzeige — eine gekürzte Anzeige wäre wieder mehrdeutig.
- **Überlauf:** Übersteigt der zurückgegebene Wert 99 999, wird der Verkauf mit einer
  deutschen Meldung abgewiesen statt umzubrechen. Ein Umbruch würde zwei Personen
  dieselbe Nummer geben. Der Wert ist im Festbetrieb unerreichbar; die Prüfung ist
  eine Reißleine gegen einen entlaufenen Zähler, keine Betriebsgrenze. Da die
  Transaktion abbricht, bleibt der Zähler dabei stehen.
- **Test und Echt:** durch `dataMode` im Primärschlüssel des Zählers getrennt. Eine
  Veranstaltung, die aus dem Testbetrieb in den Echtbetrieb wechselt, beginnt im
  Echtbetrieb wieder bei 1.
- Die Testdatenbereinigung (`apps/backend/src/events/events.service.ts:398-425`) muss
  die Zeile `(eventId, dataMode = "TEST")` mitlöschen. Sonst zählt eine bereinigte
  Testveranstaltung bei 251 weiter, obwohl keine Bestellung mehr dahinter steht.

### Verhältnis zum Gutscheincode

**Die Nummer ersetzt den Code nicht, sie tritt daneben.** `ProductVoucher.code`
bleibt unverändert (`orders.service.ts:605`).

Begründung: Die beiden beantworten verschiedene Fragen.

- Der Code identifiziert **eine Einheit fälschungssicher**. 24 Hexzeichen sind
  96 Bit; er ist `@unique` (`schema.prisma:392`) und ist laut
  `docs/product/master-prompt.md`, Abschnitt 24, der Träger der späteren Einlösung:
  „Ein Bon darf nicht mehrfach eingelöst werden. Prüfung und Einlösung erfolgen
  serverseitig und transaktionssicher." Die Felder dafür stehen bereits im Schema
  (`schema.prisma:415-417`), nur schreibt sie heute niemand.
- Die Nummer identifiziert **einen Verkauf hörbar**. Sie ist kurz, damit man sie
  rufen kann — und genau deshalb ist sie kein Berechtigungsnachweis. Wer eine
  zweistellige Zahl raten kann, könnte Ware abholen.

Den Code durch die Nummer zu ersetzen, würde die Einlösung aus #15 unbrauchbar
machen, bevor sie gebaut ist. Beide stehen auf demselben Bon: die Nummer groß, der
Code klein.

Zuordnung: eine Bestellung, eine Nummer, mehrere Produktbons. Kauft jemand drei
Artikel, tragen alle drei Bons dieselbe Nummer und jeder seinen eigenen Code. Das
entspricht „Jede erfolgreiche Zahlung erhält genau eine Abholnummer".

Kein neuer `PrintJobType`. Der Abholschein ist der vorhandene `PRODUCT_VOUCHER`
(`schema.prisma:500-506`, `documents.ts:382-383`) mit der Nummer darauf. Ein
eigener Typ hieße Migration, Enum-Erweiterung und ein zweiter Druckzweig für ein
Dokument, das sich in einer Zeile unterscheidet.

## 4. Ablauf eines Verkaufs

1. **Anmeldung.** Benutzer mit Rolle `STATION` (oder `CASHIER`/`ADMINISTRATOR`) meldet
   sich an und öffnet `/station-sale`.
2. **Kontext.** `GET /orders/station-sale/context` liefert je Veranstaltung mit Status
   `ACTIVE` oder `TEST_MODE`: Name, `testMode`, Druckbereitschaft, die eigene aktive
   Kassensitzung und die **aktiven Stationen dieser Veranstaltung**. Produkte werden
   erst nach Stationswahl geladen beziehungsweise clientseitig aus dem
   stationsgefilterten Kontext gebildet.
3. **Station wählen.** Die Wahl ist gesperrt, solange der Warenkorb nicht leer ist —
   analog zur Veranstaltungswahl (`QuickSaleDashboard.tsx:405`).
4. **Kassensitzung.** Ist keine offene Sitzung für Benutzer und Veranstaltung
   vorhanden, blockiert die Seite den Verkauf und bietet den Start an
   (`POST /sessions`). Ein Warenkorb, der erst beim Bezahlen an der fehlenden Sitzung
   scheitert, ist die schlechtere Reihenfolge.
5. **Sortiment.** Nur Produkte, die auf diese Station auflösen, und nur
   Verfügbarkeit ungleich `DISABLED`. Ausverkauftes wird angezeigt, ist aber nicht
   antippbar (`QuickSaleDashboard.tsx:295`).
6. **Warenkorb.** Menge wählen, Kacheln antippen, Zeilen ändern oder löschen, Abbruch
   leert den Warenkorb und zieht einen neuen Idempotenzschlüssel
   (`QuickSaleDashboard.tsx:332-336`). Bis hierher ist nichts gebucht — ein Abbruch
   kann deshalb serverseitig auch nichts auditieren.
7. **Barzahlung.** Gegebener Betrag, Rückgeldanzeige, Bestätigung.
8. **Buchung.** `POST /orders/station-sale`. In **einer** Transaktion: Idempotenzprüfung,
   Event sperren und Datenmodus bestimmen, aktiven Drucker prüfen, Kassensitzung
   sperren und Betriebsart vergleichen, Produkte gegen Veranstaltung **und Station**
   auflösen, Preise rechnen, Barbetrag prüfen, **Abholnummer ziehen**, Bestellung mit
   Zahlung anlegen, je Einheit einen `ProductVoucher`, Druckaufträge, Audit
   `STATION_SALE_COMPLETED`.
9. **Druck.** Arbeitsbon an den Drucker der Station, je Einheit ein Produktbon mit
   Abholnummer und Bon-Code, interner Zahlungsnachweis mit Gegeben und Rückgeld.
10. **Rückmeldung.** Die Oberfläche zeigt Abholnummer und Rückgeld groß und setzt den
    Warenkorb zurück.
11. **Wiederholungsdruck.** `POST /orders/:id/reprint` mit
    `{ scope: "VOUCHERS" }` aus der Erfolgsanzeige heraus. Der Nachdruck ist als
    Kopie gekennzeichnet und verändert Bestellung und Zahlung nicht.

## 5. Notwendige Änderungen

### Datenmodell (`packages/database/prisma/schema.prisma`, neue Migration)

| Änderung                                                  | Stelle                                       |
| --------------------------------------------------------- | -------------------------------------------- |
| `Order.pickupNumber Int?`                                 | `schema.prisma:316-353` (Modell `Order`)     |
| `Order.stationId String?` mit Relation `station Station?` | ebenda                                       |
| `@@unique([eventId, dataMode, pickupNumber])`             | `schema.prisma:350-352` (Indexblock `Order`) |
| Rückrelation `stationSales Order[]`                       | `schema.prisma:100-124` (Modell `Station`)   |
| Neues Modell `EventPickupCounter` (siehe Abschnitt 3)     | neu, hinter `CashierSession`                 |
| Rückrelation `pickupCounters EventPickupCounter[]`        | `schema.prisma:62-87` (Modell `Event`)       |

Keine Änderung an `ProductVoucher`.

### Backend

| Datei und Stelle                                | Änderung                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `orders.service.ts:47-57` (`QuickSaleDto`)      | `stationId?: string` ergänzen                                                                                                                                                                                                                                                                               |
| `orders.service.ts:126` (`getQuickSaleContext`) | Um `getStationSaleContext(userId)` ergänzen: liefert zusätzlich aktive Stationen je Veranstaltung. **Nicht** `GET /stations` benutzen (`stations.service.ts:11-19` blendet `TEST_MODE` aus).                                                                                                                |
| `orders.service.ts:327-366`                     | Eingabeprüfung: `stationId` optional, aber wenn gesetzt, dann `paymentMethod === "CASH"` erzwingen (Nicht-Ziel Kartenzahlung)                                                                                                                                                                               |
| `orders.service.ts:405-418`                     | Zwei zusätzliche Abweichungsgründe in der Wiederholungsprüfung (Abschnitt 3)                                                                                                                                                                                                                                |
| `orders.service.ts:425-431`                     | `pickupNumber` in die Wiederholungsantwort                                                                                                                                                                                                                                                                  |
| nach `orders.service.ts:481`                    | Station laden und prüfen: existiert, `isActive`, `eventId === dto.eventId`. Sonst `400` mit deutscher Meldung                                                                                                                                                                                               |
| `orders.service.ts:485-489`                     | Produktabfrage um `...productAtStationFilter(dto.stationId)` erweitern (aus `common/target-station.ts:33`) — **kein zweiter Filter**                                                                                                                                                                        |
| vor `orders.service.ts:564`                     | Abholnummer ziehen, Überlaufprüfung                                                                                                                                                                                                                                                                         |
| `orders.service.ts:564-595`                     | `pickupNumber` und `stationId` auf der Bestellung setzen                                                                                                                                                                                                                                                    |
| `orders.service.ts:564` (Fehlerbehandlung)      | `P2002` auf `idempotencyKey` abfangen und auf die strenge Prüfung leiten, analog `orders.service.ts:1062-1080`                                                                                                                                                                                              |
| `orders.service.ts:632-657`                     | Auditeintrag: `stationId` und `pickupNumber` in `details`; Aktion `STATION_SALE_COMPLETED`, wenn `stationId` gesetzt ist                                                                                                                                                                                    |
| `orders.service.ts:664-672` (`PrintOptions`)    | `pickupNumber?: number`, `isCopy?: boolean`                                                                                                                                                                                                                                                                 |
| `orders.service.ts:706-728`                     | `pickupNumber` in die `STATION_TICKET`-Nutzlast                                                                                                                                                                                                                                                             |
| `orders.service.ts:741-756`                     | `pickupNumber` und `isCopy` in die `PRODUCT_VOUCHER`-Nutzlast                                                                                                                                                                                                                                               |
| `orders.service.ts:769-790`                     | `pickupNumber` und `isCopy` in die `RECEIPT`-Nutzlast                                                                                                                                                                                                                                                       |
| `orders.service.ts:1251-1286` (`reprintOrder`)  | `vouchers` mitladen und als `options.vouchers` übergeben; Originaltitel und Beträge aus `order.payments` rekonstruieren; `isCopy: true`; `scope` (`"ALL" \| "VOUCHERS" \| "RECEIPT"`, Vorgabe `"ALL"`); Audit um `stationId`, `pickupNumber`, `scope` erweitern; alle `printJob.create` in eine Transaktion |
| `orders.controller.ts:22-41`                    | Zwei neue Endpunkte (Abschnitt 2); `stationId` an `/quick-sale` abweisen                                                                                                                                                                                                                                    |
| `orders.controller.ts:111-116`                  | `scope` aus dem Rumpf entgegennehmen                                                                                                                                                                                                                                                                        |
| `sessions.controller.ts:19`                     | `STATION` in die klassenweite Rollenliste                                                                                                                                                                                                                                                                   |
| `events.service.ts:398-425`                     | `EventPickupCounter` für `dataMode = "TEST"` mitlöschen und in der Antwortzählung ausweisen                                                                                                                                                                                                                 |

### Druck (`apps/print-worker/src/printing/documents.ts`)

| Stelle                                    | Änderung                                                                                                                                                                                                                |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `documents.ts:136-181` (`productVoucher`) | Abholnummer als groß gesetzter Block (`doubleHeight`, zentriert) über dem Produktnamen; der Bon-Code rückt auf normale Größe zurück (heute `doubleHeight` bei `:171-176`). Fehlt die Nummer, bleibt das Bild wie heute. |
| `documents.ts:183-250` (`receipt`)        | Abholnummer als eigene Zeile, wenn vorhanden                                                                                                                                                                            |
| `documents.ts:105-134` (`stationTicket`)  | Abholnummer statt beziehungsweise neben `Tisch/Bereich`, wenn vorhanden                                                                                                                                                 |
| `documents.ts:81-103` (`footer`)          | Kopiekennzeichnung bei `content.isCopy === true`, für alle Dokumentarten an einer Stelle                                                                                                                                |

### Oberfläche

| Stelle                                                  | Änderung                                                                                                                                                                                                                                                                |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/frontend/src/components/layout/routeAccess.ts:15` | Neuer Eintrag `stationSale: { path: "/station-sale", label: "Stationskasse", roles: ["ADMINISTRATOR", "CASHIER", "STATION"] }`                                                                                                                                          |
| `routeAccess.ts:52-60`                                  | Eintrag in `navigationRoutes` aufnehmen                                                                                                                                                                                                                                 |
| `routeAccess.ts:34-38`                                  | `STATION` bei `/cashier` ergänzen, sonst kann die Station ihre Sitzung nicht abschließen                                                                                                                                                                                |
| `apps/frontend/src/App.tsx:39-50`                       | Route mit `RoleGuard` auf `routeAccess.stationSale`                                                                                                                                                                                                                     |
| neu: `apps/frontend/src/pages/StationSaleDashboard.tsx` | Stationswahl, stationsgefiltertes Kachelraster, Warenkorb, nur Barzahlung, Erfolgsanzeige mit großer Abholnummer und Rückgeld, Knopf für Wiederholungsdruck, Sperre bei fehlender Sitzung oder fehlendem Drucker                                                        |
| neu: `apps/frontend/src/lib/quickSaleTiles.ts`          | Kachelableitung aus `QuickSaleDashboard.tsx:216-262` herausziehen und von beiden Seiten benutzen. Diese rund 90 Zeilen setzen den Vertrag aus `produktoptionen-schnittstelle.md` um; kopiert würden die beiden Kassen bei der nächsten Regeländerung auseinanderlaufen. |
| `QuickSaleDashboard.tsx:216-262`                        | Auf die herausgezogene Funktion umstellen, sonst unverändert                                                                                                                                                                                                            |

Abmessungen laut Issue: 390×844, 768×1024, 1440×900.

### Tests

- Backend-Integration: Atomizität, Idempotenz einschließlich Wiederholung ohne
  zweite Nummer, Rollen je Endpunkt, Produkt einer fremden Station, Produkt einer
  fremden Veranstaltung, Station einer fremden Veranstaltung, fehlende Sitzung,
  Sitzung im falschen Betriebsmodus.
- Nummernvergabe: zwei gleichzeitige Verkäufe derselben Veranstaltung erhalten
  verschiedene, aufeinanderfolgende Nummern; ein abgebrochener Verkauf hinterlässt
  keine Lücke; Test- und Echtzähler bleiben getrennt.
- Drucknutzlast: Abholschein und Produktbon mit Nummer, Kopiekennzeichnung beim
  Nachdruck.
- Browserabläufe: Sitzung starten, verkaufen, Rückgeld, Abbruch, Ausverkauf,
  Wiederholungsdruck; Abnahme mit `admin`, `kellner1` und einer Stationsrolle.

## 6. Was dieser Schnitt nicht löst

- **Einlösung von Produktbons.** `redeemedAt` und `redeemedAtStationId` bleiben
  ungeschrieben. Die Ausgabe an der Station erfolgt weiterhin durch Ansehen des Bons.
  Der Code wird dafür vorbereitet, aber nicht benutzt.
- **Kartenzahlung** am Stationsendpunkt (Nicht-Ziel des Issues).
- **Tischservice und Zustellung** aus diesem Modus heraus.
- **Teilzahlung und geteilte Rechnung.**
- **Lagerführung.** Ausverkauf bleibt eine manuelle Meldung
  (`products.service.ts:110-133`).
- **Feste Zuordnung eines Benutzers zu einer Station.** `User` trägt keine Station
  (`schema.prisma:20-36`); die Station wird bei jedem Schichtbeginn gewählt.
- **Storno durch die Rolle `STATION`.** `POST /orders/:id/cancel` bleibt bei
  `ADMINISTRATOR, WAITER, CASHIER` (`orders.controller.ts:117-119`).
- **Kassenabschluss je Station.** Er ist aus `Order.stationId` ableitbar, wird hier
  aber nicht gebaut.

## 7. Offene Punkte für die Projektleitung

1. **Station an der Kassensitzung?** Dieser Entwurf hängt die Station an die
   Bestellung, nicht an `CashierSession` (`schema.prisma:660-679`). Vorteil: eine
   Person kann die Station wechseln, ohne die Kasse abzuschließen. Nachteil: der
   Abschluss ist nicht ohne Weiteres je Station gegliedert. Soll `CashierSession` ein
   `stationId` bekommen?
2. **Startseite der Rolle `STATION`.** `defaultRouteForRole` führt heute auf
   `/stations`, den Monitor (`routeAccess.ts:68`). Bleibt das so, oder wird
   `/station-sale` die Startseite? Eine Änderung verschiebt die gewohnte Ansicht
   bestehender Benutzer.
3. **Eigener Abholschein je Verkauf?** Dieser Entwurf setzt die Nummer auf jeden
   Produktbon und verzichtet auf ein zusätzliches Dokument. Der Master-Prompt führt
   „Produktbon" und „Abholschein" in Abschnitt 23 getrennt auf. Soll ein
   verkaufsbezogenes Dokument zusätzlich gedruckt werden?
4. **Reicht der Nachdruck ohne Freigabe?** Heute darf jede zugelassene Rolle jede
   Bestellung nachdrucken, ohne Prüfung auf Veranstaltung oder eigene Sitzung
   (`orders.service.ts:1251-1263`). Bei Abholware wiegt das schwerer als bei
   Tischbestellungen. Soll der Nachdruck auf die eigene Sitzung eingeschränkt und
   gezählt werden?
5. **Auch die zentrale Bonkasse mit Abholnummer?** Der Zähler ist
   veranstaltungsbezogen, nicht stationsbezogen; die Erweiterung wäre eine
   Bedingung weniger. Der Master-Prompt nennt „Abholscheine ausgeben" auch für die
   Bonkasse (Zeile 545). Innerhalb von #66 bleibt es beim Stationsmodus.
6. **Umgang mit dem `P2002`-Fund.** Die fehlende Behandlung in `createQuickSale`
   trifft die bestehende Bonkasse ebenso. Innerhalb von #66 mitkorrigieren oder als
   eigenes Issue führen?

## Entscheidungen der Projektleitung

Verbindlich. Ersetzen die Vorschläge im Abschnitt „Offene Punkte".

1. **`CashierSession` bekommt kein `stationId`.** Die Station hängt an der Bestellung, wie im Entwurf vorgesehen. Ein Stationswechsel innerhalb einer Schicht bleibt damit ohne Kassenabschluss möglich; jede Bestellung trägt ihre Station selbst, die Abrechnung bleibt vollständig. Sollte sich im Betrieb zeigen, dass je Station abgerechnet werden muss, ist das ein eigener Vorgang.

2. **Die Startseite der Rolle `STATION` bleibt `/stations`.** Die Stationskasse kommt als zusätzliche Route hinzu, erreichbar über die Navigation. Bestehende Stationsbedienung ändert sich dadurch nicht.

3. **Ein Beleg je Einheit, kein zusätzlicher Abholschein.** Der vorhandene Produktbon trägt die Abholnummer groß und den Code klein. Zwei Papierschnipsel je Einheit sind am Tresen eine Last, und die Nummer identifiziert den Verkauf bereits eindeutig.

4. **Der Nachdruck wird eingeschränkt und gekennzeichnet.** Das gehört nicht in diesen Vorgang, sondern in den vorgezogenen Fehlerbehebung zum Wiederholungsdruck. Siehe Abschnitt „Zuschnitt der Umsetzung".

5. **Die zentrale Bonkasse bekommt keine Abholnummer.** Bewusst außerhalb dieses Schnitts. Falls im Festbetrieb gebraucht, eigener Vorgang.

6. **Der `P2002`-Fund wird in diesem Vorgang mitkorrigiert.** `createQuickSale` wird ohnehin angefasst, und die Ungleichbehandlung gegenüber `createOrder` ist eine Fußangel, die man nicht liegen lässt, wenn man daneben steht.

## Zuschnitt der Umsetzung

Die Befunde 1 bis 4 des Entwurfs zum **Wiederholungsdruck** werden vorgezogen und getrennt behoben.

Begründung: `POST /orders/:id/reprint` erzeugt heute die Stationsbons erneut. Ein Nachdruck sagt der Küche also, sie solle das Essen noch einmal zubereiten. Zugleich wird der Produktbon, den die Kundschaft braucht, gar nicht mitgedruckt, und ein nachgedruckter Beleg ist vom Original ununterscheidbar. Das ist ein Fehler im Bestand mit unmittelbarer Wirkung auf Warenausgabe und Küche — er wartet nicht auf ein großes Vorhaben.

Alles Übrige bleibt in Issue #66.
