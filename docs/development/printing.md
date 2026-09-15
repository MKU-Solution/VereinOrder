# Bondruck: ESC/POS-Netzwerkdrucker und Simulator

Der Print-Worker holt Druckaufträge aus der persistenten Warteschlange des Backends,
formatiert sie und überträgt sie an den konfigurierten Drucker. Ein Auftrag gilt erst
dann als `PRINTED`, wenn der Transport nachweislich abgeschlossen ist.

## Aufbau

```
Backend (Warteschlange)
  -> claim (leaseId) ->  Print-Worker
                  1. resolveTarget()   Druckerzeile -> geprüftes Ziel
                  2. buildDocument()   Auftrag -> geräteunabhängiges Dokument
                  3. renderDocument()  Dokument -> Zeilen des Papierprofils
                  4. encodeEscPos()    Zeilen -> ESC/POS-Bytes
                  5. Phase DELIVERING bestätigen  <-- vor dem ersten Byte
                  6. Adapter.deliver() Bytes -> Drucker, CUPS oder Simulator
  <- PRINTED | NOT_PRINTED | UNCLEAR
```

Schritt 3 ist die gemeinsame formatierte Darstellung: Der Simulator gibt genau diese
Zeilen aus, der Netzwerkdrucker erhält dieselben Zeilen als ESC/POS-Bytes. Ein im
Simulator geprüfter Bon sieht auf Papier deshalb gleich aus.

| Datei                       | Aufgabe                                                |
| --------------------------- | ------------------------------------------------------ |
| `src/target.ts`             | Druckerzeile prüfen und auf eine Transportart abbilden |
| `src/printing/documents.ts` | Auftragsinhalt in Blöcke übersetzen                    |
| `src/printing/document.ts`  | Umbruch, Spalten, Einrückung, Ausrichtung              |
| `src/printing/charset.ts`   | Codepage-Abbildung für Umlaute und Euro                |
| `src/printing/escpos.ts`    | Steuerbefehle, Schnitt, Ausfertigungen                 |
| `src/adapters/tcp.ts`       | Raw-TCP-Transport (LAN und WLAN)                       |
| `src/adapters/cups.ts`      | CUPS-Transport über IPP, für USB-Drucker am Host       |
| `src/ipp/protocol.ts`       | Minimaler IPP-Kodierer für drei Operationen            |
| `src/adapters/simulator.ts` | Deterministische Ausgabe für Entwicklung und CI        |

## Drei Ergebnisklassen statt Erfolg und Fehler

Ein Druckversuch endet nicht in „ging" oder „ging nicht", sondern in einer von drei
Klassen. Der Worker meldet die Klasse, das Backend leitet daraus Status und Failover ab.

| Klasse        | Bedeutung                                             | Folge                       |
| ------------- | ----------------------------------------------------- | --------------------------- |
| `PRINTED`     | Daten nachweislich vollständig an das Gerät übergeben | Auftrag ist fertig          |
| `NOT_PRINTED` | Beweisbar kein einziges Byte am Drucker               | Ersatzdrucker, genau einmal |
| `UNCLEAR`     | Alles ohne positives Abschlusszeugnis                 | Entscheidung eines Menschen |

Die Beweisregel dahinter: `socket.bytesWritten === 0` ist ein Beweis, dass nichts den
Prozess verlassen hat. Ein Wert größer null ist kein Beweis für einen Druck, aber er
zerstört den Gegenbeweis — also `UNCLEAR`. Ein halber Bon ist ein realistischer Ausgang,
weil ESC/POS-Drucker zeilenweise beim Empfang drucken.

`UNCLEAR` ist kein Fehler, sondern ein Zustand, der auf eine Person wartet. Es gibt
bewusst keinen automatischen Zweitdruck: Die Administration entscheidet in der
Druckerverwaltung zwischen erneut drucken, als gedruckt bestätigen und verwerfen.

## Reservierung mit Fencing-Token

Jeder Claim erzeugt ein `leaseId` und eine Ablaufzeit. Jede weitere Meldung des Workers
trägt dieses Token; ein Worker mit altem Token wird mit `409` abgewiesen und bricht still
ab. Der Worker verlängert die Reservierung alle 20 Sekunden per Herzschlag.

Innerhalb der Reservierung gilt eine Phase, und nur sie entscheidet, was bei Ablauf
geschieht:

