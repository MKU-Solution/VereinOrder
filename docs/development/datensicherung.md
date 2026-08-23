# Datensicherung, Wiederherstellung und Aufbewahrung (Issue #67)

Verbindlicher Entwurf für die Umsetzung. Betrifft `apps/backend/src/backup/`, das
Backend-Abbild, `docker-compose.yml`, `infrastructure/scripts/`, die Administration und
die CI. Ergänzt `offline-warteschlange.md` (Abschnitt 6 dieses Entwurfs hängt daran),
`../ops/backup-recovery.md` und `../product/master-prompt.md`, Abschnitt 31.

Die Architekturentscheidung steht als eigenes Dokument in
`../architecture/decisions/0001-sicherungsformat-postgresql-dump.md`. Begründung für die
Trennung: `../product/master-prompt.md`, Abschnitt 35, legt `docs/architecture/decisions/`
als Ablageort für Architecture Decision Records fest. Ein ADR ist außerdem länger
gültig als der Entwurf, der ihn ausgelöst hat — er wird von späteren Vorgängen
referenziert, dieser Entwurf nicht. Ein Abschnitt hier hätte beides vermengt.

Dieser Entwurf enthält keinen Produktionscode. Er legt Format, Manifest, Wartungsmodus,
Ablauf, Aufbewahrung und Nachweis fest.

Issue #100 („Produktbons und Abholnummernzähler fehlen in der Sicherung") wird von
diesem Vorgang mit erledigt — für neue Sicherungen strukturell (Abschnitt 2), für
Altbestände über den Übernahmeweg (Abschnitt 5).

## 1. Ausgangslage und Befunde

Der heutige Sicherungsweg besteht aus 354 Zeilen in
`apps/backend/src/backup/backup.service.ts`, vier Endpunkten in
`backup.controller.ts`, zwei Schaltflächen im Administrationsbereich
(`apps/frontend/src/pages/AdminDashboard.tsx:1032-1080`) und zwei Shell-Skripten in
`infrastructure/scripts/`, die einen völlig anderen Weg gehen als die Anwendung.

### Bestätigte Befunde der Projektleitung

**B1 — Die Wiederherstellung funktioniert überhaupt nicht. Bestätigt.**
`restoreBackup` legt zuerst eine Sicherheitssicherung an und übergibt dafür den
Dateinamen als Vorlagenzeichenkette an `this.createBackup(...)`
(`backup.service.ts:234`). Der Parameter von `createBackup` ist aber `userId` (`:56`).
Der Dateiname landet damit in `auditLog.create({ data: { userId } })` (`:148-160`), und
`AuditLog.userId` ist ein Fremdschlüssel auf `User`
(`packages/database/prisma/schema.prisma:673-674`). Die Messung der Projektleitung gegen
eine echte Instanz:

```
ERGEBNIS: FEHLGESCHLAGEN
  Fehlertyp: PrismaClientKnownRequestError
  Prisma-Code: P2003
```

Der Abbruch erfolgt **vor** der Transaktion. Die Wiederherstellung ist damit seit ihrer
Entstehung in keinem einzigen Fall gelaufen.

**B2 — Die Sicherung deckt 15 von 19 Modellen ab. Bestätigt.**
`backup.service.ts:63-95`. Es fehlen `ProductVoucher`, `EventPickupCounter`,
`ConfigOperation` und `AuthThrottle`.

**B3 — Auditeinträge werden gesichert, aber nie zurückgespielt. Bestätigt.**
`auditLogs` stehen im `data`-Block (`:134`); im Wiederherstellungsweg (`:239-352`) gibt
es kein `auditLog.createMany`.

**B4 — Die Datei enthält `pinHash` aller Benutzer und ist herunterladbar. Bestätigt.**
`this.prisma.user.findMany()` ohne Spaltenauswahl (`:87`), Auslieferung über
`GET /backup/download/:filename` (`backup.controller.ts:34-55`).

### Zusätzliche Befunde

**B5 — `ProductVoucher` und `EventPickupCounter` werden nicht vergessen, sondern
gelöscht.** Das ist die schärfere Fassung von B2 und von #100. `ProductVoucher.orderId`
trägt `onDelete: Cascade` (`schema.prisma:426-427`), `EventPickupCounter.eventId`
ebenso (`:717-718`). Die Wiederherstellung ruft `tx.order.deleteMany()`
(`backup.service.ts:249`) und `tx.event.deleteMany()` (`:258`). Beide Tabellen werden
also aktiv geleert und nie wieder gefüllt. Die Formulierung „fehlt in der Sicherung"
untertreibt: selbst wenn die Datei die Daten enthielte, gingen sie verloren.

**B6 — Die Bestellnummer wird nach einer Wiederherstellung doppelt vergeben, ohne
Fehlermeldung.** `Order.orderNumber` ist eine `SERIAL` (`schema.prisma:322`,
`migrations/20260818115353_feat_orders/migration.sql:10`) **ohne**
Eindeutigkeitsregel. `createMany` schreibt die alten Nummern zurück, aber nichts setzt
die Sequenz nach. Der nächste Verkauf zieht `nextval` = 1. Anders als bei der
Abholnummer aus #66 (`@@unique([eventId, dataMode, pickupNumber])`,
`schema.prisma:373`) gibt es keine Regel, die das abweist — es entstehen still zwei
Bestellungen mit derselben Nummer, und jeder Beleg, jede Reklamation und jede
Abrechnung, die darauf verweist, wird mehrdeutig.

**B7 — Jede vorhandene Auditzeile verliert bei einer Wiederherstellung ihren
Urheber.** `AuditLog` wird nicht gelöscht (kein `auditLog.deleteMany` in
`backup.service.ts:246-258`), aber `tx.user.deleteMany()` läuft (`:261`), und
`AuditLog.userId` trägt `onDelete: SetNull` (`schema.prisma:674`). Die Benutzer werden
danach mit denselben Kennungen neu angelegt (`:262`) — die genullten Verweise werden
dabei nicht wiederhergestellt. Nach einer Wiederherstellung steht in der
Auditübersicht bei jedem Eintrag „System" (`audit.service.ts:140-141`). Zusammen mit B3
heißt das: die Nachvollziehbarkeit von Geldbewegungen überlebt eine Wiederherstellung
in keiner Richtung.

**B8 — Auch ohne B1 scheitert die Wiederherstellung, sobald der handelnde Administrator
nicht in der Sicherung steht.** Der Auditeintrag am Ende der Transaktion
(`backup.service.ts:333-344`) schreibt `userId` des Aufrufers — nachdem `tx.user`
geleert und aus der Datei neu befüllt wurde. Enthält die Datei diese Benutzerkennung
nicht, wirft die letzte Anweisung der Transaktion `P2003` und nimmt die gesamte
Wiederherstellung zurück. Das ist genau der Fall „neu aufgesetztes Gerät, Sicherung
vom alten Gerät" — also der Fall, für den es Sicherungen gibt.

**B9 — Das Prisma-Transaktionszeitlimit reicht nicht.** `backup.service.ts:239` ruft
`$transaction` ohne Optionen auf; die Voreinstellung für interaktive Transaktionen ist
5 Sekunden. Vierzehn `deleteMany` und vierzehn `createMany` über die Daten eines Festes
auf einer microSD-Karte überschreiten das zuverlässig. Der Fehler wäre `P2028`,
ausgelöst irgendwo mitten in der Wiederherstellung.

**B10 — Kein konsistenter Schnappschuss.** `Promise.all` über fünfzehn getrennte
`findMany`-Aufrufe (`backup.service.ts:79-95`). Wird während des Laufs gebucht, kann
die Datei eine `Payment`-Zeile zu einer `Order` enthalten, die sie nicht enthält.

**B11 — Die Prüfsumme wird nie verglichen und steht nicht in der Datei.**
`createBackup` berechnet sie (`:141-144`), gibt sie in der Antwort zurück und schreibt
sie **nur** in den Auditeintrag (`:157`). In der Datei steht sie nicht. `listBackups`
berechnet sie beim Auflisten neu (`:187-190`) — der angezeigte Wert kann deshalb nie
abweichen, egal wie die Datei zugerichtet wurde. Die Spalte „Integrität (SHA256)" in
der Administration (`AdminDashboard.tsx:2244`) sagt nichts aus. `restoreBackup` prüft
sie gar nicht.

**B12 — `listBackups` liest und hasht bei jedem Aufruf sämtliche Dateien.**
`backup.service.ts:181-203`. `DiagnosticsService.getStatus` ruft es mit auf
(`diagnostics.service.ts:85`), und die Administration fragt die Diagnose regelmäßig ab.
Bei 24 stündlichen Sicherungen eines Festes bedeutet jeder Aufruf, den gesamten
Sicherungsbestand von der SD-Karte zu lesen und durch SHA-256 zu schicken — während
gebucht wird.

**B13 — Es gibt keine Aufbewahrung und keine Rotation.** Nichts löscht je eine
Sicherung. Die stündliche Sicherung und jede `PRE_RESTORE`-Sicherung wachsen
unbegrenzt in ein Docker-Volume auf einer 32-GB-Karte.

**B14 — Der stündliche Lauf hat drei Schwächen.** `onModuleInit` setzt ein blankes
`setInterval` (`backup.service.ts:36-53`):

- Es zählt ab Prozessstart, nicht an der Uhr. Ein Gerät, das häufiger neu startet als
  einmal pro Stunde, sichert **nie**. Auf einem Pi am Notstromaggregat ist das kein
  theoretischer Fall.
- Es wird nie abgeräumt; es gibt kein `onModuleDestroy`. In Tests hält der Handle den
  Jest-Prozess offen.
- Es weicht vom Bestand ab: `print-jobs.reaper.ts:30` benutzt `@Interval` aus
  `@nestjs/schedule`, und `ScheduleModule.forRoot()` ist bereits registriert
  (`app.module.ts:23`). Es gibt keinen Grund für einen zweiten Bauweg.

Zusätzlich greift der Lauf nur bei `status: "ACTIVE"` (`:41-43`). Eine Veranstaltung im
`TEST_MODE` wird nicht gesichert, und außerhalb eines Festes wird überhaupt nicht
gesichert — auch nicht die Sortimentsarbeit der Wochen davor.

**B15 — Kein Wartungsmodus, nirgends.** Weder Datenbankfeld noch Datei noch Zustand.
`main.ts` registriert keine globalen Guards oder Interceptoren.

