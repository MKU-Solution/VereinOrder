# Betriebs- und Wartungshandbuch

Dieses Handbuch beschreibt die operativen Abläufe während eines Festes, Datensicherung, Wiederherstellung, Updates und Katastrophenschutz in VereinOrder.

---

## 1. Ablauf eines Festbetriebstages

### Vor Festbeginn (Vorbereitung)

1. **Server starten:** Raspberry Pi / Server einschalten und prüfen, ob alle Container laufen (`docker compose ps`).
2. **Netzwerk prüfen:** WLAN-Access-Points und Drucker einschalten.
3. **Druckertest:** Im Admin-Panel unter _Druckerverwaltung_ auf jedem Bondrucker einen _Testdruck_ ausführen.
4. **Veranstaltung aktivieren:** Unter _Veranstaltungen_ die Festveranstaltung prüfen, RKSV-Hinweis bestätigen und auf _Scharf schalten_ klicken.
5. **Kasseneröffnung:** Jeder Kellner und Kassenbediener meldet sich an und eröffnet unter _Meine Kassa_ seine Kassensitzung mit dem gezählten Startguthaben (z. B. 100,00 € Wechselgeld).

### Während des Festbetriebs

- **Laufende Überwachung:** Der Administrator behält unter _Diagnose & Status_ Drucker, Uptime und Fehlerrate im Blick.
- **Ausverkauft-Meldungen:** Bei Engpässen (z. B. Grillfleisch fast aus) setzt die Station den Artikel auf _Knapp_ oder _Ausverkauft_. Alle Kellnergeräte aktualisieren sich in Echtzeit.
- **WLAN-Unterbrechungen:** Kellner können dank lokaler IndexedDB-Warteschlange weiterarbeiten. Sobald das Gerät wieder WLAN-Verbindung hat, werden Vormerkungen automatisch übertragen.

### Nach Festende (Abschluss)

1. **Kassenabschlüsse:** Jeder Kellner und jede Kasse zählt das Bargeld, gibt den Ist-Betrag in der Kassenmaske ein und schließt die Kassensitzung ab.
2. **Veranstaltung abschließen:** Die Festleitung schließt unter _Veranstaltungen_ das Event ab (mit Warnung vor eventuellen offenen Vormerkungen).
3. **Abschlussberichte & Exporte:** Unter _Auswertungen & Berichte_ werden Umsatzübersichten, Kellnerabrechnungen und CSV-Exporte gesichert.
4. **Tages-Backup:** Ein manuelles PostgreSQL-Backup erstellen und auf einen externen USB-Stick exportieren.

---

## 2. Datensicherung & Backup-Konzept

VereinOrder speichert Sicherungen als **native PostgreSQL-Custom-Dumps (`.dump`)**. Ein Verzeichnis `backups/` gibt es auf dem Host nicht: Der Backend-Container schreibt nach `/app/backups`, und dieser Pfad ist das benannte Docker-Volume `vereinorder_backup_data` (`docker-compose.yml`, Schlüssel `backup_data`).