| Phase        | Bedeutung                       | Bei Ablauf der Reservierung |
| ------------ | ------------------------------- | --------------------------- |
| `CLAIMED`    | reserviert, kein Byte gesendet  | zurück nach `PENDING`       |
| `DELIVERING` | Übertragung läuft               | `UNRESOLVED`                |
| `SPOOLED`    | CUPS hat den Auftrag angenommen | `UNRESOLVED`                |

Der Phasenwechsel `CLAIMED` nach `DELIVERING` muss vom Backend bestätigt sein, **bevor**
das erste Byte den Prozess verlässt. Scheitert die Bestätigung, wird nicht gedruckt.
Ohne diese Reihenfolge wäre die ganze Sicherung wertlos.

Es gibt keinen zeitgesteuerten Neuversuch mehr. Zeitablauf allein löst nie einen Druck
aus — nur der Ablauf einer Reservierung in Phase `CLAIMED`, und das heißt nachweislich
kein gesendetes Byte.

## Druckerkonfiguration

Die Administration pflegt je Drucker:

| Feld                | Bedeutung                                                                    | Standard         |
| ------------------- | ---------------------------------------------------------------------------- | ---------------- |
| `type`              | `CONSOLE`, `ESC_POS_NETWORK` (LAN/WLAN) oder `CUPS_IPP`                      | –                |
| `ipAddress`         | Pflicht bei `ESC_POS_NETWORK`; bei `CUPS_IPP` nur ein abweichender CUPS-Host | –                |
| `queueName`         | Name der CUPS-Warteschlange, Pflicht bei `CUPS_IPP`                          | –                |
| `port`              | Rohdaten-Port des Druckers, bei `CUPS_IPP` der IPP-Port                      | `9100` / `631`   |
| `fallbackPrinterId` | Ersatzdrucker; keine Ketten, keine Zyklen                                    | –                |
| `paperWidth`        | `58` (32 Zeichen) oder `80` (48 Zeichen)                                     | `80`             |
| `codepage`          | `CP858`, `CP850` oder `CP437`                                                | `CP858`          |
| `codepageProfile`   | `EPSON_STANDARD` oder `MUNBYN_CLONE` — siehe unten                           | `EPSON_STANDARD` |
| `cutMode`           | `PARTIAL`, `FULL` oder `NONE`                                                | `PARTIAL`        |
| `copies`            | Ausfertigungen je Auftrag, 1 bis 9                                           | `1`              |
| `timeoutMs`         | Zeitlimit für Verbindung und Übertragung                                     | `5000`           |

USB-Drucker hängen am CUPS-Dienst des Hosts, nicht am Worker. Der Worker spricht CUPS
über IPP an und braucht dafür keine Gerätefreigabe. Einrichtung und Fehlersuche am Gerät
stehen in `docs/ops/druckerbetrieb.md`. Treiberdrucker werden nicht unterstützt; das
Backend weist solche Typen ab.

`CP858` ist der Standard, weil es als einzige der drei Codepages das Eurozeichen kennt.
Fehlt ein Zeichen in der gewählten Codepage, wird es nachvollziehbar ersetzt: `€` wird zu
`EUR`, typografische Anführungszeichen werden zu geraden, Akzente fallen auf den
Grundbuchstaben zurück.

### `codepageProfile`: die Codepage-Befehlsnummer ist herstellerabhängig

`codepage` legt fest, **welche** Codepage gedruckt werden soll (die Bytezuordnung in
`src/printing/charset.ts`, `CODEPAGE_TABLES`). Damit der Drucker tatsächlich auf diese
Codepage umschaltet, sendet der Worker vor dem Bon den ESC/POS-Befehl `ESC t n` — und
**welche Zahl `n` welche Codepage bedeutet, legt der Druckerhersteller fest**, nicht der
ESC/POS-Standard.

Issue #260, belegt am 15.09.2026 gegen echte Hardware (ein MUNBYN-Netzwerkdrucker):
Epson-Geräte erwarten für `CP858` die Zahl `19`, dieses Gerät aber `14`. Gravierender als
die abweichende Zahl selbst ist, **wie** das Gerät auf eine bei ihm nicht belegte Zahl
reagiert: Es verwirft sie **stillschweigend** — kein Fehler, keine Rückmeldung, der Bon
druckt normal weiter, nur auf der zuletzt aktiven Seite. Beim betroffenen Gerät ist das
nach `ESC @` (Reset) ausgerechnet eine griechische Vorgabeseite, weshalb deutsche Bons
griechisch herauskamen, obwohl `codepage` korrekt auf `CP858` stand.