**B16 — Freier Speicher wird nicht gemessen.** Das Issue verlangt ihn diagnostisch,
`../product/master-prompt.md` Abschnitt 32 ebenfalls. `diagnostics.service.ts` kennt
kein `statfs` und keinen vergleichbaren Aufruf.

**B17 — Die Shell-Skripte zielen auf die falsche Datenbank.**
`infrastructure/scripts/backup.sh:14` und `:16` sowie `restore.sh:28` und `:30` sind
fest auf `VereinOrder_test` verdrahtet. Der Festbetrieb heißt laut `.env.example`
`vereinorder`. Beide Skripte sichern und überschreiben im Ernstfall die falsche
Datenbank — oder scheitern, weil es sie nicht gibt. `infrastructure/docker-compose.yml`
ist ein zweites, veraltetes Compose-Bündel, das ebenfalls `VereinOrder_test` anlegt und
mit dem Compose-Bündel im Wurzelverzeichnis um denselben Containernamen
`vereinorder_postgres` konkurriert.

**B18 — Die Betriebsanleitung beschreibt einen Weg, den es nicht gibt.**
`../ops/backup-recovery.md:35` weist an, eine Datei
`./backups/vereinorder_backup_20260820_060000.sql.gz` mit `restore.sh`
wiederherzustellen. Die Administration erzeugt aber ausschließlich
`vereinorder_backup_<ISO>.json`. Kein Weg im System erzeugt eine Datei, auf die diese
Anweisung passt.

**B19 — Die Hygieneprüfung greift beim tatsächlich erzeugten Dateinamen nicht.**
`scripts/ci/check-repository-hygiene.mjs:17` prüft
`/(^|\/)backups?\/.*\.(json|sql|dump|backup)$/i`. `backup.sh` schreibt `.sql.gz` und
`.sql.gz.sha256`; beides endet nicht auf eine der genannten Endungen. Zusätzlich
ignoriert `.gitignore` nur `apps/backend/backups/*` — ein `backups/`-Verzeichnis im
Wurzelverzeichnis, das die Vorgabe `BACKUP_DIR="${BACKUP_DIR:-./backups}"`
(`backup.sh:5`) nahelegt, ist nicht ignoriert.

**B20 — Es gibt keinen Aufhänger für „Sicherung vor Migration".** Nichts im
Festbetrieb ruft `prisma migrate deploy` auf: nur `.github/workflows/ci.yml`,
`docs/development/testing.md` und `scripts/ci/test-migrations.mjs` kennen den Befehl.
`apps/backend/Dockerfile:58` startet unmittelbar `node apps/backend/dist/main`, und
`../ops/raspberry-pi-setup.md` erwähnt Migrationen mit keinem Wort. Auf dem Pi steht
das Schema deshalb auf dem Stand, den irgendwann einmal jemand von Hand eingespielt
hat.

**B21 — Der Auslieferungskopf übernimmt den ungeprüften Parameter.**
`backup.controller.ts:42` und `:48` setzen `Content-Disposition` aus dem rohen
`:filename` der Adresse. Für den Dateipfad wird `path.basename` verwendet
(`backup.service.ts:212`), für den Kopf nicht.

**B22 — `SYSTEM_CRON` ist dieselbe Fehlerklasse wie B1.** `createBackup("SYSTEM_CRON")`
(`:48`) schmuggelt eine Zeichenkette in einen Parameter, der eine Benutzerkennung ist,
und wird eine Zeile weiter (`:147`) durch einen Zeichenkettenvergleich wieder
herausgefiltert. Wäre dieser Vergleich einmal vergessen worden, wäre der stündliche
Lauf mit demselben `P2003` gescheitert wie B1 — nur eben stumm im Hintergrund.

**B23 — `ConfigOperation` und `AuthThrottle` überleben eine Wiederherstellung
unverändert.** Beide haben keinen Fremdschlüssel (`schema.prisma:726-735`, `:38-43`)
und werden weder gelöscht noch eingespielt. Nach einer Wiederherstellung stehen im
Vorgangsprotokoll von #53 also Idempotenzschlüssel für Konfigurationsvorgänge, deren
Wirkung nicht mehr in der Datenbank ist. Eine Wiederholung mit demselben Schlüssel
liefert dann die gespeicherte Antwort zurück, ohne etwas anzulegen.

## 2. Das Sicherungsformat

Entscheidung und Abwägung: `../architecture/decisions/0001-sicherungsformat-postgresql-dump.md`.
Kurzfassung: **nativer Dump im Custom-Format plus lesbares Manifest.**

### Dateien

Je Sicherung entstehen zwei Dateien mit gleichem Stamm im `BACKUP_DIR`:

| Datei                                        | Inhalt                     |
| -------------------------------------------- | -------------------------- |
| `vereinorder_<ISO>_<auslöser>.dump`          | Ausgabe von `pg_dump -Fc`  |
| `vereinorder_<ISO>_<auslöser>.manifest.json` | Klartext-JSON, siehe unten |

`<auslöser>` ist eines von `manual`, `schedule`, `prerestore`, `premigration`. Der
Auslöser gehört in den Namen, weil er die Aufbewahrung steuert (Abschnitt 7) und weil
eine Sicherheitssicherung im Ernstfall am Dateinamen erkennbar sein muss, auch ohne
laufende Anwendung.

`pg_dump`-Aufrufparameter, verbindlich:

```
pg_dump --format=custom --compress=6 --no-owner --no-privileges
        --file=<ziel>.dump "<DATABASE_URL>"
```

`--no-owner` und `--no-privileges` sind nötig, weil der Datenbankbenutzer beim
Einspielen auf ein anderes Gerät nicht derselbe sein muss. `--compress=6` ist der
Kompromiss zwischen CPU-Last auf einem Pi und Platz auf der Karte.

### Manifest

Reines JSON, ohne Werkzeug lesbar. Die Datei ist ausdrücklich **nicht** die Quelle der
Wahrheit über den Inhalt — das ist der Dump — sondern die Quelle über seine
Verwendbarkeit.

| Feld                | Typ                                            | Bedeutung                                                                                                                |
| ------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `kind`              | `"VEREINORDER_DB_BACKUP"`                      | wie `"VEREINORDER_EVENT_CONFIG"` bei #53 (`events.service.ts:887`); verhindert Verwechslung mit dem Konfigurationsexport |
| `manifestVersion`   | `1`                                            | Version **dieses Formats**, nicht der Anwendung                                                                          |
| `createdAt`         | ISO 8601                                       | —                                                                                                                        |
| `trigger`           | `MANUAL\|SCHEDULE\|PRE_RESTORE\|PRE_MIGRATION` | —                                                                                                                        |
| `createdBy`         | `{ userId, username } \| null`                 | `null` bei `SCHEDULE`. **Nie** eine Zeichenkette im Feld `userId` (Lehre aus B1 und B22)                                 |
| `appVersion`        | `string`                                       | aus `package.json` zur Bauzeit, nicht wie heute fest verdrahtet (`backup.service.ts:98`)                                 |
| `databaseName`      | `string`                                       | —                                                                                                                        |
| `serverVersionNum`  | `number`                                       | `SHOW server_version_num`                                                                                                |
| `dumpToolVersion`   | `string`                                       | Ausgabe von `pg_dump --version`                                                                                          |
| `migrations`        | `{ name, checksum }[]`                         | aus `_prisma_migrations`, nur abgeschlossene und nicht zurückgenommene, nach `migration_name` sortiert                   |
| `schemaFingerprint` | `string` (SHA-256)                             | über die serialisierte `migrations`-Liste; siehe Abschnitt 4                                                             |
| `countsBefore`      | `Record<tabelle, number>`                      | `COUNT(*)` je Tabelle, gemessen **vor** dem Dump                                                                         |
| `countsAfter`       | `Record<tabelle, number>`                      | dieselbe Messung **nach** dem Dump                                                                                       |
| `sumsBefore`        | siehe unten                                    | Geldsummen, vor dem Dump                                                                                                 |
| `sumsAfter`         | siehe unten                                    | Geldsummen, nach dem Dump                                                                                                |
| `dumpSizeBytes`     | `number`                                       | —                                                                                                                        |
| `dumpSha256`        | `string`                                       | Prüfsumme über die **Dumpdatei**                                                                                         |
| `verification`      | siehe Abschnitt 7                              | Prüfstand der Sicherung                                                                                                  |

`sums` enthält, je `dataMode` getrennt: `orderTotalAmount`, `paymentAmount` je
`PaymentMethod`, `voucherCount` je `ProductVoucherStatus`, `auditLogCount` und
`auditLogWithUserCount`. Der letzte Wert ist bewusst dabei: er ist die einzige Zahl, an
der sich B7 automatisch fangen lässt.

**Warum zwei Messungen statt einer.** Ein Dump ist punktgenau (Abschnitt 3), aber die
Zählungen daneben können es nicht sein — sie laufen in einer eigenen Transaktion. Statt
Genauigkeit vorzutäuschen, wird der Schnappschuss **eingeklammert**: die Zahlen des
Dumps liegen zwischen `countsBefore` und `countsAfter`. Die Prüfung nach einer
Wiederherstellung lautet damit exakt und ehrlich

```
min(countsBefore[t], countsAfter[t]) <= wiederhergestellt[t] <= max(countsBefore[t], countsAfter[t])
```

und im Wartungsmodus oder in der CI, wo nichts dazwischen bucht, degeneriert sie zur
Gleichheit. Zwei `COUNT(*)`-Läufe über die Datenmenge eines Vereinsfestes kosten
Millisekunden; die Klammer ist der billigste ehrliche Nachweis, den es gibt. Die
Reihenfolge — messen, dumpen, messen — ist verbindlich; die Testdatenbereinigung
(`events.service.ts:398-425`) kann Zeilen auch löschen, deshalb steht `min`/`max` und
nicht `<=` in einer Richtung.

### Prüfsumme

`dumpSha256` steht **im Manifest**, nicht nur im Auditeintrag (Antwort auf B11). Sie
wird berechnet, nachdem die Datei geschlossen ist, und in drei Fällen **verglichen**:

1. Unmittelbar nach dem Schreiben (Selbstprüfung der Sicherung).
2. Beim Auflisten — aber nur einmal je Datei, das Ergebnis wird im Manifest vermerkt
   (Antwort auf B12). Eine Datei, deren Größe und Änderungszeit unverändert sind, wird
   nicht erneut gelesen.
