# Bondruck: ESC/POS-Netzwerkdrucker und Simulator

Der Print-Worker holt Druckaufträge aus der persistenten Warteschlange des Backends,
formatiert sie und überträgt sie an den konfigurierten Drucker. Ein Auftrag gilt erst
dann als `PRINTED`, wenn der Transport nachweislich abgeschlossen ist.

## Aufbau

```
Backend (Warteschlange)
  -> claim  ->  Print-Worker
                  1. resolveTarget()   Druckerzeile -> geprüftes Ziel
                  2. buildDocument()   Auftrag -> geräteunabhängiges Dokument
                  3. renderDocument()  Dokument -> Zeilen des Papierprofils
                  4. encodeEscPos()    Zeilen -> ESC/POS-Bytes
                  5. Adapter.deliver() Bytes -> Drucker oder Simulator
  <- PRINTED / FAILED
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
| `src/adapters/simulator.ts` | Deterministische Ausgabe für Entwicklung und CI        |

## Druckerkonfiguration

Die Administration pflegt je Drucker:

| Feld         | Bedeutung                                               | Standard  |
| ------------ | ------------------------------------------------------- | --------- |
| `type`       | `CONSOLE` (Simulator) oder `ESC_POS_NETWORK` (LAN/WLAN) | –         |
| `ipAddress`  | IP-Adresse oder Hostname, nur für Netzwerkdrucker       | –         |
| `port`       | Rohdaten-Port des Druckers                              | `9100`    |
| `paperWidth` | `58` (32 Zeichen) oder `80` (48 Zeichen)                | `80`      |
| `codepage`   | `CP858`, `CP850` oder `CP437`                           | `CP858`   |
| `cutMode`    | `PARTIAL`, `FULL` oder `NONE`                           | `PARTIAL` |
| `copies`     | Ausfertigungen je Auftrag, 1 bis 9                      | `1`       |
| `timeoutMs`  | Zeitlimit für Verbindung und Übertragung                | `5000`    |

USB- und Treiberdrucker werden nicht unterstützt; das Backend weist solche Typen ab.

`CP858` ist der Standard, weil es als einzige der drei Codepages das Eurozeichen kennt.
Fehlt ein Zeichen in der gewählten Codepage, wird es nachvollziehbar ersetzt: `€` wird zu
`EUR`, typografische Anführungszeichen werden zu geraden, Akzente fallen auf den
Grundbuchstaben zurück.

## Simulator

Der Simulator schreibt den Bon zeichengetreu auf die Standardausgabe. Er erzeugt keine
Zeitstempel und keine Zufallswerte, dieselbe Eingabe ergibt also immer dieselbe Ausgabe.

```bash
export BACKEND_URL=http://127.0.0.1:3000
export PRINT_WORKER_TOKEN=<mindestens 32 Zeichen>
export PRINT_FORCE_SIMULATOR=1
pnpm --filter @vereinorder/print-worker run dev
```

| Variable                 | Bedeutung                                          | Standard                |
| ------------------------ | -------------------------------------------------- | ----------------------- |
| `BACKEND_URL`            | Adresse des Backends                               | `http://127.0.0.1:3000` |
| `PRINT_WORKER_TOKEN`     | Gemeinsames Geheimnis für die Warteschlange        | –                       |
| `PRINT_FORCE_SIMULATOR`  | `1` lenkt jeden Drucker auf den Simulator          | aus                     |
| `PRINT_POLL_INTERVAL_MS` | Abfrageintervall der Warteschlange                 | `2500`                  |
| `PRINT_TIMEOUT_MS`       | Zeitlimit, wenn der Drucker keines gespeichert hat | `5000`                  |

## Fehlerbilder

Der Worker beendet einen Auftrag mit `FAILED` und einer Diagnose, die die Administration
im Testdruck direkt sieht:

| Kennung              | Ursache                                    |
| -------------------- | ------------------------------------------ |
| `DNS_ERROR`          | Hostname nicht auflösbar                   |
| `CONNECTION_REFUSED` | Drucker aus oder falscher Port             |
| `UNREACHABLE`        | Kein Netzweg zum Drucker                   |
| `TIMEOUT`            | Keine Antwort innerhalb des Zeitlimits     |
| `CONNECTION_LOST`    | Verbindung während der Übertragung beendet |
| `WRITE_FAILED`       | Daten konnten nicht gesendet werden        |

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