`CODEPAGE_COMMANDS` in `src/printing/charset.ts` bildet deshalb je Geräteprofil
(`codepageProfile`) eine eigene Zuordnungstabelle ab:

```ts
export const CODEPAGE_COMMANDS: Record<
  CodepageProfile,
  Record<Codepage, number>
> = {
  EPSON_STANDARD: { CP437: 0, CP850: 2, CP858: 19 },
  MUNBYN_CLONE: { CP437: 0, CP850: 2, CP858: 14 },
};
```

`EPSON_STANDARD` bleibt der Vorgabewert und darf es auch bleiben: Geräte, die sich an
Epsons Nummerierung halten, dürfen durch diese Einstellung nicht brechen. `MUNBYN_CLONE`
ist der aktuell einzige belegte Abweichler; ein weiteres Profil kommt erst hinzu, wenn ein
weiteres Gerät mit abweichender Nummerierung ebenso belegt ist — nicht auf Verdacht.

Ein benanntes Geräteprofil statt einer rohen ESC/POS-Zahl als Einstellung ist eine bewusste
Entscheidung: Ein Vereinsmitglied ohne Entwicklerkenntnisse muss einen falsch druckenden
Drucker selbst umstellen können. "Mein Drucker ist ein MUNBYN oder ein baugleicher Nachbau"
ist dafür verständlicher als eine zu erklärende Zahl aus einer Hersteller-Selbsttestseite.

### Woran erkennt man eine falsche Codepage?

**Es gibt in ESC/POS keinen Befehl, mit dem der Worker den Drucker fragen könnte, welche
Codepage gerade aktiv ist.** Eine softwareseitige Rückprüfung ist nicht möglich und wird
hier auch nicht versucht — jeder scheinbare Erfolg einer solchen Prüfung wäre erfunden.

Das einzige Werkzeug ist die **Umlautprobe** auf dem Testbon
(`src/printing/documents.ts`, Zeile `Umlautprobe: ÄÖÜ äöü ß 1,50 €`) — ein Mensch muss sie
lesen. Sie ist kein Nebeneffekt des Testdrucks, sondern der eigentliche Zweck der Zeile:
Sie deckte den MUNBYN-Befund aus Issue #260 beim allerersten Druck gegen echte Hardware
auf, weil Umlaute und Papierbreite auf dem Bon sofort erkennbar falsch waren.

- **Fremde Schrift (z. B. griechisch, kyrillisch) statt Umlauten:** Der gesendete
  `ESC t n`-Wert ist am Gerät nicht belegt und wurde verworfen; der Drucker steht auf
  seiner (oft fremdsprachigen) Vorgabeseite. `codepageProfile` in der Verwaltung
  umstellen und den Testbon erneut drucken.
- **Umlaute richtig, aber kein Eurozeichen (z. B. `?` oder ein anderes Zeichen statt `€`):**
  Der Befehl wirkt, trifft aber eine Codepage ohne Eurozeichen (z. B. `CP437` oder eine
  andere Fremdcodepage desselben `codepageProfile`). Das war der entscheidende
  Unterscheidungsbefund in Issue #260: Umlaute richtig **und** Euro falsch beweist, dass
  die Seite tatsächlich gewechselt wurde, nur eben auf die falsche.
- **Alles korrekt:** `codepage` und `codepageProfile` passen zusammen für dieses Gerät.

Ob nach der Einrichtung eines Druckers eine ausdrückliche Bestätigung verlangt werden
sollte, dass die Umlautprobe korrekt aussah, ist eine Produktentscheidung und bisher nicht
umgesetzt.

## Simulator

Der Simulator schreibt den Bon zeichengetreu auf die Standardausgabe. Er erzeugt keine
Zeitstempel und keine Zufallswerte, dieselbe Eingabe ergibt also immer dieselbe Ausgabe.

```bash
export BACKEND_URL=http://127.0.0.1:3000
export PRINT_WORKER_TOKEN=<mindestens 32 Zeichen>
export PRINT_FORCE_SIMULATOR=1
pnpm --filter @vereinorder/print-worker run dev
```

