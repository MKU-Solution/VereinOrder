# API-Eingabevertrag

Stand: Issue #69. Dieser Vertrag gilt für alle mutierenden JSON-Endpunkte.

## Globale Regeln

- JSON-Objekte werden gegen DTO-Klassen geprüft. Unbekannte Felder – auch in
  verschachtelten Objekten – liefern HTTP 400 und erreichen den Service nicht.
- Es gibt keine implizite Typumwandlung. `"500"`, `"false"`, gebrochene
  Ganzzahlen, `NaN` und Int32-Überläufe sind ungültig.
- UUID-Felder enthalten UUID v4. Eine optionale Beziehung wird ausgelassen oder
  als `null` gesendet; der Leerstring ist keine UUID.
- Namen werden getrimmt und sind höchstens 200 Zeichen lang. Beschreibungstexte
  sind höchstens 2.000, Gründe und Kommentare höchstens 500 Zeichen lang.
- Centbeträge sind Ganzzahlen. Preise und Kassenstände liegen zwischen 0 und
  2.147.483.647 Cent; eingehende Zahlungen beginnen bei 1 Cent.
- Eine Bestellmenge liegt zwischen 1 und 100. Eine Bestellung enthält höchstens
  50 Positionen und insgesamt höchstens 100 Einheiten.
- Dynamische Event-, Kategorie-, Stations-, Bereichs-, Produkt- und
  Kassensitzungsreferenzen werden vor dem Schreiben auf dasselbe Event geprüft.
- Test- und Echtbetrieb sowie die bestehende Rollenmatrix bleiben unverändert.

Validierungsfehler haben ausschließlich dieses öffentliche Format; abgelehnte
Werte, PINs, Tokens, Hashes, SQL-/Prisma-Details und Stacktraces werden nie
ausgegeben:

```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "code": "VALIDATION_ERROR",
  "message": "Die Eingabe ist ungültig.",
  "errors": [
    {
      "field": "items.0.quantity",
      "code": "isInt",
      "message": "Muss eine ganze Zahl sein."
    }
  ]
}
```

Fachliche Fehleingaben verwenden `code: "BAD_REQUEST"`, einen serverseitig
definierten Meldungstext und eine leere `errors`-Liste.

## Authentifizierung und Benutzer

| Endpunkt               | Erlaubter Body                                           |
| ---------------------- | -------------------------------------------------------- |
| `POST /auth/login`     | `username` (Pflicht, max. 64), `pin` (Pflicht, max. 128) |
| `POST /auth/switch`    | wie Login                                                |
| `POST /users`          | `username`, `pin` (4–12 Ziffern), `role`                 |
| `PATCH /users/:id`     | optional `username`, `role`, `isActive`                  |
| `PATCH /users/:id/pin` | `pin` (4–12 Ziffern)                                     |

Die PIN-Form wird bei Login und Benutzerwechsel absichtlich erst im Auth-Service
behandelt, damit Dummy-Bcrypt, Drosselung und Audit auch für fehlgeformte
Versuche greifen. Anlage und PIN-Änderung verlangen dagegen 4–12 Ziffern.

## Veranstaltungen und Stammdaten

| Endpunkt                                 | Erlaubter Body                                                                                     |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `POST /events`                           | `name`; optional `organizer`, `location`, `startTime`, `endTime`, `timezone`                       |
| `PATCH /events/:id`                      | optionale änderbare Felder aus `POST /events`; kein `status`, `testMode`, `eventId` oder RKSV-Feld |
| `POST /events/:sourceId/duplicate`       | optional `name`                                                                                    |
| `POST /events/:sourceId/assortment-copy` | `targetEventId`, `stationMappings` (Quellstations-UUID → Zielstations-UUID oder `null`)            |
| `POST /events/:id/activate`              | `confirmed: true`                                                                                  |
| `PATCH /events/:id/status`               | `status` gemäß erlaubtem Lifecycle                                                                 |
| `POST /events/:id/clean-test-data`       | `confirmationName`                                                                                 |
| `POST /events/config-import`             | versionierter Exportvertrag; max. 1 MB, max. Tiefe 20, strikte Feldlisten                          |
| `POST /areas`                            | `name`, `eventId`; optional `sortOrder`                                                            |
| `PATCH /areas/:id`                       | optional `name`, `sortOrder`                                                                       |
| `POST /stations`                         | `name`, `eventId`; optional `shortName`, `color`, `sortOrder`, `isActive`, `printerId`             |
| `PATCH /stations/:id`                    | optionale änderbare Stationsfelder; kein `eventId`                                                 |
| `PATCH /stations/items/:itemId/status`   | `status`: `PENDING`, `PREPARING`, `READY` oder `CANCELLED`                                         |
| `POST /categories`                       | `name`, `eventId`; optional `sortOrder`, `targetStationId`                                         |
| `PATCH /categories/:id`                  | optionale änderbare Kategoriefelder; kein `eventId`                                                |
| `POST /products`                         | `name`, `price`, `categoryId`, `eventId`; optionale Produkt- und Optionsgruppenfelder              |
| `PATCH /products/:id`                    | optionale änderbare Produkt- und Optionsgruppenfelder; kein `eventId`                              |
| `PATCH /products/:id/availability`       | `availability` gemäß Produktstatus-Enum                                                            |

