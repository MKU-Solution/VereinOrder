# Datenmodell und Statusmaschinen

Dieses Dokument beschreibt das vollständige relationale Datenmodell von VereinOrder sowie die definierten Statusmaschinen für Bestellungen, Kassen, Bons und Druckaufträge.

---

## 1. Relationales Datenbankschema (ER-Diagramm)

```mermaid
erDiagram
    Event ||--o{ User : assigns
    Event ||--o{ Product : contains
    Event ||--o{ Category : groups
    Event ||--o{ Station : manages
    Event ||--o{ Area : defines
    Event ||--o{ Order : contains
    Event ||--o{ CashierSession : records
    Event ||--o{ Printer : configures

    Category ||--o{ Product : categorizes
    Category }o--o| Station : default_station
    Station ||--o{ Product : overrides_station
    Station ||--o| Printer : primary_printer
    Station ||--o| Printer : backup_printer

    Product ||--o{ ProductOptionGroup : configures
    ProductOptionGroup ||--o{ ProductOption : contains

    Area ||--o{ Order : places_in

    Order ||--o{ OrderItem : consists_of
    Order ||--o{ Payment : receives
    Order ||--o{ PrintJob : triggers
    Order }o--o| CashierSession : recorded_in

    OrderItem ||--o{ OrderItemOption : has
    OrderItem }o--o| Station : targeted_to

    CashierSession ||--o{ Payment : collects
    CashierSession ||--o{ CashTransaction : logs
    CashierSession }o--|| User : opened_by

    ProductVoucher }o--|| Event : issued_in
    ProductVoucher }o--|| Product : belongs_to
```

---

## 2. Kernentitäten und Invarianten

| Entität          | Zweck                 | Zentrale Felder & Invarianten                                                                                                                                                       |
| ---------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Event`          | Veranstaltungskontext | `id`, `name`, `status`, `testMode` (Boolean), `rksvConfirmedAt`. Bestimmt den Mandantenkontext für alle Daten.                                                                      |
| `Product`        | Verkaufsprodukt       | `id`, `name`, `priceCents` (`INTEGER`), `availability` (`AVAILABLE`, `LOW`, `OUT_OF_STOCK`), `categoryId`, `stationId` (optional).                                                  |
| `Category`       | Warengruppe           | `id`, `name`, `sortOrder`, `targetStationId` (Standard-Zielstation für alle Produkte dieser Kategorie).                                                                             |
| `Station`        | Zubereitungsort       | `id`, `name`, `primaryPrinterId`, `backupPrinterId`.                                                                                                                                |
| `Order`          | Bestellkopf           | `id`, `orderNumber` (`INTEGER` fortlaufend je Event), `pickupNumber` (`INTEGER` fortlaufend tagesaktuell), `idempotencyKey` (`UNIQUE`), `totalCents`, `status`, `cashierSessionId`. |
| `OrderItem`      | Bestellposition       | `id`, `orderId`, `productId`, `quantity`, `unitPriceCents`, `totalPriceCents`, `status`, `stationId`.                                                                               |
| `Payment`        | Zahlungstransaktion   | `id`, `orderId`, `cashierSessionId`, `amountCents`, `paymentMethod` (`CASH`, `CARD`, `VOUCHER`, `OTHER`), `status`.                                                                 |
| `CashierSession` | Kassensitzung         | `id`, `userId`, `eventId`, `startingBalanceCents`, `closingBalanceCents`, `status` (`ACTIVE`, `CLOSED`), `startTime`, `endTime`.                                                    |
| `PrintJob`       | Druckauftrag          | `id`, `documentType`, `status` (`PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`, `CANCELLED`), `printerId`, `rawPayload`, `attempts`.                                                |
| `AuditLog`       | Revisionsprotokoll    | `id`, `userId`, `action`, `entityType`, `entityId`, `details` (JSON), `createdAt`.                                                                                                  |

---

## 3. Statusmaschinen

### A. Event-Status (`EventStatus`)

```mermaid
stateDiagram-v2
    [*] --> DRAFT : Anlegen
    DRAFT --> PREPARED : Sortiment & Stationen fertig
    PREPARED --> TEST_MODE : Testmodus starten
    TEST_MODE --> PREPARED : Testdaten bereinigt
    PREPARED --> ACTIVE : Scharf schalten (RKSV-Bestätigung)
    ACTIVE --> PAUSED : Pausieren (z. B. Unwetter)
    PAUSED --> ACTIVE : Fortsetzen
    ACTIVE --> COMPLETED : Veranstaltung abschließen
    COMPLETED --> ARCHIVED : Archivieren
    ARCHIVED --> [*]
```

### B. Bestellstatus (`OrderStatus`)

```mermaid
stateDiagram-v2
    [*] --> RECEIVED : Erfasst (POST /orders)
    RECEIVED --> IN_PREPARATION : Station beginnt Zubereitung
    IN_PREPARATION --> READY : Alle Stationen fertig
    READY --> DELIVERED : Vom Runner/Kellner ausgeliefert

    RECEIVED --> CANCELLED : Vollstorno vor Zubereitung
    IN_PREPARATION --> CANCELLED : Berechtigtes Storno mit Nachbuchung

    DELIVERED --> [*]
    CANCELLED --> [*]
```

### C. Zahlungsstatus (`PaymentStatus`)

```mermaid
stateDiagram-v2
    [*] --> PENDING : Bestellung unbezahlt
    PENDING --> PARTIALLY_PAID : Teilzahlung erfolgt
    PARTIALLY_PAID --> PAID : Restbetrag beglichen
    PENDING --> PAID : Vollständig bezahlt
    PAID --> REFUNDED : Storniert / Rückerstattet
    PAID --> [*]
    REFUNDED --> [*]
```

### D. Druckauftrag-Status (`PrintJobStatus`)

```mermaid
stateDiagram-v2
    [*] --> PENDING : In DB angelegt
    PENDING --> PROCESSING : Print-Worker hat Job geclaimed
    PROCESSING --> COMPLETED : Erfolgreich auf Drucker ausgegeben
    PROCESSING --> FAILED : Fehler / Timeout (Versuche < Max)
    FAILED --> PENDING : Automatischer Retry oder Failover auf Ersatzdrucker
    FAILED --> CANCELLED : Max Versuche überschritten / Manuell verworfen
    COMPLETED --> [*]
    CANCELLED --> [*]
```