| Variable                 | Bedeutung                                            | Standard                          |
| ------------------------ | ---------------------------------------------------- | --------------------------------- |
| `BACKEND_URL`            | Adresse des Backends                                 | `http://127.0.0.1:3000`           |
| `PRINT_WORKER_TOKEN`     | Gemeinsames Geheimnis für die Warteschlange          | –                                 |
| `PRINT_FORCE_SIMULATOR`  | `1` lenkt jeden Drucker auf den Simulator            | aus                               |
| `PRINT_POLL_INTERVAL_MS` | Abfrageintervall der Warteschlange                   | `2500`                            |
| `PRINT_TIMEOUT_MS`       | Zeitlimit, wenn der Drucker keines gespeichert hat   | `5000`                            |
| `CUPS_BASE_URL`          | Adresse des CUPS-Dienstes auf dem Host               | `http://host.docker.internal:631` |
| `PRINT_CUPS_POLL_MS`     | Abfrageintervall des Auftragszustands in CUPS        | `1000`                            |
| `PRINT_CUPS_WAIT_MS`     | Wartezeit auf ein Endergebnis, danach Abbruchversuch | `120000`                          |

## Fehlerbilder

Jede Kennung trägt eine feste Ergebnisklasse. Die Administration sieht die Diagnose im
Testdruck und bei unklaren Aufträgen direkt.

| Kennung                        | Ursache                                    | Klasse                 |
| ------------------------------ | ------------------------------------------ | ---------------------- |
| `DNS_ERROR`                    | Hostname nicht auflösbar                   | `NOT_PRINTED`          |
| `CONNECTION_REFUSED`           | Drucker aus oder falscher Port             | `NOT_PRINTED`          |
| `UNREACHABLE`                  | Kein Netzweg zum Drucker                   | `NOT_PRINTED`          |
| `TIMEOUT`                      | Keine Antwort innerhalb des Zeitlimits     | je nach `bytesWritten` |
| `CONNECTION_LOST`              | Verbindung während der Übertragung beendet | je nach `bytesWritten` |
| `WRITE_FAILED`                 | Daten konnten nicht gesendet werden        | `UNCLEAR`              |
| `CUPS_UNREACHABLE`             | CUPS-Dienst antwortet nicht                | `NOT_PRINTED`          |
| `CUPS_QUEUE_NOT_FOUND`         | Warteschlange existiert nicht              | `NOT_PRINTED`          |
| `CUPS_QUEUE_NOT_ACCEPTING`     | Warteschlange nimmt keine Aufträge an      | `NOT_PRINTED`          |
| `CUPS_JOB_CANCELED_PENDING`    | Abbruch, bevor der Druck begann            | `NOT_PRINTED`          |
| `CUPS_JOB_CANCELED_PROCESSING` | Abbruch mitten im Druck                    | `UNCLEAR`              |
| `CUPS_JOB_ABORTED`             | CUPS hat den Auftrag verworfen             | `UNCLEAR`              |
| `CUPS_DEVICE_DISCONNECTED`     | Gerät während des Drucks getrennt          | `UNCLEAR`              |
| `CUPS_RESPONSE_LOST`           | Antwort von CUPS ging verloren             | `UNCLEAR`              |

Papier aus löst ausdrücklich **kein** Failover aus: Der Auftrag bleibt im Spooler und
druckt nach dem Nachlegen weiter. Ein Wechsel wäre dort ein garantierter Doppeldruck.

Ein Auftrag, dessen Drucker falsch konfiguriert ist, scheitert sofort mit einer
Konfigurationsmeldung statt still auf der Konsole zu landen.

## Protokolle

Der Worker schreibt strukturierte JSON-Zeilen mit Auftrags- und Druckerkennung, Typ,
Transport, Bytezahl und Dauer. Bon-Inhalte, PINs und Tokens werden nicht protokolliert;
Geheimnisse aus Fremdmeldungen werden vor der Ausgabe entfernt.

## Betrieb ohne Internet

Der Transport ist reines TCP im lokalen Netz. Es werden weder Cloud-Dienste noch
Herstellerbibliotheken benötigt, der Festbetrieb bleibt damit offline lauffähig.

## Tests

```bash
pnpm --filter @vereinorder/print-worker test
```

Die Integrationstests starten einen lokalen TCP-Server als Ersatzdrucker und prüfen
Erfolg, abgelehnte Verbindung, Abbruch und Zeitüberschreitung. Ein Neustart des Workers
mit offenem Auftrag ist unkritisch: Das Backend gibt Aufträge frei, die länger als fünf
Minuten in `PROCESSING` stehen.