3. **Vor jeder Wiederherstellung**, vor der ersten Änderung an irgendwelchen Daten.

## 3. Konsistenz des Schnappschusses

`pg_dump` arbeitet in einer Transaktion mit `REPEATABLE READ`. Damit ist die Zusage
„konsistenter Datenbanksnapshot" ohne eigenes Zutun erfüllt, und zwar auch dann, wenn
während des Laufs weiter kassiert wird. Das ist die direkte Antwort auf B10 und einer
der Gründe für den Formatwechsel.

Was das **nicht** löst: die Sicherung sperrt nichts, sie hält aber die Transaktion
offen, solange sie läuft. Auf einem Pi mit den Daten eines Vereinsfestes sind das
Sekunden. Ein langlaufender Dump würde `VACUUM` blockieren; bei den hier zu erwartenden
Größenordnungen ist das nicht relevant und wird bewusst nicht behandelt.

## 4. Migrationstand und Kompatibilität

Ein Dump ist gegenüber dem Schema nicht frei einspielbar. Der Bestand kennt zwei
Vorbilder für den Umgang mit Formatständen, und sie sind unterschiedlich gut:

- **Die Ereignisvorlage aus #53** trägt ein von Hand gepflegtes `schemaVersion: 3`
  (`events.service.ts:891`), das der Importeur gegen `1 | 2 | 3` prüft
  (`:1349-1354`). Das funktioniert, weil es genau drei Stände gibt und jemand daran
  denken muss, die Zahl zu erhöhen. Genau dieses „daran denken" ist die Fehlerklasse,
  die uns B2, B5 und B6 eingebracht hat.
- **`_prisma_migrations`** trägt dieselbe Auskunft, ohne dass jemand daran denken muss:
  je angewendeter Migration eine Zeile mit `migration_name` und `checksum`. Prisma
  pflegt sie selbst; `scripts/ci/test-migrations.mjs:906` schreibt über
  `prisma migrate resolve --applied` hinein.

**Entscheidung: `_prisma_migrations` ist die Quelle, nicht eine eigene Versionszahl.**

Der `schemaFingerprint` ist SHA-256 über die nach `migration_name` sortierte Liste der
Paare `(migration_name, checksum)` aller Zeilen mit `finished_at IS NOT NULL` und
`rolled_back_at IS NULL`. Die vollständige Liste steht zusätzlich im Klartext im
Manifest, damit ein Mensch sehen kann, welche Migration fehlt.

Vergleichsregeln vor jeder Wiederherstellung:

| Verhältnis Sicherung ↔ heutige Datenbank             | Entscheidung                                                                     |
| ----------------------------------------------------- | -------------------------------------------------------------------------------- |
| Fingerabdrücke gleich                                 | zugelassen, direkter Weg                                                         |
| Sicherung ist echtes Präfix (älter)                   | zugelassen, aber nur über die Nebendatenbank mit anschließendem `migrate deploy` |
| heutige Datenbank ist echtes Präfix (Sicherung neuer) | **abgelehnt.** Es gibt keinen Rückweg über eine Migration hinweg                 |
| weder noch (auseinandergelaufen)                      | **abgelehnt**, mit Auflistung der beidseitig fehlenden Migrationen               |

Der Vorwärtsweg ist kein neues Verfahren: `scripts/ci/test-migrations.mjs:880-925` fährt
ihn bei jedem CI-Lauf — alter Stand einspielen, `migrate deploy`, `migrate status`,
danach fachlich prüfen. Der Restore nutzt denselben Ablauf, nur mit einem Dump statt
mit `psql`-Skripten als Quelle.

## 5. Umgang mit den vorhandenen JSON-Sicherungen

Auf Geräten liegen bereits `vereinorder_backup_<ISO>.json`-Dateien. Ein Formatwechsel,
der sie stillschweigend wertlos macht, ist nicht zulässig.

**Entscheidung: JSON-Dateien bleiben sichtbar, herunterladbar und übernehmbar, aber es
führt kein Weg mehr von ihnen direkt in die Festbetriebsdatenbank.**

- `listBackups` führt sie weiter auf, gekennzeichnet als **„Altbestand (JSON), nur
  lesbar"**, mit den Zählungen aus der Datei.
- Herunterladen bleibt möglich, unter denselben Bedingungen wie in Abschnitt 8.
- **Wiederherstellen** ist an ihnen nicht mehr angeboten. Stattdessen gibt es genau eine
  Handlung: **„In das aktuelle Format übernehmen"**. Sie legt eine Nebendatenbank an,
  spielt die JSON-Daten dort ein — mit dem heutigen `deleteMany`/`createMany`-Weg, aber
  ohne Zeitlimitproblem, weil die Datenbank leer ist —, korrigiert dabei die Befunde aus
  #100 und B6, erzeugt daraus einen nativen Dump samt Manifest und verwirft die
  Nebendatenbank.
- Bei der Übernahme werden ausgeführt:
  - `productVoucher` aus der Datei einspielen, falls vorhanden.
  - `EventPickupCounter` **ableiten**, nicht einspielen:
    `MAX("pickupNumber")` je `("eventId", "dataMode")` aus den übernommenen
    Bestellungen. Das ist die selbstheilende Variante aus #100 und deckt auch Dateien
    ab, die den Zähler nie enthielten.
  - Alle Sequenzen nachsetzen (`setval` auf `MAX` der jeweiligen Spalte), namentlich
    `Order_orderNumber_seq` (Antwort auf B6).
  - `auditLogs` einspielen (Antwort auf B3), und zwar **nach** den Benutzern.
  - Das Manifest der übernommenen Sicherung trägt `trigger: "MANUAL"`,
    `manifestVersion: 1` und einen Vermerk `adoptedFrom: "<dateiname>.json"`.

**Warum Übernahme statt eines zweiten Wiederherstellungswegs.** Zwei Wege in die
Festbetriebsdatenbank hinein bedeuten zwei Wege, die auseinanderlaufen — der Bestand
liefert dafür in `orders.service.ts` bereits das Anschauungsmaterial, auf das
`stationskasse.md`, Abschnitt 2, verweist. Ein Weg hinein, ein Weg herein-übernehmen:
der Übernahmeweg darf scheitern, ohne dass irgendetwas am Festbetrieb geschieht.

**Fußnote zum heutigen Zustand.** Der Übernahmeweg ist zugleich das einzige Mal, dass
der bestehende JSON-Wiederherstellungscode überhaupt laufen wird — B1 muss dafür
behoben sein. Das ist im Zuschnitt (Abschnitt 13) berücksichtigt.

## 6. Der Wartungsmodus

Es gibt heute keinen (B15). Er ist keine Kür: ein nativer Restore braucht die Datenbank
für sich, und die Umschaltung in Abschnitt 7 verlangt, dass keine andere Verbindung
offen ist.

### Was er ist

**Eine Datei außerhalb der Datenbank, plus ein Zwischenspeicher im Prozess.**

Nicht ein Datenbankfeld — und das ist das entscheidende Argument: eine
Wiederherstellung **ersetzt die Datenbank**. Ein Feld in der Datenbank würde von der
Wiederherstellung selbst auf den Wert überschrieben, den die Sicherung zufällig trug.
Der Wartungsmodus fiele also mitten im gefährlichsten Augenblick weg, und zwar auf
einen Wert, den niemand gesetzt hat.

Nicht eine Umgebungsvariable: er muss zur Laufzeit umschaltbar sein, ohne Neustart.

Nicht nur ein Prozesszustand: das Backend läuft mit `restart: always`
(`docker-compose.yml`). Stürzt es während einer Wiederherstellung ab, muss es **im
Wartungsmodus** wieder hochkommen, nicht offen. Eine Datei in einem eigenen Volume ist
genau das: ausfallsicher geschlossen.

```
STATE_DIR (neu, Vorgabe /app/state, eigenes Docker-Volume)
└── maintenance.json   { phase, since, byUserId, byUsername, reason, expectedUntil }
```

`phase` ist `OPEN | DRAINING | LOCKED`. Fehlt die Datei, gilt `OPEN`.

- `DRAINING` — neue schreibende Vorgänge werden abgewiesen, laufende dürfen zu Ende
  laufen. Der Übergang nach `LOCKED` erfolgt frühestens nach einer festen Wartezeit
  (Vorschlag 20 Sekunden) und erst, wenn keine `PrintJob`-Zeile mehr in Phase
  `DELIVERING` oder `SPOOLED` steht — ein Blatt Papier, das gerade entsteht, wird nicht
  mitten im Vorgang begraben.
- `LOCKED` — alles außer den unten genannten Ausnahmen antwortet `503`.

### Wirkung auf die Schnittstelle

Durchgesetzt über einen globalen Guard, registriert per `APP_GUARD` in `AppModule`. Er
muss vor `JwtAuthGuard` greifen.

| Weg                                                    | Bei `LOCKED`                                                          |
| ------------------------------------------------------ | --------------------------------------------------------------------- |
| `GET /maintenance` (neu, ohne Anmeldung)               | erlaubt — die Oberfläche braucht eine Auskunft, die sie immer bekommt |
| `POST /auth/login`                                     | erlaubt — sonst kommt niemand mehr herein                             |
| alles unter `/backup`                                  | erlaubt, weiterhin nur `ADMINISTRATOR`                                |
| `GET /diagnostics/status`                              | erlaubt                                                               |
| **`GET /sessions/context`**                            | **`503`, ausdrücklich** — Begründung unten                            |
| `/print-jobs/claim`, `/phase`, `/heartbeat`, `/status` | `503` mit `Retry-After`                                               |
| alles Übrige                                           | `503` mit `Retry-After` und deutschem Text                            |

### Warum `GET /sessions/context` mit abgeriegelt wird

Das ist der wichtigste Einzelentschluss dieses Abschnitts, und er folgt aus einer
Messung im Bestand.

Die Sendeschleife der Offline-Warteschlange bricht ihren gesamten Lauf **ohne jeden
Zustandswechsel** ab, wenn der Betriebskontext nicht abfragbar ist
(`apps/frontend/src/lib/offlineSync.ts:417-423`; `docs/development/offline-warteschlange.md`,
Abschnitt 7, Punkt 2). Kein `attempt` wird erhöht, kein Eintrag angefasst.

