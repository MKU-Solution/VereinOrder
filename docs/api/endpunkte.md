# REST-API Referenz

Die REST-API von VereinOrder basiert auf **NestJS mit dem Fastify-Adapter**. Alle Anfragen und Antworten verwenden `application/json` (außer Dateiexporte).

---

## 1. Authentifizierung & Sitzungen (`/auth`)

| Methode | Pfad           | Rollen          | Beschreibung                                                                    |
| ------- | -------------- | --------------- | ------------------------------------------------------------------------------- |
| `POST`  | `/auth/login`  | Öffentlich      | Anmeldung mit Benutzername und PIN. Liefert JWT-Token und Benutzerdaten zurück. |
| `POST`  | `/auth/switch` | Authentifiziert | Schneller Benutzerwechsel mit PIN ohne vollständigen Logout.                    |
| `GET`   | `/auth/me`     | Authentifiziert | Liefert Profildaten des aktuell angemeldeten Benutzers.                         |

---

## 2. Veranstaltungen (`/events`)

| Methode  | Pfad                                | Rollen           | Beschreibung                                                                                      |
| -------- | ----------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------- |
| `GET`    | `/events`                           | Authentifiziert  | Liste aller Veranstaltungen.                                                                      |
| `GET`    | `/events/:id`                       | Authentifiziert  | Details einer spezifischen Veranstaltung.                                                         |
| `POST`   | `/events`                           | ADMIN, EVENT_MGR | Neue Veranstaltung anlegen.                                                                       |
| `PATCH`  | `/events/:id`                       | ADMIN, EVENT_MGR | Stammdaten einer Veranstaltung bearbeiten.                                                        |
| `POST`   | `/events/:id/activate`              | ADMIN, EVENT_MGR | Scharf schalten für den Echtbetrieb mit protokollierter RKSV-Bestätigung.                         |
| `PATCH`  | `/events/:id/status`                | ADMIN, EVENT_MGR | Status ändern (`PAUSED`, `COMPLETED`, `ARCHIVED`). Unterstützt `offlineQueueWarning` (Issue #97). |
| `POST`   | `/events/:sourceId/duplicate`       | ADMIN, EVENT_MGR | Veranstaltung samt Sortiment und Stationen duplizieren.                                           |
| `POST`   | `/events/:sourceId/assortment-copy` | ADMIN, EVENT_MGR | Nur das Sortiment in eine bestehende Veranstaltung kopieren.                                      |
| `POST`   | `/events/:id/clean-test-data`       | ADMIN, EVENT_MGR | Löscht Testbestellungen und Testkassensitzungen im Testmodus.                                     |
| `DELETE` | `/events/:id`                       | ADMIN            | Veranstaltung löschen (nur im Entwurf/Testmodus).                                                 |

---

## 3. Sortiment & Produkte (`/products`, `/categories`)

| Methode | Pfad                         | Rollen                    | Beschreibung                                                   |
| ------- | ---------------------------- | ------------------------- | -------------------------------------------------------------- |
| `GET`   | `/products?eventId=...`      | Authentifiziert           | Alle Produkte einer Veranstaltung mit Optionen und Kategorien. |
| `POST`  | `/products`                  | ADMIN, EVENT_MGR          | Neues Produkt anlegen.                                         |
| `PATCH` | `/products/:id`              | ADMIN, EVENT_MGR          | Produkt bearbeiten (Preis, Name, Station, Optionen).           |
| `PATCH` | `/products/:id/availability` | ADMIN, EVENT_MGR, STATION | Verfügbarkeit setzen (`AVAILABLE`, `LOW`, `OUT_OF_STOCK`).     |
| `GET`   | `/categories?eventId=...`    | Authentifiziert           | Alle Kategorien einer Veranstaltung mit Zielstation.           |
| `POST`  | `/categories`                | ADMIN, EVENT_MGR          | Neue Kategorie anlegen.                                        |
| `PATCH` | `/categories/:id`            | ADMIN, EVENT_MGR          | Kategorie bearbeiten.                                          |

---

## 4. Bestellungen & Kasse (`/orders`, `/sessions`)

| Methode | Pfad                           | Rollen                             | Beschreibung                                                                                  |
| ------- | ------------------------------ | ---------------------------------- | --------------------------------------------------------------------------------------------- |
| `POST`  | `/orders`                      | WAITER, CASHIER, ADMIN             | Bestellung verbindlich aufgeben (mit `idempotencyKey`).                                       |
| `GET`   | `/orders/:id`                  | Authentifiziert                    | Details einer Bestellung.                                                                     |
| `GET`   | `/orders/unpaid?eventId=...`   | WAITER, CASHIER, ADMIN             | Alle noch unbezahlten Bestellungen.                                                           |
| `PATCH` | `/orders/:id/pay`              | WAITER, CASHIER, ADMIN             | Bestellung als bezahlt markieren (Zahlungstransaktion verbuchen).                             |
| `PATCH` | `/orders/:id/cancel`           | ADMIN, EVENT_MGR, WAITER (mit PIN) | Bestellung oder einzelne Position stornieren.                                                 |
| `GET`   | `/sessions/context`            | CASHIER, WAITER, ADMIN             | Veranstaltungs- und Sitzungskontext abrufen.                                                  |
| `GET`   | `/sessions/active?eventId=...` | CASHIER, WAITER, ADMIN             | Eigene aktive Kassensitzung abrufen.                                                          |
| `POST`  | `/sessions`                    | CASHIER, WAITER, ADMIN             | Kassensitzung mit Startguthaben eröffnen.                                                     |
| `GET`   | `/sessions/:id/summary`        | CASHIER, WAITER, ADMIN             | Live-Kassensitzungsbericht (Soll-Bestand, Barumsätze).                                        |
| `PATCH` | `/sessions/:id/close`          | CASHIER, WAITER, ADMIN             | Kassensitzung mit gezähltem Bargeld schließen. Unterstützt `offlineQueueWarning` (Issue #97). |

---

## 5. Stationen, Druck & Runner (`/stations`, `/print-jobs`, `/runner`)

| Methode | Pfad                              | Rollen                | Beschreibung                                                          |
| ------- | --------------------------------- | --------------------- | --------------------------------------------------------------------- |
| `GET`   | `/stations?eventId=...`           | Authentifiziert       | Alle Stationen einer Veranstaltung.                                   |
| `GET`   | `/stations/:id/orders`            | STATION, ADMIN        | Offene und in Zubereitung befindliche Bestellungen für Küchenmonitor. |
| `PATCH` | `/stations/items/:itemId/status`  | STATION, ADMIN        | Status einer Position auf `IN_PREPARATION` oder `READY` setzen.       |
| `POST`  | `/print-jobs/claim`               | Print-Worker          | Transaktionssicheres Claiming offener Druckjobs durch Worker.         |
| `PATCH` | `/print-jobs/:id/status`          | Print-Worker          | Druckjob-Status melden (`COMPLETED`, `FAILED`).                       |
| `GET`   | `/runner/orders?eventId=...`      | RUNNER, WAITER, ADMIN | Fertige Bestellungen zur Auslieferung abrufen.                        |
| `PATCH` | `/runner/orders/:orderId/claim`   | RUNNER, WAITER, ADMIN | Bestellung zur Auslieferung übernehmen.                               |
| `PATCH` | `/runner/orders/:orderId/deliver` | RUNNER, WAITER, ADMIN | Auslieferung quittieren (`DELIVERED`).                                |

---

## 6. Diagnose, Backup & Berichte (`/diagnostics`, `/backup`, `/reports`, `/audit`)

| Methode | Pfad                                   | Rollen                    | Beschreibung                                           |
| ------- | -------------------------------------- | ------------------------- | ------------------------------------------------------ |
| `GET`   | `/diagnostics/status`                  | ADMIN                     | Systemdiagnose (Datenbank, Uptime, Memory, Druckjobs). |
| `POST`  | `/diagnostics/retry-failed-print-jobs` | ADMIN                     | Fehlgeschlagene Druckaufträge erneut anstoßen.         |
| `GET`   | `/backup/list`                         | ADMIN                     | Liste aller verfügbaren PostgreSQL-Backups.            |
| `POST`  | `/backup/create`                       | ADMIN                     | Neues manuelles PostgreSQL-Backup erstellen.           |
| `POST`  | `/backup/native-restore/:filename`     | ADMIN                     | Transaktionssichere Wiederherstellung ausführen.       |
| `GET`   | `/reports/summary?eventId=...`         | ADMIN, EVENT_MGR, AUDITOR | Gesamteinnahmen, Kassenumsätze und Artikelmengen.      |
| `GET`   | `/reports/export/:type?eventId=...`    | ADMIN, EVENT_MGR, AUDITOR | CSV-/JSON-Export von Verkaufs- und Kassenberichten.    |
| `GET`   | `/audit/logs`                          | ADMIN, EVENT_MGR, AUDITOR | Revisionssicheres Audit-Log abrufen und filtern.       |
