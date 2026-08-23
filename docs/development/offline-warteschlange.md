# Offline-Warteschlange: Entwurf (Issue #65)

Verbindlicher Entwurf für die Umsetzung. Betrifft `apps/frontend/src/lib/offlineSync.ts`,
den Bestellweg in `apps/frontend/src/pages/Dashboard.tsx` und die Bestellannahme in
`apps/backend/src/orders/orders.service.ts`. Ergänzt `../product/master-prompt.md`
("Echtzeit und Offline", Zeile 1718; "Testbestellungen dürfen niemals unbemerkt in
Echtabrechnungen gelangen", Zeile 517).

Dieser Entwurf enthält keinen Produktionscode. Er legt Zustände, Antwortdeutung,
Datensatz, Migration und die notwendigen Backend-Ergänzungen fest.

## 1. Ausgangslage und Befunde

Der heutige Bestand ist vollständig in 40 Zeilen `offlineSync.ts` und zwei Stellen in
`Dashboard.tsx` enthalten. Es gibt keinen Zustand, keine Sichtbarkeit, keinen Kontext.

### Bestätigte Befunde der Projektleitung

**B1 — Fachliche Ablehnungen laufen endlos. Bestätigt.**
`Dashboard.tsx:291-293` fängt jeden Fehler im `catch` ab und schreibt nur auf die
Konsole. `removeOfflineOrder` (`Dashboard.tsx:290`) wird nur im Erfolgsfall erreicht.
Der Eintrag bleibt unverändert liegen, und `syncOffline` läuft bei jedem Aufbau der
Seite sowie bei jedem `online`-Ereignis erneut (`Dashboard.tsx:300-302`). Eine
dauerhaft abgelehnte Bestellung — etwa ein ausverkauftes Produkt
(`orders.service.ts:795-802`) — wird damit unbegrenzt oft erneut gesendet, ohne dass
ein Mensch davon erfährt.

**B2 — Der Kontext fehlt. Bestätigt, und schwerwiegender als beschrieben.**
`OfflineOrder` (`offlineSync.ts:7-15`) hält `eventId`, `items`, `payments`,
`tableName`, `areaId`, `createdAt`. Weder Benutzer noch Kassensitzung noch Betriebsart
werden festgehalten. `syncOffline` startet in einem `useEffect` ohne
Abhängigkeiten (`Dashboard.tsx:271, 300`), also bei jedem Aufbau der Seite und
unabhängig davon, wer angemeldet ist. Der Server leitet den Urheber aus dem Token ab
(`orders.controller.ts:44-49`, `orders.service.ts:875`) — die Bestellung wird demjenigen
zugeschrieben, der als Nächstes am Gerät angemeldet ist.

Verschärfend: Auch die Betriebsart wird erst beim Senden aus der Veranstaltung
abgeleitet (`orders.service.ts:845-850`). Eine im Testbetrieb erfasste Vormerkung, die
nach dem Umschalten auf Echtbetrieb übertragen wird, entsteht als `dataMode = "LIVE"`.
Das ist genau der vom Master-Prompt (Zeile 517) ausgeschlossene Fall.

**B3 — `optionIds` steht nicht im Typ. Bestätigt.**
`Dashboard.tsx:493-500` baut `orderItems` mit `optionIds` und übergibt es in
`Dashboard.tsx:503-511` an `saveOrderOffline`. Der Aufruf ist typkonform, weil
`orderItems` eine Variable ist und die Prüfung auf überzählige Eigenschaften nur bei
frisch notierten Objektliteralen greift. `items: { productId, quantity }[]`
(`offlineSync.ts:10`) ist strukturell erfüllt. Zur Laufzeit überlebt `optionIds` heute
nur deshalb, weil `Dashboard.tsx:284` das gespeicherte Array unverändert weiterreicht.
Sobald jemand die Positionen beim Wiederholungsversand abbildet — was ein
Zustandsmodell nahelegt —, fällt `optionIds` still weg. Folge wäre nicht ein Fehler,
sondern ein **falscher Preis**: `resolveOrderItemPricing` setzt ohne `ABSOLUTE`-Antwort
den Grundpreis an (`orders.service.ts:259-284`), oder es entsteht eine Ablehnung wegen
`minSelect` (`orders.service.ts:245-251`). Zusätzlich liefert `getOfflineOrders`
(`offlineSync.ts:32-35`) das rohe Ergebnis von `getAll` ohne jede Prüfung als
`OfflineOrder[]` zurück.

### Zusätzliche Befunde

**B4 — Ein Hintergrundversand meldet den Bediener ab.**
`api.ts:19-27` ruft bei jeder Antwort mit Status 401 `logout()` auf. Der
Wiederholungsversand läuft über dieselbe Instanz (`Dashboard.tsx:282`). Ein alter
Eintrag mit abgelaufener Anmeldung wirft also den gerade arbeitenden Bediener mitten
im Betrieb aus der Anwendung. Zusammen mit B2 genügt dafür ein Seitenaufbau.

**B5 — Der Wiederholungsversand hat keine Sperre gegen sich selbst.**
`syncOffline` wird beim Aufbau aufgerufen **und** als `online`-Behandler registriert
(`Dashboard.tsx:300-301`). Beide Läufe können sich überlappen; ebenso zwei geöffnete
Registerkarten. Im Backend liegt die Idempotenzprüfung (`orders.service.ts:769-780`)
**außerhalb** der Transaktion, die erst in `orders.service.ts:838` beginnt. Zwei
gleichzeitige Versuche mit demselben Schlüssel können beide an der Prüfung vorbeikommen
und beide `prisma.order.create` erreichen. Die eindeutige Spalte
(`packages/database/prisma/schema.prisma:324`) verhindert die Doppelbestellung, aber der
unterlegene Versuch endet als nicht abgefangener Prisma-Fehler `P2002`, also als 500.

**B6 — Die Idempotenzprüfung in `createOrder` prüft keinen Besitz.**
`orders.service.ts:769-780` gibt die vorhandene Bestellung mit Positionen und Zahlungen
an jeden zurück, der den Schlüssel vorlegt. `createQuickSale` macht es an derselben
Stelle vollständig anders und vergleicht Benutzer, Veranstaltung, Sitzung, Zahlung und
Positionen, bevor es die Wiederholung anerkennt (`orders.service.ts:378-390`). Die
Bestellannahme ist also die schwächere von beiden.

**B7 — `createOrder` verlangt keine aktive Kassensitzung.**
`orders.service.ts:853-862` sucht die aktive Sitzung, prüft aber nur deren
Betriebsart. Fehlt sie, wird `cashierSessionId = null` gebucht
(`orders.service.ts:862, 881, 892`). Eine Vormerkung, die während Sitzung X erfasst
wurde und nach deren Abschluss übertragen wird, landet damit ohne Sitzung — die
kassierten Beträge (`orders.service.ts:885-895`, Status `COMPLETED`) fehlen still in
jeder Kassenabrechnung. Die Zusage des Issues ("geschlossene Kassensitzung" als
Konflikt) hält die heutige Bestellannahme nicht.

**B8 — Die Reihenfolge des Versands ist zufällig.**
`db.getAll` (`offlineSync.ts:34`) liefert nach Primärschlüssel sortiert. Der
Primärschlüssel ist `idempotencyKey` (`offlineSync.ts:21`), erzeugt aus
`crypto.randomUUID()` (`Dashboard.tsx:454`). Vormerkungen werden also in zufälliger
Reihenfolge übertragen, nicht in der Reihenfolge ihrer Entstehung. Für den Küchenmonitor
und für Tischbelegungen ist das sichtbar falsch.

**B9 — Nur zwei Fehlerbilder führen überhaupt in die Warteschlange.**
`Dashboard.tsx:491` prüft `!navigator.onLine || err.code === "ERR_NETWORK"`. Ein
Zeitüberlauf (`ECONNABORTED`), ein 502 vom Reverse Proxy oder ein abgebrochenes WLAN
mit noch positivem `navigator.onLine` fallen in den `else`-Zweig
(`Dashboard.tsx:518-523`): eine `alert`-Meldung, der Warenkorb bleibt stehen, nichts
wird vorgemerkt. Genau in diesen Fällen ist aber unklar, ob der Server die Bestellung
bereits angelegt hat. `api.ts` setzt zudem keinen `timeout`, eine hängende Anfrage endet
nie.

## 2. Zustandsmodell

Die fünf Zustände des Issues genügen. Ein sechster wird **nicht** eingeführt; der Fall
"Kontext passt nicht" wird als `CONFLICT` mit eigener Ursache geführt (Abschnitt 4),
der Fall "wartet auf den richtigen Benutzer" bleibt `LOCAL_PENDING` mit einer
abgeleiteten, nicht gespeicherten Sperrbegründung.

Dauerhaft gespeichert werden **alle fünf** Zustände. `SENDING` wird ausdrücklich vor dem
Absenden geschrieben, nicht nur im Arbeitsspeicher gehalten — sonst ist nach einem
Absturz nicht erkennbar, dass eine Übertragung begonnen hatte.

### Übergänge

| Von             | Nach            | Auslöser                                                            | Bedingung                                                      |
| --------------- | --------------- | ------------------------------------------------------------------- | -------------------------------------------------------------- |
| —               | `LOCAL_PENDING` | Kassiervorgang, Senden nicht möglich oder Ergebnis unklar           | Erfassung mit vollständigem Kontext (Abschnitt 4)              |
| `LOCAL_PENDING` | `SENDING`       | Sendeschleife                                                       | online, Kontext geprüft, `nextAttemptAt` erreicht, Sperre frei |
| `SENDING`       | `CONFIRMED`     | Antwort 2xx mit passendem `idempotencyKey`                          | —                                                              |
| `SENDING`       | `CONFLICT`      | fachliche Antwort 4xx                                               | siehe Tabelle Abschnitt 3                                      |
| `SENDING`       | `LOCAL_PENDING` | Netzfehler, Zeitüberlauf, 408/425/429, 5xx                          | `attempt < 6`; `nextAttemptAt` neu gesetzt                     |
| `SENDING`       | `FAILED`        | wie oben                                                            | `attempt >= 6`                                                 |
| `SENDING`       | `LOCAL_PENDING` | Wiederherstellungslauf beim Start (Absturz während der Übertragung) | `interruptedAt` wird gesetzt, `attempt` bleibt                 |
| `LOCAL_PENDING` | `CONFLICT`      | Kontextprüfung vor dem Senden schlägt fehl                          | ohne Anfrage an den Server                                     |
| `CONFLICT`      | `SENDING`       | Bediener drückt "Erneut senden"                                     | `attempt` wird auf 0 gesetzt, Kontextprüfung läuft erneut      |
| `FAILED`        | `SENDING`       | Bediener drückt "Jetzt senden"                                      | `attempt` wird auf 0 gesetzt                                   |
| `CONFIRMED`     | —               | Aufräumlauf beim Start                                              | `confirmedAt` älter als 24 Stunden                             |
| jeder           | —               | bestätigtes Verwerfen                                               | nur nach Serverkontakt, Abschnitt 7                            |

Automatisch sind ausschließlich die Übergänge aus `LOCAL_PENDING` und `SENDING`. Aus
`CONFLICT` und `FAILED` führt kein Weg ohne Bedienerentscheidung heraus — das ist die
Antwort auf B1 und deckt sich mit den Nicht-Zielen des Issues.

### Regeln der Sendeschleife

- **Eine Sperre für die ganze Anwendung.** Ein einziger laufender Sendevorgang, eine
  einzige Warteschlange, sequenziell, nie parallel (Antwort auf B5). Innerhalb einer
  Registerkarte genügt eine Zusicherung im Modul; über mehrere Registerkarten hinweg
  wird zusätzlich ein Zeitstempel `sendingSince` je Eintrag geführt, der jünger als
  90 Sekunden als "läuft gerade" gilt.
- **Reihenfolge nach `createdAt`, aufsteigend** (Antwort auf B8), über einen Index,
  nicht über `getAll` und Sortierung im Speicher.
- **Ein Konflikt hält die Schlange nicht auf.** Bestellungen sind untereinander
  unabhängig; ein Eintrag in `CONFLICT` wird übersprungen, die folgenden werden
  gesendet.
- **Wartezeiten:** 5 s, verdoppelnd, gedeckelt bei 5 Minuten, mit ±20 % Streuung.
  Höchstens 6 automatische Versuche je Eintrag, danach `FAILED`. Bei 429 gilt
  `Retry-After`, falls vorhanden.
- **Ein `online`-Ereignis** setzt `nextAttemptAt` sofort und `attempt` auf 0 —
  aber nur für Einträge in `LOCAL_PENDING`. `FAILED` bleibt `FAILED`, bis ein Mensch
  drückt.
- **Der Wiederholungsversand meldet niemanden ab.** Die Anfragen der Sendeschleife
  werden so markiert, dass der 401-Behandler in `api.ts:19-27` sie übergeht (Antwort
  auf B4). Die abgelaufene Anmeldung wird am Eintrag vermerkt, nicht an der Sitzung des
  gerade Arbeitenden.
- **Jede Anfrage bekommt einen `timeout`** (Vorschlag: 15 s). Ohne ihn gibt es den Fall
  "hängt für immer", und dann auch keinen Zustandswechsel.

### Absturz während `SENDING`

Beim Start wird jeder Eintrag in `SENDING`, dessen `sendingSince` älter als 90 Sekunden
ist, nach `LOCAL_PENDING` zurückgesetzt und mit `interruptedAt` markiert. Er wird
**nicht** als gesendet betrachtet und **nicht** verworfen.

Der anschließende erneute Versand trägt denselben `idempotencyKey`. Damit gibt es genau
zwei mögliche Wirklichkeiten:

1. Der Server hat die Bestellung nie angelegt: der Versand legt sie jetzt an, Antwort
   2xx, `CONFIRMED`.
2. Der Server hat sie angelegt, nur die Antwort ging verloren: der Kurzschluss in
   `orders.service.ts:769-780` findet sie über `idempotencyKey` und gibt sie zurück,
   Antwort 2xx, `CONFIRMED`. Es entsteht keine zweite Bestellung.

Der erneute Versand ist damit zugleich die Prüfung, ob die erste Übertragung angekommen
ist. Ein eigener Zustand "unbekannt" ist unnötig. Voraussetzung dafür ist, dass die
Antwort eindeutig zum Eintrag gehört — deshalb wird `response.data.idempotencyKey`
gegen den Eintrag geprüft, bevor `CONFIRMED` gesetzt wird (siehe B6 und Abschnitt 8,
Punkt 3). Die Anzeige führt einen unterbrochenen Eintrag bis zur Bestätigung sichtbar
als "Übertragung unterbrochen, Ergebnis wird geprüft".

## 3. Einordnung der Serverantworten

Leitregel: **Ein fachliches 4xx wird nie automatisch wiederholt.** Netzfehler, 408, 425,
429 und 5xx werden wiederholt, höchstens sechsmal je Eintrag.

Seit Issue #93 führt `POST /orders` bei fachlichen 4xx zusätzlich zum lesbaren
`message` eine stabile Kennung im Feld `code`. Die Warteschlange wertet diese
Kennung zuerst aus. Fehlt sie oder ist sie unbekannt, bleibt die bisherige
Zuordnung über HTTP-Status und Meldungstext als Rückfall für ältere
Serverfassungen erhalten. Die Retry-Entscheidung hängt weiterhin ausschließlich
an Netzwerkfehler und HTTP-Status; ein Body-Code kann sie nicht verändern.

Der Kennungsvertrag umfasst `AUTH_EXPIRED`, `FORBIDDEN`, `EVENT_MODE`,
`SESSION_CLOSED`, `PRODUCT_UNAVAILABLE`, `PRICE_OR_OPTION`,
`DUPLICATE_KEY_MISMATCH` und `VALIDATION`.

| Antwort                                                                    | Konkreter Fall                                                                             | Zustand                               | Automatisch wiederholen        |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------- | ------------------------------ |
| 200/201, `idempotencyKey` passt                                            | angelegt **oder** Wiederholung, `orders.service.ts:777-779`                                | `CONFIRMED`                           | entfällt                       |
| 200/201, `idempotencyKey` oder `eventId` passt nicht                       | fremde Bestellung hinter dem Schlüssel (B6)                                                | `CONFLICT` / `DUPLICATE_KEY_MISMATCH` | nein                           |
| 400 `Event is not active for orders`                                       | `orders.service.ts:851-852`, Veranstaltung beendet, pausiert oder Betriebsart umgeschaltet | `CONFLICT` / `EVENT_MODE`             | nein                           |
| 409 `... anderen Betriebsmodus`                                            | `orders.service.ts:858-861`, Kassensitzung in anderer Betriebsart                          | `CONFLICT` / `EVENT_MODE`             | nein                           |
| 409 Sitzung passt nicht                                                    | neu, Abschnitt 8 Punkt 5, erfasste Sitzung geschlossen oder ausgetauscht                   | `CONFLICT` / `SESSION_CLOSED`         | nein                           |
| 400 `Product ... is currently out of stock`                                | `orders.service.ts:795-802`, inzwischen ausverkauft oder deaktiviert                       | `CONFLICT` / `PRODUCT_UNAVAILABLE`    | nein                           |
| 400 `Product ... not found`                                                | `orders.service.ts:793-794`, Produkt entfernt oder gehört nicht zur Veranstaltung          | `CONFLICT` / `PRODUCT_UNAVAILABLE`    | nein                           |
| 400 `Die Antwort ... gehört zu keiner aktiven Auswahlgruppe`               | `orders.service.ts:232-236`, unbekannte oder abgeschaltete Auswahlkennung                  | `CONFLICT` / `PRICE_OR_OPTION`        | nein                           |
| 400 `... braucht mindestens` / `... erlaubt höchstens`                     | `orders.service.ts:245-257`, Auswahlgruppe seither geändert                                | `CONFLICT` / `PRICE_OR_OPTION`        | nein                           |
| 400 `Die Antwort ... mehrfach angegeben`                                   | `orders.service.ts:224-228`, defekter Warenkorb                                            | `CONFLICT` / `PRICE_OR_OPTION`        | nein                           |
| 400 `Der Endpreis ... nicht negativ`                                       | `orders.service.ts:285-289`, Preise seither geändert                                       | `CONFLICT` / `PRICE_OR_OPTION`        | nein                           |
| 400 `Area does not belong to ...`                                          | `orders.service.ts:827-836`, Bereich gelöscht oder verschoben                              | `CONFLICT` / `VALIDATION`             | nein                           |
| 400 `Order must contain at least one item`                                 | `orders.service.ts:765-767`, defekter Datensatz                                            | `CONFLICT` / `VALIDATION`             | nein                           |
| 400 `User is not active`                                                   | `orders.service.ts:866-868`, Benutzer gesperrt                                             | `CONFLICT` / `FORBIDDEN`              | nein                           |
| 401                                                                        | Anmeldung abgelaufen; Abmeldung des aktuellen Bedieners wird unterdrückt (B4)              | `CONFLICT` / `AUTH_EXPIRED`           | nein                           |
| 403                                                                        | Rolle reicht nicht, `orders.controller.ts:17-18, 44-45`                                    | `CONFLICT` / `FORBIDDEN`              | nein                           |
| 404, 405                                                                   | Endpunkt nicht vorhanden, Server älter oder neuer als die Oberfläche                       | `CONFLICT` / `VALIDATION`             | nein                           |
| sonstiges 4xx, 422                                                         | unbekannte fachliche Ablehnung                                                             | `CONFLICT` / `UNKNOWN_4XX`            | nein                           |
| 408, 425, 429                                                              | Zeitüberlauf oder Drosselung                                                               | `LOCAL_PENDING`, sonst `FAILED`       | ja, 429 beachtet `Retry-After` |
| 500, 502, 503, 504                                                         | einschließlich des Rennens aus B5                                                          | `LOCAL_PENDING`, sonst `FAILED`       | ja                             |
| keine Antwort, `ERR_NETWORK`, `ECONNABORTED`, `navigator.onLine === false` | Netz weg                                                                                   | `LOCAL_PENDING`, sonst `FAILED`       | ja                             |

Ein 5xx wird nie als Bestätigung gedeutet, auch nicht das Rennen aus B5. Der nächste
Versuch trifft dort auf den Idempotenzkurzschluss und erhält 2xx — der Fall heilt sich
selbst, sofern Punkt 4 in Abschnitt 8 umgesetzt ist.

**Zuordnung über Meldungstexte ist nachrangig.** Der Zustand `CONFLICT` ergibt sich
allein aus der Statusklasse 4xx. Die Spalte "Ursache" steuert nur den Text für den
Bediener und den Vorschlag zur Auflösung. Trifft kein Muster, gilt `UNKNOWN_4XX` mit
dem unveränderten Servertext. Damit hängt kein Verhalten an deutschen Zeichenketten.
Siehe Abschnitt 10, Punkt 4.

**Fehlertexte.** Gespeichert und angezeigt wird ausschließlich `error.response.status`
und, falls es eine Zeichenkette ist, `error.response.data.message`, auf 300 Zeichen
gekürzt. Niemals `error.stack`, niemals `error.config` (enthält den
`Authorization`-Kopf, `api.ts:11-15`), niemals das ganze Antwortobjekt.

## 4. Kontextbindung

Ein Eintrag hält den Kontext seiner **Entstehung** fest und wird ausschließlich in
genau diesem Kontext gesendet. Der Kontext wird nie automatisch angepasst.

Festgehalten werden: `userId`, `username`, `userRole`, `eventId`, `eventName`,
`dataMode`, `cashierSessionId`.

`dataMode` und `cashierSessionId` sind offline nicht abfragbar. Deshalb hält die
Bestellmaske einen zuletzt bekannten Betriebskontext vor, der im Online-Zustand aus
`GET /sessions/context` (`sessions.controller.ts:24-27`, liefert `status`, `testMode`
und `activeSession` je Veranstaltung) aktualisiert und lokal zwischengespeichert wird.
`Dashboard.tsx` fragt diesen Endpunkt heute nicht ab — das ist Umsetzungsarbeit,
`CashierDashboard.tsx:83` zeigt das Muster. `GET /products` genügt dafür nicht, es
liefert weder `status` noch `testMode` (`products.service.ts:85-108`).

### Prüfung vor jedem Sendeversuch

1. **Benutzer.** Ist niemand angemeldet oder gilt `auth.user.userId !== eintrag.userId`,
   wird der Eintrag **nicht gesendet und nicht gezählt**. Er bleibt `LOCAL_PENDING` und
   trägt in der Anzeige "wartet auf Anmeldung von `username`". Das ist kein Konflikt: es
   löst sich von selbst, sobald die richtige Person am Gerät ist.
2. **Betriebsart.** Weicht die heutige Betriebsart der Veranstaltung von `dataMode` ab,
   wird der Eintrag ohne Anfrage nach `CONFLICT` / `EVENT_MODE` gesetzt. Das ist die
   Umsetzung von Master-Prompt Zeile 517 auf der Seite des Klienten; der Server setzt
   dieselbe Grenze ein zweites Mal (Abschnitt 8, Punkt 5).
3. **Kassensitzung.** Ist `cashierSessionId` gesetzt und stimmt nicht mit der heute
   aktiven Sitzung des Benutzers für diese Veranstaltung überein, folgt `CONFLICT` /
   `SESSION_CLOSED`. War `cashierSessionId` bei der Erfassung `null`, ist das kein
   Konflikt — dann galt schon damals keine Sitzung, und das Verhalten bleibt wie heute.
4. **`dataMode === "UNKNOWN"` oder `userId === null`** (nur bei übernommenen Einträgen
   aus Version 1, Abschnitt 6): `CONFLICT` / `CONTEXT_UNKNOWN`.

Lässt sich der Betriebskontext nicht abfragen, weil der Server nicht erreichbar ist,
gilt der Versuch als Netzfehler: wiederholbar, kein Konflikt, kein Versand.

### Was ein unpassender Kontext auslöst

Weder stiller Versand noch stilles Verwerfen. Ein Eintrag in `CONFLICT` bleibt sichtbar,
zeigt seinen erfassten Kontext neben dem heutigen und bietet genau zwei Wege:

- **Erneut prüfen und senden** — ändert nichts am Eintrag, wiederholt nur die Prüfung.
  Das führt erst dann zum Erfolg, wenn der ursprüngliche Kontext wieder gilt (die
  richtige Person angemeldet, eine passende Sitzung eröffnet, die Betriebsart wieder
  wie erfasst).
- **Verwerfen** nach Abschnitt 7.

Eine Umschreibung auf einen anderen Benutzer, eine andere Veranstaltung oder eine andere
Betriebsart gibt es **nicht**. Sie wäre eine Fälschung der Urheberschaft, und im Fall
Testbetrieb nach Echtbetrieb ein Verstoß gegen den Master-Prompt. Einzige Ausnahme ist
die Übernahme kontextloser Altbestände, Abschnitt 6.

## 5. Der Datensatz

Speicher `vereinorder-db`, Objektspeicher `offline-orders`, **Version 2**.
Schlüsselpfad bleibt `idempotencyKey` — er ist stabil, eindeutig und ist genau der
Wert, der die Idempotenz trägt.

Neue Indizes: `by-createdAt` auf `createdAt` (Reihenfolge des Versands, B8) und
`by-state` auf `state` (Anzeige und Zählung ohne vollständigen Durchlauf).

| Feld                | Typ                                                       | Pflicht  | Bedeutung                                                       |
| ------------------- | --------------------------------------------------------- | -------- | --------------------------------------------------------------- |
| `idempotencyKey`    | `string`                                                  | Pflicht  | Schlüsselpfad, unverändert über alle Versuche hinweg            |
| `schemaVersion`     | `2`                                                       | Pflicht  | je Datensatz, damit eine spätere Migration den Stand erkennt    |
| `state`             | `LOCAL_PENDING\|SENDING\|CONFIRMED\|CONFLICT\|FAILED`     | Pflicht  | Abschnitt 2                                                     |
| `createdAt`         | `number` (ms)                                             | Pflicht  | Zeitpunkt der Erfassung, bestimmt die Sendereihenfolge          |
| `updatedAt`         | `number` (ms)                                             | Pflicht  | letzte Änderung am Datensatz                                    |
| `userId`            | `string \| null`                                          | Pflicht  | `null` nur bei Altbeständen aus Version 1                       |
| `username`          | `string \| null`                                          | Pflicht  | Anzeige, nie zur Autorisierung                                  |
| `userRole`          | `string \| null`                                          | optional | Anzeige                                                         |
| `eventId`           | `string`                                                  | Pflicht  | wie heute                                                       |
| `eventName`         | `string \| null`                                          | optional | Anzeige                                                         |
| `dataMode`          | `"TEST" \| "LIVE" \| "UNKNOWN"`                           | Pflicht  | `UNKNOWN` nur bei Altbeständen                                  |
| `cashierSessionId`  | `string \| null`                                          | Pflicht  | `null` bedeutet ausdrücklich "bei Erfassung galt keine Sitzung" |
| `items`             | `OfflineItem[]`, mindestens ein Eintrag                   | Pflicht  | siehe unten                                                     |
| `payments`          | `{ amount: number; method: "CASH"\|"CARD"\|"VOUCHER" }[]` | Pflicht  | darf leer sein                                                  |
| `tableName`         | `string \| null`                                          | Pflicht  | heute `undefined`, künftig ausdrücklich `null`                  |
| `areaId`            | `string \| null`                                          | Pflicht  | dito                                                            |
| `areaName`          | `string \| null`                                          | optional | Anzeige                                                         |
| `totalAtCapture`    | `number` (Cent)                                           | optional | nur Anzeige; der Server bleibt für den Betrag maßgeblich        |
| `attempt`           | `number`                                                  | Pflicht  | Anzahl abgeschlossener automatischer Versuche, beginnt bei 0    |
| `lastAttemptAt`     | `number \| null`                                          | Pflicht  | —                                                               |
| `nextAttemptAt`     | `number \| null`                                          | Pflicht  | frühester nächster Versuch                                      |
| `sendingSince`      | `number \| null`                                          | Pflicht  | gesetzt beim Eintritt in `SENDING`, sonst `null`                |
| `interruptedAt`     | `number \| null`                                          | Pflicht  | gesetzt vom Wiederherstellungslauf beim Start                   |
| `lastError`         | `OfflineError \| null`                                    | Pflicht  | siehe unten, ohne Token und ohne Stacktrace                     |
| `conflictKind`      | `ConflictKind \| null`                                    | Pflicht  | nur bei `state === "CONFLICT"` belegt                           |
| `serverOrderId`     | `string \| null`                                          | Pflicht  | gesetzt bei `CONFIRMED`                                         |
| `serverOrderNumber` | `string \| null`                                          | optional | Anzeige nach Bestätigung                                        |
| `confirmedAt`       | `number \| null`                                          | Pflicht  | Grundlage für den Aufräumlauf                                   |
| `legacy`            | `boolean`                                                 | Pflicht  | `true` bei Übernahme aus Version 1                              |
| `adoptedByUserId`   | `string \| null`                                          | optional | nur bei übernommenen Altbeständen, Abschnitt 6                  |
| `adoptedAt`         | `number \| null`                                          | optional | dito                                                            |

`OfflineItem`:

| Feld                 | Typ                   | Pflicht  | Bedeutung                                                                 |
| -------------------- | --------------------- | -------- | ------------------------------------------------------------------------- |
| `productId`          | `string`              | Pflicht  | —                                                                         |
| `quantity`           | `number` (ganzzahlig) | Pflicht  | —                                                                         |
| `optionIds`          | `string[]`            | Pflicht  | **ausdrücklich im Typ**, darf leer sein, nie `undefined` (Antwort auf B3) |
| `productName`        | `string \| null`      | optional | Anzeige in der Warteschlange                                              |
| `unitPriceAtCapture` | `number` (Cent)       | optional | Anzeige; nie an den Server gesendet                                       |

`OfflineError`:

| Feld                 | Typ                   | Pflicht | Bedeutung                                           |
| -------------------- | --------------------- | ------- | --------------------------------------------------- |
| `at`                 | `number` (ms)         | Pflicht | Zeitpunkt                                           |
| `kind`               | `"NETWORK" \| "HTTP"` | Pflicht | —                                                   |
| `httpStatus`         | `number \| null`      | Pflicht | —                                                   |
| `messageForOperator` | `string`              | Pflicht | Servertext oder eigener Text, höchstens 300 Zeichen |

`ConflictKind` ist genau: `AUTH_EXPIRED`, `FORBIDDEN`, `CONTEXT_UNKNOWN`, `EVENT_MODE`,
`SESSION_CLOSED`, `PRODUCT_UNAVAILABLE`, `PRICE_OR_OPTION`, `VALIDATION`,
`DUPLICATE_KEY_MISMATCH`, `UNKNOWN_4XX`.

`optionIds` wird nur beim Senden weggelassen, wenn das Array leer ist — dann entsteht
kein Unterschied zum heutigen Verhalten (`orders.service.ts:805`, `item.optionIds ?? []`).

**Lesen prüft.** `getOfflineOrders` gibt heute das Ergebnis von `getAll` ungeprüft als
typisiert zurück (`offlineSync.ts:32-35`). Künftig prüft jede Lesefunktion die
Pflichtfelder und aussortiert defekte Datensätze nicht still, sondern führt sie als
`CONFLICT` / `VALIDATION` mit einem Hinweis. Ein Datensatz mit `schemaVersion` größer
als 2 wird unverändert liegen gelassen und als "unbekannte Version" angezeigt — das
tritt nach einer Rücknahme der Anwendungsversion auf.

## 6. Migration von Version 1

`DB_VERSION` steigt von 1 (`offlineSync.ts:5`) auf 2. Der Objektspeicher wird
**nicht** gelöscht und nicht neu angelegt; Schlüsselpfad und Schlüssel bleiben. In der
Warteschlange können echte Vormerkungen aus dem Festbetrieb mit bereits kassiertem Geld
liegen.

Ablauf im `upgrade`-Rückruf, vollständig innerhalb der Aufwertungstransaktion, damit ein
Absturz nicht halb umgestellte Daten hinterlässt:

1. Fehlt der Objektspeicher, wird er wie bisher angelegt (Erstinstallation).
2. Die beiden Indizes `by-createdAt` und `by-state` werden angelegt.
3. Über alle vorhandenen Datensätze wird mit einem Zeiger gelaufen und jeder Datensatz
   mit `cursor.update` ersetzt.

Abbildung Feld für Feld:

| Neues Feld                                                                                                                                                          | Herkunft                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `idempotencyKey`, `eventId`, `payments`, `createdAt`                                                                                                                | unverändert übernommen                                                                                                    |
| `tableName`, `areaId`                                                                                                                                               | übernommen, `undefined` wird zu `null`                                                                                    |
| `items[].productId`, `items[].quantity`                                                                                                                             | unverändert übernommen                                                                                                    |
| `items[].optionIds`                                                                                                                                                 | `record.items[i].optionIds ?? []` — der Wert ist zur Laufzeit vorhanden (B3) und **muss ausdrücklich mitgenommen werden** |
| `payments`                                                                                                                                                          | `?? []`                                                                                                                   |
| `state`                                                                                                                                                             | `"CONFLICT"`                                                                                                              |
| `conflictKind`                                                                                                                                                      | `"CONTEXT_UNKNOWN"`                                                                                                       |
| `legacy`                                                                                                                                                            | `true`                                                                                                                    |
| `userId`, `username`, `userRole`, `cashierSessionId`, `eventName`, `areaName`                                                                                       | `null` — es gibt keine Quelle dafür                                                                                       |
| `dataMode`                                                                                                                                                          | `"UNKNOWN"`                                                                                                               |
| `attempt`                                                                                                                                                           | `0`                                                                                                                       |
| `updatedAt`                                                                                                                                                         | `createdAt`, ersatzweise `Date.now()`                                                                                     |
| `lastAttemptAt`, `nextAttemptAt`, `sendingSince`, `interruptedAt`, `lastError`, `serverOrderId`, `serverOrderNumber`, `confirmedAt`, `adoptedByUserId`, `adoptedAt` | `null`                                                                                                                    |
| `schemaVersion`                                                                                                                                                     | `2`                                                                                                                       |
| `totalAtCapture`, `items[].productName`, `items[].unitPriceAtCapture`                                                                                               | nicht vorhanden, bleiben ungesetzt; die Anzeige zeigt Produktkennungen statt Namen                                        |

Es geht kein Feld verloren. Neue Felder ohne Quelle werden nicht geraten.

**Warum `CONFLICT` und nicht `LOCAL_PENDING`:** Ein Altbestand hat keinen Benutzer, keine
Sitzung und keine Betriebsart. Ihn nach `LOCAL_PENDING` zu setzen hieße, ihn beim
nächsten `online`-Ereignis unter irgendeinem Kontext zu senden — genau der Fehler aus B2.

**Übernahme von Altbeständen.** Weil ein Altbestand echtes Geld darstellen kann, ist
stilles Liegenlassen ebenso falsch wie stiller Versand. Er bietet daher zusätzlich zu
"Verwerfen" die Handlung **"Übernehmen und senden"**: Der angemeldete Benutzer erklärt
ausdrücklich, dass er den Eintrag verantwortet. Dabei werden `userId`, `username`,
`dataMode`, `cashierSessionId` aus dem heutigen Kontext gesetzt, `adoptedByUserId` und
`adoptedAt` festgeschrieben, `legacy` bleibt `true`, und der Eintrag geht nach
`LOCAL_PENDING`. Voraussetzung: die `eventId` des Eintrags gehört zu einer heute
laufenden Veranstaltung. Passt sie nicht, bleibt nur Verwerfen. Wer das darf, ist in
Abschnitt 10 offen.

## 7. Abläufe

### Wiederholung

1. Auslöser: Start der Anwendung, `online`-Ereignis, abgelaufene Wartezeit, oder eine
   ausdrückliche Bedienerhandlung.
2. Sperre setzen. Betriebskontext aktualisieren (`GET /sessions/context`). Scheitert
   das, Lauf beenden, kein Zustandswechsel außer neuer Wartezeit.
3. Einträge in `LOCAL_PENDING` nach `createdAt` aufsteigend durchgehen, deren
   `nextAttemptAt` erreicht ist.
4. Kontextprüfung nach Abschnitt 4. Übersprungen oder `CONFLICT`, ohne Anfrage.
5. `state = "SENDING"`, `sendingSince = now`, `attempt += 1`, **in IndexedDB schreiben**,
   dann erst `POST /orders` mit unverändertem `idempotencyKey`, unveränderten Positionen
   einschließlich `optionIds`, und dem erfassten `cashierSessionId`.
6. Antwort nach Abschnitt 3 einordnen und den neuen Zustand schreiben.
7. Weiter mit dem nächsten Eintrag. Am Ende Sperre lösen.

Die Anzeige führt zu jeder Zeit Zeit, Tisch und Bereich, Betrag, Benutzer,
Veranstaltung samt Betriebsart, Zustand und die nächste mögliche Handlung. Eine
Vormerkung ist niemals als bestätigte Bestellung darstellbar: sie hat keine
Bestellnummer, bis der Server eine geliefert hat.

### Konflikt

Kein automatischer Versuch mehr. Angezeigt werden der erfasste Kontext, der heutige
Kontext, die Ursache in verständlichem Deutsch und der gekürzte Servertext. Handlungen:
"Erneut prüfen und senden" (setzt `attempt` auf 0) oder "Verwerfen". Eine automatische
fachliche Auflösung — Preis nachziehen, Produkt ersetzen, Position streichen — findet
nicht statt; das ist ausdrückliches Nicht-Ziel des Issues.

### Verwerfen

Verwerfen ist die einzige Handlung, die Daten vernichtet. Sie ist deshalb **nur mit
Serververbindung möglich**.

1. Der Bediener wählt "Verwerfen" und eine Begründung aus einer kurzen Liste
   (Doppelerfassung, Gast hat storniert, Testeingabe, Sonstiges mit Freitext).
2. **Serverkontakt zuerst:** `GET /orders/by-idempotency-key/:key` (neu, Abschnitt 8).
   - **200** — der Server kennt die Bestellung. Es wird **nichts gelöscht**. Der Eintrag
     geht nach `CONFIRMED` mit der zurückgegebenen Bestellnummer, und der Bediener liest:
     "Diese Bestellung liegt bereits beim Server und wurde nicht gelöscht." Das ist der
     Schutz davor, eine bezahlte Bestellung zu verlieren.
   - **404** — der Server kennt sie nicht. Weiter mit Schritt 3.
   - **401 oder 403** — Verwerfen abgelehnt, Hinweis "Bitte neu anmelden".
   - **Netzfehler oder 5xx** — Verwerfen abgelehnt: "Verwerfen ist nur mit
     Serververbindung möglich." Kein Verwerfen im Offline-Zustand, keine
     Löschvormerkung, keine Ersatzlösung. Ohne Serverkontakt lässt sich weder belegen,
     dass die Bestellung nicht existiert, noch das verlangte Audit-Ereignis schreiben.
3. Warnung mit vollständigem Inhalt: Zeitpunkt, Tisch und Bereich, alle Positionen,
   Gesamtbetrag und — hervorgehoben, falls `payments` nicht leer ist — die bereits
   kassierte Summe je Zahlungsart. Der Knopf "Endgültig verwerfen" wird erst aktiv,
   nachdem ein Kästchen bestätigt wurde, dass diese Vormerkung nicht an den Server geht.
4. `POST /orders/offline-queue/discard` (neu, Abschnitt 8). Der Server prüft erneut, dass
   keine Bestellung mit diesem Schlüssel existiert, und schreibt das Audit-Ereignis.
5. **Erst nach 2xx** wird der Datensatz aus IndexedDB gelöscht. Reihenfolge ist
   verbindlich: Audit zuerst, Löschen danach. Scheitert der Löschvorgang, bleibt der
   Eintrag stehen und die Handlung ist wiederholbar.

## 8. Notwendige Backend-Änderungen

Nicht "keine". Fünf Punkte, jeder mit Fundstelle. Punkte 1 bis 3 sind zwingend, 4 und 5
tragen Zusagen des Issues, die die heutige Bestellannahme nicht hält.

1. **`GET /orders/by-idempotency-key/:key`** — neu in `orders.controller.ts`, Rollen wie
   `POST /orders` (`orders.controller.ts:44-45`). Liefert eine schmale Auskunft
   (`id`, `orderNumber`, `createdAt`, `totalAmount`, `eventId`, `dataMode`,
   `paymentStatus`) oder 404. Nicht die vollständige Bestellung. Zusätzlich: 404 auch
   dann, wenn die Bestellung einem anderen Benutzer gehört und der Aufrufer nicht
   `ADMINISTRATOR` oder `EVENT_MANAGER` ist — sonst wird der Endpunkt zur Auskunft über
   fremde Schlüssel. Zwingend, weil Abschnitt 7 den Serverkontakt vor dem Löschen
   verlangt und ein erneutes `POST` die Bestellung anlegen statt prüfen würde.

2. **`POST /orders/offline-queue/discard`** — neu. Nimmt `idempotencyKey`, den erfassten
   Kontext und die Begründung entgegen, prüft, dass keine Bestellung mit diesem
   Schlüssel existiert (sonst 409), und schreibt über `AuditService.log`
   (`audit.service.ts:24-43`) ein Ereignis `OFFLINE_QUEUE_DISCARDED` mit
   `entityType: "Order"`, `entityId: idempotencyKey`, `userId` des Aufrufers und den
   Einzelheiten der verworfenen Vormerkung. Zwingend, weil `audit.controller.ts` heute
   ausschließlich lesende Endpunkte hat (Zeilen 12, 32, 38) und das Issue ein
   Audit-Ereignis nach Serverkontakt verlangt.

3. **Besitzprüfung im Idempotenzkurzschluss** — `orders.service.ts:769-780`. Nach dem
   `findUnique` vergleichen, ob `existingOrder.userId === userId` und
   `existingOrder.eventId === dto.eventId`. Bei Abweichung `ConflictException`, wie es
   `createQuickSale` an der entsprechenden Stelle bereits tut
   (`orders.service.ts:378-390`, dort allerdings als `BadRequestException`). Zwingend
   wegen B6: heute erhält jeder Angemeldete mit dem Schlüssel die fremde Bestellung samt
   Zahlungen zurück, und die Warteschlange würde eine fremde Bestellung als eigene
   Bestätigung verbuchen. Anmerkung für die Umsetzung: der unterschiedliche Statuscode
   zwischen `createOrder` (Vorschlag 409) und `createQuickSale` (heute 400) ist eine
   bestehende Unstimmigkeit; der Schnellverkauf wird hier nicht geändert.

4. **`P2002` auf `idempotencyKey` als Wiederholung behandeln** —
   `orders.service.ts:869-905`, heute ohne Auffangen. Beim Verstoß gegen die eindeutige
   Spalte (`schema.prisma:324`) die vorhandene Bestellung erneut lesen und über dieselbe
   Besitzprüfung wie in Punkt 3 zurückgeben. Erforderlich wegen B5: die Idempotenzprüfung
   liegt außerhalb der Transaktion, zwei gleichzeitige Versuche sind bereits heute
   möglich, und das Ergebnis ist ein 500 für einen völlig normalen Ablauf. Die
   Doppelbestellung verhindert die Datenbank auch ohne diese Änderung — die Änderung
   betrifft die Antwort, nicht die Daten.

5. **Optionales `cashierSessionId` in `CreateOrderDto` mit Prüfung** —
   `orders.service.ts:13-24` und `orders.service.ts:853-862`. Ist das Feld gesetzt und
   entspricht es nicht der heute aktiven Sitzung des Benutzers für diese Veranstaltung,
   `ConflictException`. Fehlt das Feld, bleibt das Verhalten unverändert, damit heutige
   Online-Bestellungen ohne Sitzung weiterlaufen. Erforderlich, weil das Issue
   "geschlossene Kassensitzung" als Konflikt und die Durchsetzung durch das Backend
   unabhängig von der Oberfläche verlangt; heute prüft `createOrder` nur die Betriebsart
   der Sitzung und bucht sonst ohne Sitzung (B7).

**Ausdrücklich nicht erforderlich:** eine Änderung der Idempotenzsemantik selbst (der
Kurzschluss in `orders.service.ts:769-780` liefert bereits genau das Verhalten, das der
Absturzfall braucht), ein neues Bestellformat, ein Ereignisstrom für
Warteschlangenzustände, eine serverseitige Warteschlange.

## 9. Abgrenzung: was dieser Schnitt nicht löst

- Kein Versand im Hintergrund ohne geöffnete Anwendung. Kein Service Worker, keine
  Background Sync API.
- Kein Offline-Schnellverkauf. `POST /orders/quick-sale` verlangt eine aktive Sitzung
  und einen aktiven Drucker (`orders.service.ts:415-446`) und wird nicht vorgemerkt.
- Keine Offline-Kartenzahlung. Zahlungen werden nur als Betrag und Art vorgemerkt.
- Keine Warteschlange über Geräte hinweg. Sie hängt an Browser und Gerät; eine
  Vormerkung ist auf einem anderen Gerät nicht sichtbar.
- Keine automatische fachliche Konfliktauflösung, kein Nachziehen von Preisen, kein
  Ersetzen von Produkten.
- Keine Offline-Behandlung von Nachzahlungen (`POST /orders/:id/payments`), Stornos oder
  Nachdrucken.
- Keine globale `ValidationPipe` und keine DTO-Klassen für `POST /orders`. Der Endpunkt
  nimmt weiterhin `@Body() body: any` entgegen (`orders.controller.ts:45-49`,
  `main.ts` ohne `useGlobalPipes`). Das ist eigener Umfang.
- Keine Verschlüsselung der Warteschlange auf dem Gerät.
- Keine Änderung an der Idempotenz des Schnellverkaufs.
- Keine Kopplung an das Schließen einer Kassensitzung oder das Abschließen einer
  Veranstaltung; siehe Abschnitt 10, Punkt 3.

## 10. Offene Punkte für die Projektleitung

1. **Aufbewahrung bestätigter Einträge.** Vorschlag: `CONFIRMED` bleibt 24 Stunden in
   einer getrennten Liste "erledigt" sichtbar, danach löscht der Aufräumlauf beim Start.
   Zu entscheiden: Dauer, und ob die Liste eine Abmeldung überdauern soll.
2. **Übernahme von Altbeständen** (Abschnitt 6). Darf ein beliebiger Bediener einen
   kontextlosen Eintrag aus Version 1 unter seinem Namen senden? Vorschlag: ja,
   ausdrücklich und mit `adoptedByUserId` festgehalten, weil das Verwerfen echten Geldes
   die schlechtere Voreinstellung ist. Alternative: nur `ADMINISTRATOR`.
3. **Sperrwirkung offener Einträge.** Soll das Schließen einer Kassensitzung oder das
   Abschließen einer Veranstaltung gewarnt oder verhindert werden, solange Einträge in
   `LOCAL_PENDING`, `CONFLICT` oder `FAILED` liegen? Fachlich naheliegend, berührt aber
   `sessions.controller.ts:55-66` und den Veranstaltungsabschluss und ist daher hier
   nicht enthalten.
4. **Maschinenlesbare Fehlerkennungen.** Im ursprünglichen Schnitt bewusst
   zurückgestellt; mit Issue #93 als stabile `code`-Eigenschaft für die
   fachlichen 4xx-Antworten von `POST /orders` umgesetzt. Der Textweg bleibt
   ausschließlich als Abwärtskompatibilitäts-Fallback erhalten.
5. **Wer darf verwerfen?** Vorschlag: der erfassende Benutzer oder `ADMINISTRATOR`;
   Altbestände nur `ADMINISTRATOR`. Zu bestätigen.
6. **Darf eine Vormerkung mit Zahlungen überhaupt verworfen werden**, oder muss sie
   zwingend an eine höhere Rolle eskaliert werden? Der Entwurf lässt das Verwerfen mit
   zusätzlicher Bestätigung zu.
7. **Obergrenze der Warteschlange und der Fall "IndexedDB nicht verfügbar"** (privates
   Fenster, voller Speicher). Vorschlag: Warnung ab 50 offenen Einträgen; ist das
   Speichern nicht möglich, wird der Kassiervorgang mit klarer Meldung **abgelehnt**,
   statt eine Bestellung stillschweigend zu verlieren. Zu bestätigen.

## 11. Entscheidungen der Projektleitung

Verbindlich. Ersetzen die Vorschläge in Abschnitt 10.

1. **Bestätigte Einträge bleiben 24 Stunden sichtbar**, in einer getrennten Liste „Erledigt", danach werden sie entfernt. Wer nach einer Schicht nachsehen will, ob eine Vormerkung durchging, soll das können, ohne die offene Warteschlange zu überladen.

2. **Altbestände aus Version 1 werden übernommen, nicht verworfen** — ausdrücklich, mit festgehaltenem übernehmendem Benutzer. Die Übernahme ist auf `ADMINISTRATOR` und `EVENT_MANAGER` beschränkt. Begründung: Eine Vormerkung ohne Kontext kann kassiertes Geld enthalten; sie stillschweigend zu verwerfen wäre der schlechtere Ausgang. Sie aber einem beliebig gerade Angemeldeten zuzuschreiben, ist genau der Fehler, den dieser Schnitt beseitigen soll. Eine Person mit Überblick entscheidet.

3. **Offene Einträge sperren weder den Sitzungsschluss noch den Abschluss einer Veranstaltung.** Das berührt fremden Umfang. Als eigener Vorgang festzuhalten; hier nicht umsetzen.

4. **Eine stabile `code`-Eigenschaft in den 4xx-Antworten** wurde mit Issue #93
   ergänzt. Zustandswechsel und Wiederholungsentscheidungen hängen weiterhin
   allein an Statusklasse beziehungsweise Netzwerkfehler; die Kennung steuert
   nur die konkrete Konfliktursache. Fehlt sie bei einem alten Server, greift
   der Text-Fallback.

5. **Verwerfen darf der erfassende Benutzer oder `ADMINISTRATOR`.** Übernommene Altbestände darf nur `ADMINISTRATOR` oder `EVENT_MANAGER` verwerfen.

6. **Eine Vormerkung mit Zahlungen darf verworfen werden, aber nur durch `ADMINISTRATOR`**, und das Audit-Ereignis hält den Betrag, die Zahlungsarten und den erfassenden Benutzer fest. Begründung: Ein Eintrag mit Zahlungen bedeutet, dass Geld geflossen ist. Ihn gar nicht verwerfen zu können, hilft niemandem — eine irrtümliche Erfassung muss man loswerden. Aber es ist keine Entscheidung für den laufenden Betrieb am Tresen, und sie muss nachvollziehbar bleiben.

7. **Obergrenze 200 offene Einträge.** Darüber hinaus wird ein weiterer Kassiervorgang mit klarer Meldung abgelehnt, statt still zu verlieren. Dasselbe gilt, wenn IndexedDB nicht verfügbar ist: ablehnen mit Begründung, niemals stillschweigend annehmen und dann vergessen.

## 12. Zuschnitt der Umsetzung

Befund B6 aus Abschnitt 1 wird **vorgezogen und getrennt behoben**, bevor die Warteschlange gebaut wird.

Begründung: Der Kurzschluss der Idempotenzprüfung in `createOrder` gibt eine vorhandene Bestellung ohne jede Prüfung zurück — weder Benutzer noch Veranstaltung noch Inhalt werden verglichen. Das ist unabhängig von der Offline-Warteschlange ein Fehler in der Bestellannahme, und die Warteschlange würde ihre gesamte Wiederholungslogik darauf aufbauen. Ein Sicherheitsmangel gehört nicht in die Abhängigkeit eines großen Vorhabens.

Alles Übrige bleibt in diesem Issue.