Antwortete `GET /sessions/context` dagegen normal, liefe die Schleife weiter bis zum
`POST /orders`, bekäme dort `503` und würde das als wiederholbaren Fehler einordnen
(`offlineQueueClassify.ts:267`, `status >= 500`). Die Wartezeiten sind 5, 10, 20, 40 und
80 Sekunden, danach ist `MAX_AUTOMATIC_ATTEMPTS = 6` erreicht und der Eintrag geht nach
`FAILED` (`offlineQueueClassify.ts:12-16`, `offlineSync.ts:364-377`). Das sind
**rund zweieinhalb bis drei Minuten**, dann liegt jede gepufferte Bestellung jeder Kasse
in `FAILED` und wartet auf einen Menschen, der sie einzeln antippt.

Eine Wiederherstellung dauert länger als drei Minuten. Der Wartungsmodus muss deshalb
**vor** der Sendeschleife greifen, nicht in ihr. Nebenbefund: ein `Retry-After` in einer
`503`-Antwort würde nicht helfen — es wird nur bei `429` ausgewertet
(`offlineQueueClassify.ts:271`).

### Wirkung auf die übrigen Beteiligten

- **Angemeldete Kassen.** Bleiben angemeldet; das Token wird nicht entwertet. Die
  Oberfläche fragt `GET /maintenance` ab und legt eine ganzseitige Anzeige darüber
  („Wartung läuft, seit …, voraussichtlich bis …"). Für `ADMINISTRATOR` bleibt
  `/admin` bedienbar. Nach dem Ende der Wartung muss jede Kasse ihren Kontext neu
  laden — die Veranstaltung, die Sitzung und das Sortiment können sich um Stunden
  zurückbewegt haben.
- **Offene Kassensitzungen.** Werden **nicht** geschlossen. Eine Sitzung zu schließen,
  hieße einen Kassenabschluss auf halbem Weg zu erzwingen. Sie werden aber gezählt und
  im Bestätigungsdialog genannt.
- **Der Druck-Arbeiter.** Fragt alle 2,5 Sekunden ab (`PRINT_POLL_INTERVAL_MS`). Er
  bekommt `503`, versucht es weiter und heilt sich beim Ende der Wartung von selbst.
  Dass er das tatsächlich tut und nicht in eine Endlosschleife mit Fehlerprotokoll
  läuft, ist eine Testanforderung (Abschnitt 10) und keine Annahme.
- **Der Lease-Reaper** (`print-jobs.reaper.ts:30`) und der stündliche Sicherungslauf
  setzen im Wartungsmodus aus. Ein Reaper, der während einer Wiederherstellung
  Druckaufträge auf `UNRESOLVED` setzt, arbeitet an Daten, die es gleich nicht mehr gibt.

### Der gefährlichste Fall im ganzen System

**Eine Wiederherstellung im laufenden Festbetrieb, während Kassen offline gepufferte
Bestellungen halten.** Er wird hier ausdrücklich beschrieben, weil er nicht durch
Technik allein lösbar ist.

Ausgangslage: Kasse A hält sieben Vormerkungen in IndexedDB, erfasst unter Sitzung `S`,
mit bereits kassiertem Bargeld in der Lade. Der Administrator stellt eine Sicherung von
vor zwei Stunden wieder her.

1. Die Wiederherstellung setzt die Datenbank auf einen Stand zurück, in dem Sitzung `S`
   noch nicht existiert oder bereits geschlossen war.
2. Nach dem Ende der Wartung prüft Kasse A ihren Kontext und stellt fest, dass die
   erfasste `cashierSessionId` nicht zur heute aktiven Sitzung passt. Alle sieben
   Einträge gehen nach `CONFLICT` / `SESSION_CLOSED`
   (`offline-warteschlange.md`, Abschnitt 4, Punkt 3).
3. **Nichts wird gebucht.** Das Geld liegt in der Lade, die Bestellungen liegen im
   Gerät, und ein Mensch muss jeden Eintrag einzeln entscheiden.

Das ist das **gute** Ergebnis, und es entsteht ausschließlich, weil #65 die
Kontextbindung eingeführt hat. Ohne sie wären die sieben Bestellungen still unter der
falschen Sitzung und womöglich in der falschen Betriebsart gebucht worden.

Der **schlechte** Fall lässt sich nicht wegkonstruieren: Hatte Kasse A eine Bestellung
bereits erfolgreich gesendet und ihren Eintrag nach 24 Stunden aufgeräumt, und liegt
diese Bestellung zeitlich **nach** dem Stand der Sicherung, dann verschwindet sie mit
der Wiederherstellung, und **niemand merkt es** — weder Server noch Gerät wissen noch
davon. Eine Wiederherstellung ist eine Rückwärtsbewegung in der Zeit; das ist ihr Wesen
und kein Fehler, den man abfangen kann.

Daraus folgen drei verbindliche Regeln:

1. Vor jeder Wiederherstellung im laufenden Fest entsteht eine
   `PRE_RESTORE`-Sicherung, die **strukturgeprüft** sein muss (Abschnitt 7). Sie ist
   der einzige Weg zurück zu den Daten, die gleich verschwinden.
2. Der Bestätigungsdialog enthält eine Prüfliste, die der Administrator abhaken muss,
   darunter ausdrücklich: **„Alle Kassen sind online und ihre Warteschlangen sind
   leer."** Die Anwendung kann das nicht überprüfen — die Warteschlangen liegen in
   IndexedDB auf fremden Geräten (`offline-warteschlange.md`, Abschnitt 9: „Keine
   Warteschlange über Geräte hinweg"). Was sie nicht prüfen kann, muss sie benennen.
3. Der Auditeintrag der Wiederherstellung hält fest: Dateiname, Prüfsumme,
   Zeitstempel der Sicherung, Anzahl offener Kassensitzungen zum Zeitpunkt der
   Wiederherstellung und die Bestätigungen der Prüfliste.

## 7. Ablauf einer Wiederherstellung

### Vorprüfungen, alle vor der ersten Datenänderung

1. Rolle ist `ADMINISTRATOR` (Guard, wie heute `backup.controller.ts:58`).
2. Wartungsmodus ist `LOCKED`. Sonst `409` mit dem Hinweis, ihn zuerst zu setzen.
3. Der Administrator hat den **Zeitstempel der Sicherung** wörtlich eingetippt
   (die „exakte Bestätigung" des Issues). Nicht den Dateinamen: den kann man aus der
   Liste kopieren, ohne hinzusehen.
4. Manifest ist lesbar, `kind` und `manifestVersion` passen.
5. `dumpSha256` stimmt mit der neu berechneten Prüfsumme überein.
6. `pg_restore --list` läuft auf der Datei fehlerfrei durch. Das erkennt abgeschnittene
   und verfälschte Dumps, **ohne** eine Anweisung auszuführen.
7. Schemakompatibilität nach der Tabelle in Abschnitt 4.
8. Freier Speicher ist mindestens das Doppelte der entpackten Dumpgröße plus die
   Rücklage aus Abschnitt 8 — die Nebendatenbank liegt neben der bestehenden.

Schlägt einer dieser Punkte fehl, endet der Vorgang mit einer deutschen Meldung, einem
Auditeintrag `RESTORE_REJECTED` und **ohne jede Änderung**.

### Der Ablauf

```
 1. PRE_RESTORE-Sicherung erstellen und strukturprüfen.
    Scheitert sie → Abbruch. Ohne Rückweg wird nicht gegangen.
 2. Nebendatenbank vereinorder_restore_<zeitstempel> anlegen.
 3. pg_restore --single-transaction --exit-on-error --no-owner --no-privileges
    in die Nebendatenbank.
 4. Falls die Sicherung älter ist (Abschnitt 4): prisma migrate deploy
    auf der Nebendatenbank, danach prisma migrate status.
 5. Zahlen der Nebendatenbank gegen die Klammer aus dem Manifest prüfen
    (Abschnitt 2). Abweichung → Abbruch, Nebendatenbank verwerfen.
 6. Prisma-Verbindungspool trennen; verbleibende Sitzungen auf der
    Festbetriebsdatenbank mit pg_terminate_backend beenden.
 7. ALTER DATABASE vereinorder            RENAME TO vereinorder_pre_<zeitstempel>;
    ALTER DATABASE vereinorder_restore_.. RENAME TO vereinorder;
 8. Prozess neu starten (restart: always trägt ihn wieder hoch), Wartungsmodus
    bleibt LOCKED.
 9. Auditeintrag RESTORE_COMPLETED schreiben — jetzt, in der neuen Datenbank,
    außerhalb jeder Wiederherstellungstransaktion.
10. Der Administrator prüft und beendet den Wartungsmodus von Hand.
```

**Schritt 3 ist der Kern des Entwurfs.** Die Wiederherstellung wird in einer Kopie
bewiesen, bevor die Festbetriebsdatenbank auch nur angefasst wird. Scheitert sie auf
halbem Weg — abgeschnittener Dump, verletzter Fremdschlüssel, voller Speicher, getöteter
Prozess —, dann ist die Festbetriebsdatenbank **unverändert**. Es gibt keinen Zustand
„halb wiederhergestellt".

**Schritt 7 statt `pg_restore --clean` auf die laufende Datenbank.** Zwei Umbenennungen
sind nahezu augenblicklich, und die Rückfallebene ist eine dritte Umbenennung — nicht
eine zweite Wiederherstellung mit demselben Werkzeug, das gerade versagt hat. Der Preis:
alle Verbindungen müssen weg (Schritt 6), und das Backend startet neu (Schritt 8). Auf
einem Pi mit `restart: always` kostet das rund zwanzig Sekunden und ist im
Wartungsmodus ohnehin unsichtbar.

### Die Rückfallebene, und wer sie bedient

Die Frage der Projektleitung — wer stellt die Sicherheitssicherung wieder her, wenn die
Wiederherstellung selbst das versagende Werkzeug ist — hat drei gestaffelte Antworten:

1. **Bis Schritt 6 gibt es nichts wiederherzustellen.** Die Festbetriebsdatenbank ist
   unangetastet. Das ist der Grund für die Nebendatenbank.
2. **Nach Schritt 7 ist die Rückfallebene eine Umbenennung**,
   `vereinorder_pre_<zeitstempel>` zurück nach `vereinorder`. Kein Dump, kein
   `pg_restore`, keine Anwendungslogik. Die Administration bietet das als
   **„Wiederherstellung rückgängig machen"** an, solange
   `vereinorder_pre_<zeitstempel>` existiert.
3. **Wenn die Anwendung selbst nicht mehr läuft**, gilt die Invariante:

   > **Der letzte Rückweg darf niemals die Anwendung voraussetzen.**

   Dafür wird `infrastructure/scripts/restore.sh` neu geschrieben. Es braucht nur
   `psql`, `pg_restore`, den Dump und das Manifest — kein Backend, kein Node, kein
   Prisma. Es prüft dieselbe Prüfsumme, macht dieselbe `pg_restore --list`-Vorprüfung,
   verlangt dieselbe wörtliche Bestätigung und legt dieselbe Nebendatenbank an. Es ist
   der dokumentierte Weg für „das Gerät ist neu und ich habe nur die Datei", und es ist
   der Weg, den `../ops/backup-recovery.md` künftig beschreibt (heute beschreibt es
   einen, den es nicht gibt — B18).

   `backup.sh` und `restore.sh` werden dabei auf `${POSTGRES_DB}` statt auf das fest
   verdrahtete `VereinOrder_test` umgestellt (B17).

### Aufräumen

`vereinorder_pre_<zeitstempel>` bleibt stehen, bis der Administrator den Wartungsmodus
beendet **und** ausdrücklich bestätigt, dass die Wiederherstellung in Ordnung ist. Erst
dann wird sie verworfen. Bis dahin belegt sie Platz — das ist gewollt: die
Vorprüfung in Schritt 8 rechnet damit.

## 8. Anmeldedaten in der Sicherung

Der Widerspruch: `pinHash` gehört in eine vollständige Sicherung, sonst ist es keine.
Aber die Datei geht auf einen USB-Stick.

Es sind bcrypt-Hashes mit Kostenfaktor 10 (`users.service.ts:25-26`) über vierstellige
PINs (`packages/database/prisma/seed.ts`, `docs/development/testing.md`: „Test-PIN
`1234`"). Der Suchraum ist 10 000. Bei rund hundert Millisekunden je Versuch ist eine
PIN in etwa einer Viertelstunde gefunden — je Benutzer, auf einem gewöhnlichen Laptop,
ohne Netz. **Die Datei enthält damit faktisch die Klartext-PINs aller Benutzer.** Sie
als „nur Hashes" zu bezeichnen wäre eine Beschönigung.

Es gibt genau zwei ehrliche Auflösungen des Widerspruchs — ein Geheimnis, das ein Mensch
behält, oder das Entfernen der Anmeldedaten. Alles andere ist Theater.

**Entscheidung:**

1. **Der vollständige Dump verlässt das Gerät nicht über die Weboberfläche.**
   `GET /backup/download/:filename` in der heutigen Form entfällt.
2. An seine Stelle tritt `POST /backup/:name/export` mit zwei Ausprägungen, deren Wahl
   auditiert wird:

   | Ausprägung          | Inhalt                                                                                    | Folge für „Gerät kaputt, nur die Datei"                                                                    |
   | ------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
   | `OHNE_ANMELDEDATEN` | vollständiger Dump, `User.pinHash` ersetzt                                                | Geld, Bestellungen, Bons, Auditspur samt Urhebern kommen zurück. **Alle PINs müssen neu vergeben werden.** |
   | `VERSCHLÜSSELT`     | vollständiger Dump in AES-256-GCM, Schlüssel per scrypt aus einer eingetippten Passphrase | Alles kommt zurück. **Ohne die Passphrase ist die Datei wertlos.**                                         |

3. **Voreinstellung ist `OHNE_ANMELDEDATEN`.** Begründung: In einem Verein geht eine
   Passphrase verloren. Eine Sicherung, die man nicht öffnen kann, ist keine Sicherung.
   Neue PINs zu vergeben kostet zehn Minuten; die Zahlen eines Festes zu verlieren
   kostet das Fest. Die verschlüsselte Ausprägung bleibt für den Fall, dass jemand die
   Auditspur vollständig und übertragbar braucht.
4. Die redigierte Ausprägung wird erzeugt, indem der Dump in eine Nebendatenbank
   eingespielt, dort `User.pinHash` auf einen nicht vergleichbaren Markierungswert
   gesetzt und daraus neu gedumpt wird. `pinHash` ist `NOT NULL`
   (`schema.prisma:22`), deshalb ein Markierungswert und kein Leerwert. Der Weg ist
   derselbe wie bei der Übernahme in Abschnitt 5 und beim Nachweis in Abschnitt 10 —
   eine Mechanik, drei Verwendungen.
5. Das Manifest des Exports trägt `redacted: true`. Beim Einspielen einer redigierten
   Sicherung erkennt die Anwendung den Markierungswert und **bleibt im
   Wartungsmodus**, mit einer unübersehbaren Anzeige, dass sich niemand anmelden kann,
   bis PINs vergeben wurden.

Der Weg, wie PINs auf einem frisch aufgesetzten Gerät ohne anmeldefähigen Benutzer
vergeben werden, ist **offener Punkt 4** in Abschnitt 12. Zwischenlösung, die nichts
kostet und in `../ops/backup-recovery.md` dokumentiert wird: wer den Dump einspielen
kann, hat ohnehin Schalenzugriff auf das Gerät und setzt den Hash mit einer
`UPDATE`-Anweisung. Physischer Zugriff ist auf einem Festzelt-Pi ohnehin die oberste
Berechtigung.

Nebenbei behoben: `Content-Disposition` wird aus dem geprüften Namen gesetzt, nicht aus
dem rohen Adressparameter (B21).

## 9. Aufbewahrung und Rotation

Konfigurierbar über Umgebungsvariablen, ergänzt in `.env.example`:

| Variable                       | Vorgabe      | Bedeutung                                            |
| ------------------------------ | ------------ | ---------------------------------------------------- |
| `BACKUP_RETENTION_HOURLY_KEEP` | `24`         | wie viele stündliche Sicherungen behalten werden     |
| `BACKUP_RETENTION_DAILY_KEEP`  | `14`         | wie viele Tagesletzte darüber hinaus behalten werden |
| `BACKUP_RETENTION_EVENT_KEEP`  | `3`          | `PRE_RESTORE`/`PRE_MIGRATION`, jüngste je Art        |
| `BACKUP_MIN_FREE_BYTES`        | `1073741824` | Rücklage; darunter wird nicht mehr gesichert         |

### Was „verifiziert" heißt

Der Begriff wird zweistufig festgelegt, weil das Issue ihn zur Bedingung einer
Löschsperre macht und ein unscharfer Begriff dort nichts trägt.

| Stufe                       | Prüfung                                                                                                             | Wann                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `STRUKTURGEPRÜFT`           | Manifest lesbar und passend, `dumpSha256` stimmt, `pg_restore --list` läuft fehlerfrei, `schemaFingerprint` gesetzt | unmittelbar nach **jeder** Sicherung, Sekunden |
| `WIEDERHERSTELLUNGSGEPRÜFT` | zusätzlich: in eine leere Nebendatenbank eingespielt, Klammer aus Abschnitt 2 eingehalten, Fremdschlüssel bestanden | auf Knopfdruck, vor Festbeginn, und in der CI  |

Das Ergebnis samt Zeitpunkt steht im Feld `verification` des Manifests und wird in der
Administration je Zeile angezeigt. Eine Sicherung, deren Strukturprüfung fehlschlägt,
wird als **defekt** geführt, nicht stillschweigend übergangen wie heute
(`backup.service.ts:200-202`, leerer `catch`).

### Rotationsregeln

Die Rotation läuft nach jeder erfolgreichen und strukturgeprüften Sicherung.

Niemals gelöscht werden:

1. die jüngste `STRUKTURGEPRÜFT`e Sicherung,
2. die jüngste `WIEDERHERSTELLUNGSGEPRÜFT`e Sicherung,
3. jede `PRE_RESTORE`- und `PRE_MIGRATION`-Sicherung innerhalb von
   `BACKUP_RETENTION_EVENT_KEEP`,
4. jede Sicherung, die ein Administrator ausdrücklich angeheftet hat.

Ist 1 zugleich 2, sind es weniger Dateien — die Regel ist eine Untergrenze, keine
Vorgabe.

**Unterschreitet der freie Speicher `BACKUP_MIN_FREE_BYTES`, wird keine neue Sicherung
mehr erstellt und eine `ERROR`-Empfehlung in der Diagnose ausgegeben.** Es wird
ausdrücklich **nicht** eine geschützte Datei gelöscht, um Platz zu schaffen. Das
Sicherungsnetz zu zerschneiden, damit ein noch ungeprüftes neues Netz hineinpasst, ist
der falsche Tausch.

### Diagnose

`DiagnosticsService.getStatus` bekommt (B16):

- freien und gesamten Speicher im `BACKUP_DIR` über `fs.statfs`,
- Anzahl und Gesamtgröße der Sicherungen,
- die jüngste Sicherung je Prüfstufe mit Zeitpunkt,
- Prüfstand des Werkzeugvergleichs `pg_dump` ↔ Server (Abschnitt 11).

Und `listBackups` liest nicht mehr bei jedem Aufruf alle Dateien (B12).

## 10. Der zeitgesteuerte Lauf

**Entscheidung: `@Cron` aus `@nestjs/schedule`, an der Uhr, ohne Statusbedingung.**

- **Bauweise.** `@Cron("5 * * * *")` statt `setInterval`. Gründe: `ScheduleModule` ist
  bereits registriert (`app.module.ts:23`), `print-jobs.reaper.ts:30` macht es genauso,
  der Handle wird beim Herunterfahren abgeräumt, und die Methode ist im Test direkt
  aufrufbar, ohne Zeitgeber zu verstellen. Die Minute 5 statt 0 hält den Lauf von
  anderen Stundenwechseln fern.
- **An der Uhr statt am Prozessstart.** Behebt B14: ein Gerät, das häufiger neu
  startet als stündlich, sichert heute nie. Zusätzlich läuft eine Sicherung
  **einmalig 90 Sekunden nach dem Start**, wenn die jüngste Sicherung älter als eine
  Stunde ist. Ein Neustart nach einem Stromausfall ist genau der Zeitpunkt, an dem man
  eine Sicherung haben will.
- **Ohne Statusbedingung.** Die heutige Bedingung `status: "ACTIVE"` (`:41-43`) ist aus
  zwei Gründen die falsche Form:

  1. Die Sicherung ist **datenbankweit**. Ob irgendeine Veranstaltung gerade aktiv ist,
     sagt nichts darüber, ob die Datenbank sicherungswürdige Daten enthält. Ein
     `TEST_MODE`-Fest ist eine Generalprobe, deren Verlust die Generalprobe kostet; die
     Sortimentsarbeit der Wochen vor dem Fest ist ganz ungesichert.
  2. Sie hat einen Zustand hergestellt, in dem außerhalb von Festen **überhaupt nicht**
     gesichert wird — und das ist genau die Zeit, in der die Ereignisvorlagen aus #53
     und die Produktpflege entstehen.

  Eine stündliche Sicherung eines ruhenden Systems kostet einen Dump von wenigen
  hundert Kilobyte. Die Aufbewahrung aus Abschnitt 9 fängt die Menge ab. Die
  Ersparnis der Bedingung ist eingebildet, ihr Schaden gemessen.

- Im Wartungsmodus setzt der Lauf aus.
- Der Auslöser ist `SCHEDULE`, `createdBy` ist `null` — kein `"SYSTEM_CRON"` in einem
  Feld für Benutzerkennungen (B22).

**Sicherung vor Migration.** Es gibt heute keinen Aufhänger dafür (B20). Vorgeschlagen
wird `scripts/ops/upgrade.sh`: Wartungsmodus setzen → Sicherung mit
`trigger: PRE_MIGRATION` → strukturprüfen → `prisma migrate deploy` →
`prisma migrate status` → Wartungsmodus lösen. Das Skript wird der in
`../ops/raspberry-pi-setup.md` dokumentierte Weg für ein Update. Ob es Teil dieses
Vorgangs ist, ist **offener Punkt 6**.

## 11. Werkzeuge, Versionsbindung, ARM64 und AMD64

- Das Backend-Abbild (`apps/backend/Dockerfile:34`, `node:20-alpine`) installiert in der
  Laufzeitstufe `postgresql16-client`. Die Hauptversion muss zu `postgres:16-alpine`
  aus `docker-compose.yml` passen.
- **Kein `docker exec` in den Datenbankcontainer.** Dafür müsste der Docker-Socket in
  das Backend gereicht werden; das ist eine Rechteausweitung auf den ganzen Wirt und
  wird nicht gemacht. `pg_dump` und `pg_restore` sprechen über TCP mit dem Dienst
  `postgres`, mit derselben `DATABASE_URL` wie Prisma.
- **Drei Prüfungen sichern die Versionsbindung ab:**
  1. **Zur Laufzeit, bei jedem Start.** `SHOW server_version_num` gegen
     `pg_dump --version`. Bei abweichender Hauptversion wird die Sicherung
     abgeschaltet und eine `ERROR`-Empfehlung angezeigt. Eine stillschweigend kaputte
     Sicherung ist schlimmer als gar keine.
  2. **In der CI, im gebauten Abbild, auf beiden Plattformen.** Der Job `docker`
     (`.github/workflows/ci.yml:149-172`) baut heute mit `outputs: type=cacheonly`; für
     die Zeilen `component: backend` wird auf `load: true` umgestellt und ein Schritt
     ergänzt, der `docker run --rm <abbild> pg_dump --version` ausführt und die
     Hauptversion gegen die in `docker-compose.yml` festgelegte prüft. Die Matrix läuft
     bereits nativ auf `ubuntu-24.04-arm` und `ubuntu-latest` — die Zusage „ARM64 und
     AMD64 verwenden kompatible Werkzeuge" ist damit an beiden Stellen nachgewiesen und
     nicht behauptet.
  3. **Im `postgres`-Job**, der `postgresql-client` ohnehin installiert
     (`ci.yml:82-83`): dieselbe Hauptversionsprüfung, bevor die Sicherungstests laufen.
- Das Alpine-Paket wird mit fester Version installiert. Zieht ein späteres
  `node:20-alpine` eine Alpine-Fassung nach, in der `postgresql16-client` fehlt, bricht
  der Docker-Bau — laut und früh, was hier das gewünschte Verhalten ist.

## 12. Nachweis der Wiederherstellung

Das ist die wichtigste Zusage des Vorgangs, und ausgerechnet sie kann eine gemockte
Prüfung strukturell nicht halten.

### Die Lehre aus B1

`backup.service.spec.ts` baut eine Prisma-Attrappe aus `jest.fn()`
(`backup.service.spec.ts:6-53`). `auditLog.create` ist dort
`jest.fn().mockResolvedValue({ count: 0 })` — eine Funktion, die alles annimmt.
Fremdschlüssel gibt es in einer Attrappe nicht. Der Test bestätigt seit Wochen eine
Wiederherstellung, die in Wirklichkeit in der ersten Anweisung mit `P2003` abbricht.

**Regel für diesen Vorgang: Zusagen über Datenbankverhalten werden ausschließlich gegen
eine echte PostgreSQL-Instanz geprüft.** In der Attrappe verbleibt, was reine Logik
ist — die Auffangkategorie aus #84 gehört als Einheitentest zu
`apps/backend/src/common/fallback-category.ts`, nicht als Wiederherstellungstest.

### Neuer Integrationstest

`apps/backend/test/backup-restore.integration-spec.ts`, im bestehenden Lauf
`pnpm test:integration` (`jest-integration.json`, `testRegex: test/.*\.integration-spec\.ts$`),
abgesichert durch `assertTestDatabaseUrl` (`test/test-database.ts`) wie
`database.integration-spec.ts:7`.

Ablauf, gegen `vereinorder_integration_test`:

1. Einen bekannten Festbestand anlegen: zwei Veranstaltungen, eine in `LIVE`, eine in
   `TEST`; Bereiche, Stationen, Kategorien, Produkte mit Auswahlgruppen; Benutzer aller
   Rollen; Kassensitzungen; Bestellungen mit Positionen, Zahlungen in allen
   Zahlungsarten, Produktbons, vergebenen Abholnummern samt gefülltem
   `EventPickupCounter`; Auditzeilen **mit** Urheber; Druckaufträge;
   `ConfigOperation`-Zeilen.
2. Sichern. Manifest prüfen.
3. In eine **leere** Nebendatenbank wiederherstellen.
4. Vergleichen:
   - Zeilenzahl je Tabelle gegen die Klammer aus Abschnitt 2 — hier ohne Last, also
     Gleichheit.
   - `SUM("totalAmount")` über `Order` je `dataMode`.
   - `SUM("amount")` über `Payment` je `dataMode` und `PaymentMethod`.
   - `COUNT` über `ProductVoucher` je Status.
   - `COUNT` über `AuditLog` **und** `COUNT(*) WHERE "userId" IS NOT NULL`. Der zweite
     Wert ist der Wächter gegen B7.
   - `EventPickupCounter."lastNumber"` ist je `(eventId, dataMode)` gleich
     `MAX("pickupNumber")` der Bestellungen. Wächter gegen #100.
   - Für jede Sequenz: `last_value` ist größer oder gleich dem `MAX` ihrer Spalte,
     namentlich `Order_orderNumber_seq`. Wächter gegen B6.
   - Fremdschlüssel: der fehlerfreie Durchlauf von
     `pg_restore --single-transaction --exit-on-error` **ist** der Nachweis, weil ein
     Fremdschlüssel beim Anlegen validiert wird. Zusätzlich eine Abfrage über
     `pg_constraint`, die belegt, dass jede Bedingung des Schemas in der
     wiederhergestellten Datenbank vorhanden **und** validiert ist — ein Restore, der
     Bedingungen weggelassen hätte, fiele sonst nicht auf.
5. Weiterarbeiten: einen Stationsverkauf auf der wiederhergestellten Datenbank
   durchführen. Er muss die nächsthöhere Abholnummer liefern und darf nicht am
   Eindeutigkeitsindex `Order_eventId_dataMode_pickupNumber_key` scheitern. Das ist
   wörtlich das Akzeptanzkriterium aus #100.

### Fehlerfälle, je ein eigener Test

Abgeschnittener Dump; verfälschte Prüfsumme; unbekannte `manifestVersion`; fremder
`schemaFingerprint`; Sicherung neuer als das Schema; zu wenig freier Speicher;
abgebrochener Kindprozess (`SIGKILL` auf `pg_restore`); falsche Rolle; Wartungsmodus
nicht gesetzt; laufendes Fest ohne Wartungsmodus. In **jedem** dieser Fälle lautet die
Zusage gleich: die Festbetriebsdatenbank ist danach unverändert.

### Skript nach dem Vorbild von `test-migrations.mjs`

`scripts/ci/test-backup-restore.mjs`, gebaut wie `scripts/ci/test-migrations.mjs`:
`MIGRATION_TEST_ADMIN_URL` für die Verwaltungsverbindung, `recreateDatabase`/
`dropDatabase` (`test-migrations.mjs:212-229`, `:816-825`), `ON_ERROR_STOP=1`, alles in
einem `try`/`finally`, das die Datenbanken sicher verwirft. Es erzeugt und löscht
ausschließlich `vereinorder_ci_test_backup_source` und
`vereinorder_ci_test_backup_target` — beide Namen erfüllen die Prüfung in
`test-database.ts:22`.

Zusätzlich prüft es den Weg aus Abschnitt 4: Sicherung auf dem vorletzten
Migrationsstand ziehen, in eine leere Datenbank einspielen, `prisma migrate deploy`,
`prisma migrate status`, fachlich prüfen. Das ist derselbe Ablauf, den
`test-migrations.mjs` bereits beherrscht, nur mit einem Dump als Quelle.

### Einbau in die CI

Im Job `postgres` (`ci.yml:49-91`), nach `pnpm test:integration`:

```yaml
- name: PostgreSQL-Werkzeugversion prüfen
  run: pnpm test:pg-tools
- name: Sicherung und Wiederherstellung
  run: pnpm test:backup-restore
```

Im Job `docker`, für `component: backend`, die Werkzeugprüfung im gebauten Abbild
(Abschnitt 11).

**Nicht in die CI gehört der ARM64-Probelauf auf echter Hardware.** Er bleibt eine
Handprüfung auf dem Pi und wird in `../ops/backup-recovery.md` als Prüfliste geführt:
sichern, wiederherstellen, Neustart, Kasse bedienen.

## 13. Was dieser Schnitt nicht löst

- **Sicherung an einen anderen Ort.** Kein Netzlaufwerk, keine Cloud, keine
  automatische Kopie auf einen angesteckten USB-Stick. Der Export bleibt eine
  ausdrückliche Handlung eines Menschen. Das ist Nicht-Ziel des Issues.
- **Wiederherstellung einzelner Veranstaltungen oder Tabellen.** Ein Dump kann das
  technisch; der Weg dorthin ist aber ein anderer Vorgang mit eigener fachlicher
  Prüfung (was passiert mit Bestellungen, die auf gelöschte Stationen zeigen?).
- **Konfigurationsimporte aus #53.** Sie bleiben getrennt und unverändert
  (`events.controller.ts:71` und `:77`). Sie sind ungefährlich, weil sie nichts löschen;
  ein Vollbackup ist gefährlich, weil es alles löscht. Die beiden Wege werden nicht
  zusammengelegt.
- **Punktgenaue Wiederherstellung (PITR) über WAL-Archivierung.** Wäre der nächste
  Ausbau und würde den Datenverlust zwischen zwei stündlichen Sicherungen von bis zu
  einer Stunde auf Sekunden senken. Braucht dauerhaften WAL-Speicher auf der SD-Karte
  und eine eigene Betriebsanleitung. Eigener Vorgang.
- **Automatische Auflösung der Warteschlangenkonflikte nach einer Wiederherstellung.**
  Abschnitt 6 beschreibt, warum sie von Hand aufzulösen sind.
- **B17, B18, B19, B20** werden im Rahmen dieses Vorgangs mitkorrigiert, soweit sie die
  Sicherungswege betreffen. Das zweite Compose-Bündel
  `infrastructure/docker-compose.yml` wird **nicht** repariert, sondern zur Löschung
  vorgeschlagen — siehe offener Punkt 5.

## 14. Weitere Bestandsfehler

Gefunden beim Nachsehen, in diesem Vorgang **nicht** behoben, sofern nicht oben anders
vermerkt.

| Fundstelle                                               | Befund                                                                                                                                                                              |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/database/prisma/schema.prisma:322`             | `Order.orderNumber` ist `SERIAL` **ohne** `@unique`. Doppelte Bestellnummern sind auf Datenbankebene erlaubt. Unabhängig von der Sicherung ein Datenmodellfehler (B6).              |
| `apps/backend/src/backup/backup.service.ts:239`          | `$transaction` ohne `timeout`; Voreinstellung 5 s reicht für eine Wiederherstellung nicht (B9).                                                                                     |
| `apps/backend/src/backup/backup.service.ts:200-202`      | Leerer `catch`: eine defekte Sicherungsdatei verschwindet stillschweigend aus der Liste, statt als defekt gemeldet zu werden.                                                       |
| `apps/backend/src/backup/backup.service.ts:224-225`      | `readFileSync` und `JSON.parse` ohne Fehlerbehandlung. Eine kaputte Datei liefert einen `SyntaxError` als 500 statt einer fachlichen Ablehnung.                                     |
| `apps/backend/src/backup/backup.service.ts:36-53`        | `setInterval` ohne `onModuleDestroy`; hält in Tests den Prozess offen und weicht von `print-jobs.reaper.ts:30` ab (B14).                                                            |
| `apps/backend/src/backup/backup.controller.ts:42`, `:48` | `Content-Disposition` aus dem ungeprüften Adressparameter (B21).                                                                                                                    |
| `apps/backend/src/diagnostics/diagnostics.service.ts:85` | `listBackups()` bei jedem Diagnoseabruf; liest und hasht den gesamten Sicherungsbestand (B12).                                                                                      |
| `apps/frontend/src/pages/AdminDashboard.tsx:2244`        | Spalte „Integrität (SHA256)" zeigt eine beim Auflisten neu berechnete Prüfsumme. Sie kann nie abweichen und sagt nichts aus (B11).                                                  |
| `apps/frontend/src/pages/AdminDashboard.tsx:1064-1080`   | Die Wiederherstellung wird mit einem einzelnen `confirm()` ausgelöst, ohne Eingabe einer Bestätigung, ohne Anzeige des Sicherungszeitpunkts und ohne Warnung über offene Sitzungen. |
| `scripts/ci/check-repository-hygiene.mjs:17`             | Das Muster endet auf `$` und greift deshalb bei `.sql.gz` nicht — also genau bei den Dateien, die `infrastructure/scripts/backup.sh:7` erzeugt (B19).                               |
| `.gitignore` (letzte zwei Zeilen)                        | Nur `apps/backend/backups/*` ist ignoriert. Ein `backups/`-Verzeichnis im Wurzelverzeichnis, das `backup.sh:5` als Vorgabe nahelegt, ist nicht ignoriert (B19).                     |
| `infrastructure/scripts/backup.sh:14`, `:16`             | Fest verdrahtete Datenbank `VereinOrder_test` statt `${POSTGRES_DB}` (B17).                                                                                                         |
| `infrastructure/scripts/restore.sh:28`, `:30`            | Dieselbe fest verdrahtete Datenbank; das Skript überschreibt im Ernstfall die falsche (B17).                                                                                        |
| `infrastructure/docker-compose.yml:1-21`                 | Zweites, veraltetes Compose-Bündel mit demselben Containernamen `vereinorder_postgres` wie `docker-compose.yml`. Zwei Bündel, die um denselben Namen streiten (B17).                |
| `docs/ops/backup-recovery.md:35`                         | Weist auf `restore.sh` mit einer `.sql.gz`-Datei hin, die kein Weg im System erzeugt (B18).                                                                                         |
| `docs/ops/raspberry-pi-setup.md`, gesamtes Dokument      | Beschreibt die Inbetriebnahme ohne einen einzigen Migrationsschritt. Nichts im Festbetrieb ruft `prisma migrate deploy` auf (B20).                                                  |
| `apps/backend/src/backup/backup.service.ts:98`           | `version: "0.1.0"` ist fest verdrahtet und nicht die Anwendungsversion aus `package.json`. Eine Kompatibilitätsprüfung darauf wäre wertlos.                                         |

## 15. Offene Punkte für die Projektleitung

1. **Wird ohne Statusbedingung gesichert?** Dieser Entwurf empfiehlt, stündlich zu
   sichern, unabhängig davon, ob eine Veranstaltung `ACTIVE` ist (Abschnitt 10). Folge
   der Alternative — die heutige Bedingung beibehalten: Sortimentspflege,
   Ereignisvorlagen und Generalproben bleiben ungesichert, und ein
   `TEST_MODE`-Wochenende ist bei einem Kartenschaden verloren. Der Preis der
   Empfehlung sind einige hundert Kilobyte je Stunde, abgefangen durch die
   Aufbewahrung.

2. **Umbenennen oder `pg_restore --clean`?** Empfehlung: umbenennen (Abschnitt 7,
   Schritt 7), weil die Rückfallebene dann eine dritte Umbenennung ist und nicht eine
   zweite Wiederherstellung mit dem Werkzeug, das gerade versagt hat. Preis: alle
   Datenbankverbindungen müssen weg, das Backend startet neu, rund zwanzig Sekunden im
   ohnehin geschlossenen Wartungsmodus. Folge der Alternative: `--clean` schreibt
   direkt in die Festbetriebsdatenbank; scheitert es auf halbem Weg, ist der Zustand
   „teilweise gelöscht, teilweise wiederhergestellt", und der Rückweg ist ein zweiter
   vollständiger Restore.

3. **Redigierter oder verschlüsselter Export als Voreinstellung?** Empfehlung:
   redigiert, ohne Anmeldedaten (Abschnitt 8). Folge der Alternative — verschlüsselt als
   Voreinstellung: eine verlorene Passphrase macht die Sicherung wertlos, und in einem
   Verein geht sie verloren. Folge der Empfehlung: nach einer Wiederherstellung von
   einem fremden Gerät müssen alle PINs neu vergeben werden.

4. **Wie werden PINs auf einem Gerät ohne anmeldefähigen Benutzer vergeben?** Der
   Entwurf schlägt einen einmaligen Einrichtungszustand vor, freigeschaltet über eine
   Kennung, die nur im Containerprotokoll steht — also nur mit physischem Zugriff
   erreichbar. Empfehlung: **eigener Vorgang**, weil er einen neuen
   Authentifizierungsweg einführt und dieser Vorgang ohnehin groß ist. Zwischenlösung
   ohne Bauaufwand: `UPDATE "User" SET "pinHash" = …` über `psql`, dokumentiert in der
   Betriebsanleitung. Folge der Alternative — den Einrichtungszustand hier mitbauen:
   der Vorgang wächst um einen sicherheitsrelevanten Weg, den niemand isoliert prüfen
   kann.

5. **Wird `infrastructure/docker-compose.yml` gelöscht?** Empfehlung: ja. Es ist ein
   zweites Bündel mit veralteter Datenbank und demselben Containernamen wie das Bündel
   im Wurzelverzeichnis; wer es versehentlich startet, blockiert den Festbetrieb.
   Folge der Alternative — behalten und pflegen: zwei Betriebsbeschreibungen, die
   auseinanderlaufen, und genau diese Fehlerklasse hat uns die Befunde B17 und B18
   eingebracht.

6. **Gehört `scripts/ops/upgrade.sh` in diesen Vorgang?** Das Issue verlangt „Sicherung
   vor Migration/Update", und es gibt heute keinen Aufhänger dafür (B20). Empfehlung:
   ja, aber schlank — Wartungsmodus, Sicherung, `migrate deploy`, `migrate status`,
   Wartungsmodus lösen. Folge der Alternative — auslassen: die Zusage „Sicherung vor
   Migration" bleibt unerfüllt, weil es keinen Zeitpunkt gibt, an dem sie greifen
   könnte, und die Pi-Anleitung beschreibt weiterhin ein Update ohne Migration.

7. **Sperrt eine Wiederherstellung offene Kassensitzungen?** Empfehlung: nein,
   nur warnen und zählen (Abschnitt 6). Folge der Alternative — Wiederherstellung bei
   offener Sitzung verweigern: der Administrator muss mitten in einer Störung erst
   sämtliche Kassen abschließen lassen, und genau in einer Störung ist das oft nicht
   möglich. Die Warnung im Bestätigungsdialog trägt die Verantwortung dorthin, wo sie
   entschieden werden kann.

8. **Wie lange bleibt `vereinorder_pre_<zeitstempel>` stehen?** Empfehlung: bis der
   Administrator den Wartungsmodus beendet und die Wiederherstellung ausdrücklich
   abnimmt. Zu bestätigen ist, ob es zusätzlich eine Höchstdauer geben soll, nach der
   sie ohne Abnahme verworfen wird — dafür spricht der Platz auf der Karte, dagegen,
   dass genau diese Datenbank der schnellste Rückweg ist.

## 16. Zuschnitt der Umsetzung

**Vorgezogen und getrennt behoben: B1, B7 und B9 — die Wiederherstellung, wie sie heute
ist.**

Begründung: Die Wiederherstellung bricht heute in der ersten Anweisung ab (B1). Selbst
wenn sie liefe, ginge jeder Auditurheber verloren (B7) und die Transaktion liefe in ihr
Zeitlimit (B9). Das ist kein Verbesserungsbedarf, sondern ein Werkzeug, das nicht
funktioniert und von dem die Betriebsanleitung behauptet, es funktioniere
(`../ops/backup-recovery.md`, Abschnitt 3). Ein Verein, der sich im Fest darauf
verlässt, steht ohne Rückweg da. Das wartet nicht auf ein großes Vorhaben.

Der vorgezogene Schnitt umfasst genau:

- den Aufruf in `backup.service.ts:234` auf einen richtigen Parameter bringen,
- den Auditeintrag der Wiederherstellung **außerhalb** der Transaktion und nach dem
  Anlegen der Benutzer schreiben (B8),
- `auditLog` einspielen und die genullten Urheber wiederherstellen (B3, B7),
- ein ausreichendes `timeout` an `$transaction` (B9),
- `productVoucher` einspielen und `EventPickupCounter` ableiten (#100),
- die Sequenzen nachsetzen (B6),
- **und einen Integrationstest gegen eine echte PostgreSQL-Instanz**, der das belegt.
  Ohne ihn wäre die Korrektur genau so viel wert wie der heutige Attrappentest.

Dieser Schnitt ist zugleich die Voraussetzung für den Übernahmeweg aus Abschnitt 5 —
der JSON-Code muss einmal richtig laufen, bevor er in Rente geht.

**Danach, in dieser Reihenfolge, innerhalb von #67:**

1. **Wartungsmodus** (Abschnitt 6). Zuerst, weil alles Weitere ihn voraussetzt und weil
   er allein schon Wert hat: eine Möglichkeit, das System sauber stillzulegen, fehlt
   heute vollständig.
2. **Sicherung im neuen Format** (Abschnitte 2, 3, 4, 10, 11) samt Werkzeugbindung und
   Diagnose. Ab hier entstehen brauchbare Sicherungen, auch ohne dass die
   Wiederherstellung schon umgestellt ist.
3. **Wiederherstellung über Nebendatenbank und Umbenennung** (Abschnitt 7), samt
   neuem `restore.sh`.
4. **Aufbewahrung, Rotation, Speicherdiagnose** (Abschnitt 9).
5. **Export und Anmeldedaten** (Abschnitt 8).
6. **Übernahme der JSON-Altbestände** (Abschnitt 5). Zuletzt, weil sie den geringsten
   Wert hat: eine JSON-Datei, die älter ist als der Formatwechsel, ist im Fest ohnehin
   kaum noch brauchbar.

**Umsetzungsstand des zweiten Schnitts:** Native Sicherungen werden als atomar
veröffentlichtes Paar aus PostgreSQL-Custom-Dump und streng geprüftem Manifest erzeugt.
Der Lauf ermittelt Tabellen und Migrationen dynamisch, misst Zähl- und Geldsummen vor
und nach dem Dump, prüft SHA-256 sowie `pg_restore --list` und bindet die
Werkzeug-Hauptversion an den Server. Planung, Diagnose, sichere Dateipfade und die
ehrliche Anzeige in der Administration gehören dazu. Native Wiederherstellung,
Rotation/Speichergrenzen, redigierter Export und JSON-Übernahme bleiben ausdrücklich
den folgenden Schnitten 3 bis 6 vorbehalten. Der Übergangsweg für JSON-Dateien verlangt
bereits vor jedem Dateizugriff den Wartungszustand `LOCKED`.

**Als eigene Vorgänge herausgelöst:**

- **Der Einrichtungszustand für PINs nach einer redigierten Wiederherstellung**
  (offener Punkt 4). Er führt einen neuen Authentifizierungsweg ein. Ein
  sicherheitsrelevanter Weg gehört nicht als Anhängsel in ein großes Vorhaben — dieselbe
  Begründung, mit der `offline-warteschlange.md`, Abschnitt 12, den Besitzprüfungsfehler
  herausgelöst hat.
- **`Order.orderNumber` ohne Eindeutigkeitsregel** (B6, Datenmodellfehler). Er wird hier
  in seiner Wirkung entschärft, weil der Dump die Sequenz mitbringt. Die fehlende
  Regel selbst ist ein Datenmodellvorgang mit eigener Migration und eigener Prüfung
  darauf, ob im Bestand bereits Doppelnummern liegen.
- **Punktgenaue Wiederherstellung über WAL-Archivierung.** Ausbau, nicht Behebung.

## 17. Entscheidungen der Projektleitung

Verbindlich. Ersetzen die Empfehlungen in Abschnitt 15.

1. **Es wird stündlich gesichert, unabhängig vom Veranstaltungsstatus.** Die Sicherung ist
   datenbankweit; ob gerade ein Fest läuft, sagt nichts darüber aus, ob die Daten
   sicherungswürdig sind. Sortimentspflege, Ereignisvorlagen und Generalproben sind heute
   überhaupt nicht gesichert, und genau das ist die Arbeit, die zwischen den Festen
   anfällt.

2. **Wiederhergestellt wird über eine Nebendatenbank mit anschließender Umbenennung**,
   nicht mit `pg_restore --clean`. Ausschlaggebend ist der Rückweg: Bei der Umbenennung
   ist er eine dritte Umbenennung, bei `--clean` ein zweiter vollständiger Restore mit
   genau dem Werkzeug, das gerade versagt hat. Der Neustart des Backends und der Verlust
   aller Verbindungen sind im geschlossenen Wartungsmodus ohnehin unsichtbar.

3. **Der Export ist redigiert, ohne `pinHash`.** Bcrypt mit Kostenfaktor 10 über eine
   vierstellige PIN sind 10 000 Möglichkeiten; die Datei enthält damit faktisch die
   Klartext-PINs des ganzen Vereins. Eine Sicherung wird herumgereicht, kopiert und
   verlegt — sie darf nichts enthalten, was bei Verlust schadet. Der Preis ist bekannt und
   wird angenommen: Nach einer Wiederherstellung auf einem fremden Gerät muss zuerst die
   PIN-Vergabe stattfinden. Eine Passphrase wurde erwogen und verworfen, weil sie in
   einem Verein verloren geht und die Sicherung dann wertlos ist — das ist der schlechtere
   Fehlerfall.

4. **Die PIN-Einrichtung auf einem Gerät ohne anmeldefähigen Benutzer wird ein eigener
   Vorgang.** Sie führt einen neuen Authentifizierungsweg ein, und ein
   sicherheitsrelevanter Weg gehört nicht als Anhängsel in ein großes Vorhaben. Bis
   dahin gilt der dokumentierte Weg über `psql`.

5. **`infrastructure/docker-compose.yml` wird gelöscht.** Zwei Betriebsbeschreibungen
   laufen auseinander, und derselbe Containername in beiden erzeugt Kollisionen, die
   niemand erklären kann. Die Skripte darunter werden auf das Wurzelbündel gezogen.

6. **`scripts/ops/upgrade.sh` gehört in diesen Vorgang**, schlank. Ohne einen Weg, der
   im Festbetrieb überhaupt migriert, ist die Zusage „Sicherung vor Migration" nicht
   erfüllbar — es fehlt schlicht der Auslöser.

7. **Offene Kassensitzungen blockieren eine Wiederherstellung nicht**, sie werden gezählt
   und deutlich gemeldet. Wer wiederherstellt, steckt bereits in einer Störung; ihn erst
   alle Kassen abschließen zu lassen, ist dann oft unmöglich.

8. **Die Sicherheitsdatenbank `vereinorder_pre_<zeitstempel>` bleibt bis zur
   ausdrücklichen Abnahme durch die Administration stehen.** Keine Höchstdauer: Sie ist
   der schnellste Rückweg, und Platz ist das kleinere Problem als ein fehlender Rückweg.
   Die Rotation aus Abschnitt 9 darf sie niemals als gewöhnliche Sicherung mitzählen oder
   löschen. Der freie Speicher wird in der Diagnose ausgewiesen.

### Nachtrag zur Umgebung

Der Entwurf hält fest, `psql` und `pg_dump` seien auf dem Entwicklungsrechner nicht
vorhanden und alle Aussagen daher aus dem Quelltext abgeleitet. Das trifft nicht zu:
Beide liegen unter `C:\Program Files\PostgreSQL\18\bin` und sind dort nur nicht im
Suchpfad. Die Projektleitung hat damit gemessen. Für jede Umsetzungsstufe gilt deshalb:
**messen statt schließen.** Zugang lokal `vereinorder_admin:vereinorder_admin` auf
`127.0.0.1:5432`, ausschließlich gegen eigene Testdatenbanken; `vereinorder_dev` bleibt
unangetastet.

Zwei Befunde des Entwurfs sind von der Projektleitung nachgemessen und bestätigt:

- **Produktbons werden bei einer Wiederherstellung aktiv gelöscht**, nicht nur vergessen.
  `ProductVoucher.orderId` hängt mit `ON DELETE CASCADE` an `Order`; `order.deleteMany()`
  nimmt sie mit, und da sie in keiner Sicherungsdatei stehen, kommen sie nie zurück.
- **Die Bestellnummer wird nach einer Wiederherstellung doppelt vergeben.** Ein
  ausdrücklich geschriebener Wert lässt die Sequenz unberührt; der nächste Verkauf zieht
  wieder die 1 und bekommt sie, weil `orderNumber` keine Eindeutigkeitsregel trägt. Als
  eigener Vorgang herausgelöst (siehe Abschnitt 16).