- **Automatisches Vor-Migrations-Backup:** Vor jeder Datenbankmigration wird automatisch eine Sicherung angelegt.
- **Manuelles Backup im laufenden Betrieb:** Über das Admin-Panel (_Datensicherung -> Neues Backup erstellen_) wird ein konsistenter Snapshot ohne Betriebsunterbrechung erzeugt.
- **Zugriff auf die Dump-Datei, z. B. für den USB-Stick-Export nach Festende (Abschnitt 1, „Nach Festende (Abschluss)", Tages-Backup):** Der einfachste Weg ist die Schaltfläche **„Herunterladen"** neben jeder Sicherung im Admin-Panel unter _Datensicherung_ — sie lädt die Datei direkt aus dem Browser herunter (nur für Administratoren, `apps/backend/src/backup/backup.controller.ts`, `GET /backup/download/:filename`). Ohne laufende Anwendung führt der Weg über das Docker-Volume selbst, siehe [`backup-recovery.md`](backup-recovery.md), Abschnitt 4.

---

## 3. Abgesicherte Wiederherstellung (Restore-Swap)

Um Datenverlust und Nebenläufigkeitskonflikte während einer Wiederherstellung auszuschließen:

1. **Wartungsmodus:** Beim Start einer Wiederherstellung wechselt VereinOrder automatisch in den **Wartungsmodus**. Alle aktiven Client-Sitzungen werden gesperrt.
2. **Zweistufige Bestätigung:** Der Administrator muss den Sicherungszeitpunkt und die Kenntnisnahme offener Warteschlangen ausdrücklich bestätigen.
3. **Atomarer Schema-Swap:** Die Zieldatenbank wird in einem separaten Datenbankschema wiederhergestellt und erst nach erfolgreicher Validierung atomar aktiviert.
4. **Automatischer Wiederanlauf:** Nach erfolgreichem Restore wird der Wartungsmodus beendet und alle Clients laden den konsistenten Datenstand neu.

---

## 4. Updates & Rollback

### Aktualisierung

Für ein bereits eingerichtetes System läuft eine Aktualisierung **ausschließlich** über
den abgesicherten Betriebsweg `scripts/ops/upgrade.sh`. Ein eigenes `docker compose up -d`
oder `docker compose up -d --build` davor oder danach ist ausdrücklich **falsch**: Das
Skript nimmt die neuen Abbilder selbst in Betrieb (#199) — und zwar erst, nachdem
Wartungsmodus und Sicherung stehen.

1. **Repository aktualisieren:**
   ```bash
   git pull origin main
   ```
   `upgrade.sh` zieht nur die fertigen Anwendungsabbilder aus der Registry (bzw. baut sie
   örtlich bei `VEREINORDER_BUILD=1`) — `docker-compose.yml` selbst und die Skripte unter
   `scripts/ops/` kommen weiterhin aus dem Repository und müssen deshalb vorher aktuell
   sein.
2. **`ADMIN_TOKEN` holen — gegen das noch laufende, alte System**, bevor irgendetwas
   angefasst wird: Das Skript braucht das Token bereits für seinen ersten Schritt, um den
   Wartungsmodus zu setzen.
   ```bash
   export ADMIN_TOKEN='<aktuelles Administrator-JWT>'
   ```
3. **Skript ausführen:**
   ```bash
   ./scripts/ops/upgrade.sh
   ```
   Ohne erreichbare Registry oder für einen Stand, der nie nach `main` gelangt ist:
   `VEREINORDER_BUILD=1 ./scripts/ops/upgrade.sh` erzwingt den örtlichen Bau.

Das Skript läuft dabei immer in derselben Reihenfolge:

- Wartungsmodus setzen und auf die bestätigte Sperre (`LOCKED`) warten.
- Eine geprüfte `PRE_MIGRATION`-Sicherung erzeugen — garantiert vor jeder Schemaänderung.
- Erst danach die neuen Abbilder in Betrieb nehmen; die automatische Migration im
  Backend-Entrypoint (`apps/backend/docker-entrypoint.sh`, #172) läuft dadurch genau in
  diesem geschützten Fenster zwischen Sperre/Sicherung und Wiederöffnung.
- Den Wartungsmodus erst nach bestätigtem Erfolg wieder beenden. Schlägt ein Schritt
  unterwegs fehl, bleibt das System absichtlich gesperrt; das Skript gibt aus, welcher
  Schritt betroffen war und wie man nach Klärung der Ursache wieder herauskommt.

**Warnung:** Seit dem Entrypoint aus #172 migriert bereits ein bloßes `docker compose
up -d` (mit oder ohne `--build`) die Datenbank mit — aber ohne Wartungsmodus und ohne die
`PRE_MIGRATION`-Sicherung, die `upgrade.sh` davor anlegt. Wer so aktualisiert, hat im
Fehlerfall keinen abgesicherten Stand, auf den er zurückkann.

### Rollback

Vor jedem Neubau sichert `upgrade.sh` die dann noch laufenden Abbilder von `backend`,
`frontend` und `print-worker` unter `<Abbildname>:previous` (#201). Zeigt sich ein Fehler
erst im echten Betrieb, schaltet `scripts/ops/rollback.sh` ohne erneuten Bau auf genau
diese gesicherten Abbilder zurück. Voraussetzungen, Ablauf und die Prüfung auf ein
zwischenzeitliches Migrationsrisiko stehen in [`backup-recovery.md`](backup-recovery.md),
Abschnitt 6.