Optionsgruppen enthalten höchstens 20 Optionen; ein Produkt höchstens zehn
Gruppen. `priceEffect` liegt zwischen −1.000.000 und 1.000.000 Cent.

## Bestellungen, Zahlungen und Kassensitzungen

| Endpunkt                             | Erlaubter Body                                                                                        |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `POST /orders`                       | `eventId`, `items`; optional `payments`, `areaId`, `tableName`, `cashierSessionId`, `idempotencyKey`  |
| `POST /orders/quick-sale`            | `eventId`, `idempotencyKey`, `items`, `paymentMethod` (`CASH` oder `CARD`); optional `tenderedAmount` |
| `POST /orders/station-sale`          | `eventId`, `stationId`, `idempotencyKey`, `items`, `paymentMethod: "CASH"`; optional `tenderedAmount` |
| `POST /orders/offline-queue/discard` | Identitäts- und Bestätigungsfelder des Offlineeintrags gemäß `DiscardOfflineQueueDto`                 |
| `POST /orders/:id/payments`          | `payments` (nicht leer, positive Int32-Centbeträge)                                                   |
| `POST /orders/:id/cancel`            | `reason` (max. 500)                                                                                   |
| `POST /orders/items/:itemId/cancel`  | `reason` (max. 500)                                                                                   |
| `PATCH /orders/:id/priority`         | `isPriority` (Boolean)                                                                                |
| `POST /sessions`                     | `eventId`, `startingBalance`                                                                          |
| `PATCH /sessions/:id/close`          | `closingBalance`                                                                                      |

Positionspreise werden ausschließlich serverseitig aus dem aktuellen Sortiment
berechnet. Der Client darf keine Preis-, Gesamt-, Status-, Benutzer- oder
Event-Snapshots einschleusen.

## Druck, Wartung und Sicherungen

| Endpunkt                         | Erlaubter Body                                           |
| -------------------------------- | -------------------------------------------------------- |
| `PATCH /print-jobs/:id/phase`    | `leaseId`, `phase`; optional `cupsJobId`                 |
| `POST /print-jobs/:id/heartbeat` | `leaseId`                                                |
| `PATCH /print-jobs/:id/status`   | `leaseId`, `outcome`; optionale begrenzte Diagnosefelder |
| `POST /print-jobs/:id/resolve`   | `resolution`; optional `targetPrinterId`, `comment`      |
| `POST /print-jobs/printers`      | `name`, `type`; optionale typisierte Druckerfelder       |
| `PATCH /print-jobs/printers/:id` | optionale typisierte Druckerfelder                       |
| `POST /maintenance/start`        | optional `reason`, `expectedUntil` (ISO 8601)            |

Backup-Dateinamen sind auf sichere `.json`-Namen begrenzt. Vor einer
Wiederherstellung wird das Dokument vollständig vor jeder Sicherung oder
Datenbanktransaktion geprüft: Formatversion `0.1.0`, bekannte Tabellen und
Felder, höchstens 256 MiB, höchstens 100.000 Zeilen je Tabelle/500.000 insgesamt,
Int32-Zahlen sowie eventgleiche Kategorie-/Stationsreferenzen. Alte Sicherungen
ohne den später ergänzten Gutscheinblock bleiben lesbar.

## Frontend-Hinweise

- Formulare senden optionale leere Beziehungen als `null` oder lassen sie aus.
- Zahlen und Booleanwerte werden als JSON-Zahlen beziehungsweise JSON-Booleans
  gesendet, nicht als Strings.
- Die Event-Aktivierung sendet `{ "confirmed": true }`.
- Das Frontend liest weiterhin ein stringförmiges `message`-Feld aus 400-Antworten.
