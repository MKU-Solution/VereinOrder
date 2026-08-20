# VereinOrder - Datensicherung & Wiederherstellung (Backup & Disaster Recovery)

Dieses Handbuch beschreibt die Datensicherungs- und Wiederherstellungsmechanismen von **VereinOrder** für Administratoren und Festleiter.

---

## 1. Datensicherungsstrategie im Festbetrieb

- **Automatische Sicherungen**: Während einer aktiven Veranstaltung erstellt VereinOrder **jede Stunde** automatisch einen vollständigen Datenschnappschuss im Verzeichnis `./backups/`.
- **Manuelle Sicherung vor kritischen Aktionen**: Vor Preisänderungen, Sortimentsänderungen oder Kassenabschlüssen kann per Knopfdruck ein manuelles Backup erstellt werden.
- **Sicherheits-Snapshot vor Wiederherstellung**: Jede Wiederherstellung legt automatisch einen `PRE_RESTORE`-Sicherheitsstand an.

---

## 2. Backup erstellen über die Administration

1. Öffne die Administration unter `http://<server-ip>/admin`.
2. Klicke auf den Tab **„Backups & Datensicherung“**.
3. Klicke auf **„Jetzt sichern (Manuelles Backup)“**.
4. Die Sicherungsdatei wird sofort generiert, auf Integrität geprüft (SHA256) und in der Tabelle aufgelistet.
5. Klicke auf **„Herunterladen“**, um die Datei auf einen USB-Stick oder Laptop zu sichern.

---

## 3. Wiederherstellung (Disaster Recovery)

### Über das Web-Interface:
1. In `AdminDashboard` -> Tab **„Backups & Datensicherung“**.
2. Wähle das gewünschte Backup aus der Liste und klicke auf **„Wiederherstellen“**.
3. Bestätige die Sicherheitsabfrage.

### Über das Terminal:
```bash
# Datenbank aus Backup-Datei wiederherstellen
./infrastructure/scripts/restore.sh ./backups/vereinorder_backup_20260820_060000.sql.gz
```
