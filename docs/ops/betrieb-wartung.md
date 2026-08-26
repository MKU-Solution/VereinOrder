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

VereinOrder speichert Sicherungen als **native PostgreSQL-Custom-Dumps (`.dump`)** im Verzeichnis `backups/`:

- **Automatisches Vor-Migrations-Backup:** Vor jeder Datenbankmigration wird automatisch eine Sicherung angelegt.
- **Manuelles Backup im laufenden Betrieb:** Über das Admin-Panel (_Datensicherung -> Neues Backup erstellen_) wird ein konsistenter Snapshot ohne Betriebsunterbrechung erzeugt.

---

## 3. Abgesicherte Wiederherstellung (Restore-Swap)

Um Datenverlust und Nebenläufigkeitskonflikte während einer Wiederherstellung auszuschließen:

1. **Wartungsmodus:** Beim Start einer Wiederherstellung wechselt VereinOrder automatisch in den **Wartungsmodus**. Alle aktiven Client-Sitzungen werden gesperrt.
2. **Zweistufige Bestätigung:** Der Administrator muss den Sicherungszeitpunkt und die Kenntnisnahme offener Warteschlangen ausdrücklich bestätigen.
3. **Atomarer Schema-Swap:** Die Zieldatenbank wird in einem separaten Datenbankschema wiederhergestellt und erst nach erfolgreicher Validierung atomar aktiviert.
4. **Automatischer Wiederanlauf:** Nach erfolgreichem Restore wird der Wartungsmodus beendet und alle Clients laden den konsistenten Datenstand neu.

---

## 4. Updates & Rollback

```bash
# 1. Neuesten Quellcode / Release holen
git pull origin main

# 2. Container aktualisieren und neu bauen
docker compose down
docker compose up -d --build

# 3. Datenbank prüfen
docker compose logs backend
```
