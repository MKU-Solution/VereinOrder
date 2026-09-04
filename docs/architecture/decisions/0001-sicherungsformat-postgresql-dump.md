# ADR 0001: Nativer PostgreSQL-Dump statt JSON-Abzug als Sicherungsformat

- **Status:** angenommen (Projektleitung, 2026-08-23). Die Entscheidungen zu den offenen Punkten stehen in `../../development/datensicherung.md`, Abschnitt 17.
- **Datum:** 2026-08-23
- **Vorgang:** Issue #67, erledigt #100 strukturell mit
- **Ausführlicher Entwurf:** `../../development/datensicherung.md`

Ablageort und Form folgen `docs/product/master-prompt.md`, Abschnitt 35
(„Architekturentscheidungen werden als Architecture Decision Records gespeichert unter:
`docs/architecture/decisions/`"). Dies ist der erste eingecheckte ADR des Projekts; die
Architekturentscheidung zum Druckbetrieb (#64) wird in `docs/ops/druckerbetrieb.md`
zwar erwähnt, aber nirgends als ADR geführt. Das wird hier nicht nachgeholt.

## Zusammenhang

`apps/backend/src/backup/backup.service.ts` erzeugt heute eine JSON-Datei aus fünfzehn
einzelnen `findMany`-Aufrufen und spielt sie über `deleteMany`/`createMany` in einer
Prisma-Transaktion zurück. Gemessen wurde daran:

1. Die Sicherung deckt 15 der 19 Modelle ab. Es fehlen `ProductVoucher`,
   `EventPickupCounter`, `ConfigOperation` und `AuthThrottle`.
2. `ProductVoucher` und `EventPickupCounter` werden beim Wiederherstellen nicht
   etwa „vergessen", sondern durch `ON DELETE CASCADE` aktiv gelöscht
   (`packages/database/prisma/schema.prisma:427`, `:718`) und nie wieder angelegt.
   Das ist der Befund aus #100.
3. `Order.orderNumber` ist eine `SERIAL` ohne Eindeutigkeitsregel
   (`schema.prisma:322`,
   `packages/database/prisma/migrations/20260818115353_feat_orders/migration.sql:10`).
   Die Wiederherstellung schreibt die alten Nummern zurück, setzt die Sequenz aber
   nicht nach. Die nächste Bestellung nach einer Wiederherstellung bekommt die
   Nummer 1 — ohne Fehlermeldung, weil keine Eindeutigkeitsregel dagegensteht.
4. `auditLogs` stehen in der Datei, werden aber nie zurückgespielt. Zusätzlich löscht
   die Wiederherstellung alle Benutzer (`backup.service.ts:261`); wegen
   `onDelete: SetNull` (`schema.prisma:674`) verlieren dabei sämtliche vorhandenen
   Auditzeilen ihren Urheber.
5. Es gibt keinen konsistenten Schnappschuss: `Promise.all` über fünfzehn getrennte
   Lesevorgänge (`backup.service.ts:63-95`).
6. Die Datei enthält `pinHash` aller Benutzer und ist über
   `GET /backup/download/:filename` herunterladbar.

Die Punkte 1 bis 3 sind alle dieselbe Fehlerklasse: **eine von Hand gepflegte Liste von
Tabellen, Spalten und Reihenfolgen driftet vom Schema weg, und niemand merkt es.**
`ProductVoucher` fehlt seit der Migration `20260820123000_add_product_vouchers`, also
seit Tag drei, ohne dass es jemandem aufgefallen wäre.

## Betrachtete Möglichkeiten

### A. JSON beibehalten und die Tabellenliste aus dem Prisma-DMMF erzeugen

`Prisma.dmmf.datamodel.models` liefert alle Modelle zur Laufzeit. Damit könnte keine
Tabelle mehr vergessen werden.

Behebt Punkt 1. Behebt **nicht**: die Sequenzen (Punkt 3), den fehlenden
Schnappschuss (Punkt 5), die von Hand gepflegte Lösch- und Einfügereihenfolge (die
heute schon zwei Warnkommentare trägt, `backup.service.ts:240-245` und `:271-287`),
das Prisma-Transaktionszeitlimit von 5 Sekunden und Tabellen, die Prisma gar nicht
kennt — allen voran `_prisma_migrations`, also genau der Datensatz, aus dem sich die
Schemakompatibilität einer Sicherung ableiten lässt.

### B. `pg_dump --format=plain`, komprimiert

Was `infrastructure/scripts/backup.sh:14` bereits tut. **Gelöscht mit Commit f1d2726
(#67); siehe `../../development/datensicherung.md`, Abschnitt 14, Punkt 5.** Eine
Textdatei ist lesbar und notfalls von Hand reparierbar.

Nachteil: Eine reine SQL-Datei lässt sich **nur durch Ausführen** prüfen. Das Issue
verlangt aber ausdrücklich eine „strikte Format-, Prüfsummen- und
Versionskompatibilitätsprüfung **vor jeder Datenänderung**". Genau das kann dieses
Format nicht leisten.

### C. `pg_dump --format=custom` (`-Fc`) mit begleitendem JSON-Manifest

Gewählt. Begründung unten.

## Entscheidung

**Das Sicherungsformat ist ein nativer PostgreSQL-Dump im Custom-Format (`pg_dump -Fc`),
begleitet von einer eigenen, klartextlesbaren Manifestdatei.**

Tragende Gründe, in dieser Reihenfolge:

1. **Die Fehlerklasse „Tabelle vergessen" verschwindet strukturell.** `pg_dump` sichert
   das gesamte Schema samt Daten, Sequenzständen, Indizes, Fremdschlüsseln und
   `_prisma_migrations`. Es gibt keine Liste mehr, die driften kann. Möglichkeit A
   kauft dieselbe Zusage nur für die Teilmenge, die Prisma kennt, und lässt die
   Sequenzen offen.
2. **Prüfbarkeit ohne Ausführung.** `pg_restore --list` liest das Inhaltsverzeichnis
   eines Custom-Format-Dumps, ohne eine einzige Anweisung auszuführen. Eine
   abgeschnittene, halb geschriebene oder verfälschte Datei fällt damit auf, **bevor**
   irgendetwas gelöscht wird. Das ist die Zusage des Issues, die Möglichkeit B nicht
   halten kann.
3. **Konsistenter Schnappschuss ohne eigenes Zutun.** `pg_dump` arbeitet in einer
   Transaktion mit Isolationsstufe `REPEATABLE READ`. Die Sicherung ist damit
   punktgenau, auch während im Festbetrieb weitergebucht wird.
4. **Fremdschlüsselintegrität wird beim Wiederherstellen bewiesen, nicht behauptet.**
   Ein Custom-Format-Restore legt zuerst die Daten und danach die Bedingungen an; das
   Anlegen eines Fremdschlüssels validiert ihn. Ein fehlerfreier Lauf mit
   `--single-transaction --exit-on-error` **ist** der Integritätsnachweis, den das
   Akzeptanzkriterium verlangt.
5. **Keine Reihenfolgenpflege mehr.** Die beiden Warnkommentare im heutigen Dienst
   („do not reorder these two without checking the FK direction again") entfallen
   ersatzlos.

## Folgen

### Erkauft

- **Externe Werkzeuge im Backend-Abbild.** `pg_dump`/`pg_restore` sind keine
  Bibliothek, sondern Programme. Das Backend-Abbild (`apps/backend/Dockerfile:34`,
  `node:20-alpine`) bekommt `postgresql16-client`. Die Hauptversion muss zur
  Serverversion passen — `docker-compose.yml:3` legt `postgres:16-alpine` fest. Ein
  `pg_dump` mit älterer Hauptversion verweigert einen neueren Server; umgekehrt ist es
  erlaubt, aber unerwünscht. Deshalb gilt verbindlich:
  - Beim Start vergleicht das Backend `SHOW server_version_num` mit
    `pg_dump --version`. Bei abweichender Hauptversion wird die Sicherung
    **abgeschaltet** und eine `ERROR`-Empfehlung in der Diagnose ausgegeben. Eine
    stillschweigend kaputte Sicherung ist schlimmer als keine.
  - Die CI prüft dasselbe im gebauten Abbild, auf `linux/amd64` **und** `linux/arm64`.
- **Der Dump ist undurchsichtig.** Ohne `pg_restore` ist nichts damit anzufangen. Das
  Manifest daneben bleibt deshalb bewusst reines, lesbares JSON: Zeitpunkt,
  Migrationstand, Zählungen, Geldsummen, Prüfsumme. Wer nur die Datei hat, kann
  wenigstens lesen, was drin sein müsste.
- **Ein Dump ist nicht schemafrei einspielbar.** Eine Sicherung von vor einer Migration
  passt nicht auf ein Schema von danach. Der heutige JSON-Weg hat dafür Sonderlogik
  (die Auffangkategorie aus #84, `backup.service.ts:288-317`); der Dump-Weg kann das
  nicht und soll es nicht. Stattdessen führt das Manifest einen `schemaFingerprint`
  über `_prisma_migrations`, und die Wiederherstellung fährt eine ältere Sicherung in
  einer Nebendatenbank vor, migriert sie dort vorwärts und schaltet erst dann um. Der
  Weg ist derselbe, den `scripts/ci/test-migrations.mjs` bereits nachweislich geht.
- **Die Wiederherstellung ist keine Prisma-Transaktion mehr.** Sie ist ein
  Kindprozess. Fortschritt, Abbruch und Rückfall müssen ausdrücklich gebaut werden.
- **Ein Wartungsmodus wird zur Voraussetzung, nicht zur Kür.** Ein Restore braucht die
  Datenbank für sich allein.

### Gewonnen

- `ProductVoucher`, `EventPickupCounter`, `ConfigOperation` und `AuthThrottle` sind ab
  der ersten Zeile enthalten, ohne dass sie irgendwo genannt werden müssen. #100 ist
  damit für alle neuen Sicherungen erledigt.
- Sequenzstände kommen mit. Die stille Doppelvergabe von `Order.orderNumber` nach einer
  Wiederherstellung ist strukturell ausgeschlossen.
- `_prisma_migrations` kommt mit. Eine wiederhergestellte Datenbank weiß selbst, auf
  welchem Migrationsstand sie steht.
- Das Prisma-Transaktionszeitlimit spielt keine Rolle mehr.

### Nicht entschieden

Der Umgang mit den bereits auf Geräten liegenden JSON-Dateien, die Behandlung der
Anmeldedaten in der Datei und der Zuschnitt des Wartungsmodus sind Gegenstand von
`../../development/datensicherung.md`, Abschnitte 5, 6 und 8, und dort teils als
offene Punkte an die Projektleitung gerichtet.
