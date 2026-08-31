# VereinOrder – Datensicherung und Wiederherstellung

Dieses Handbuch beschreibt den freigegebenen Stand von Issue #67. VereinOrder ist
keine RKSV-Registrierkasse.

## 1. Sicherungsbetrieb

- VereinOrder erstellt stündlich einen PostgreSQL-Custom-Dump mit streng geprüftem
  Manifest. Manuelle Sicherungen sind ausschließlich Administratoren erlaubt.
- Dump und Manifest enthalten Tabellen- und Migrationsstand, fachliche Zählungen und
  Geldsummen, Dateigröße, Werkzeugversion und SHA-256-Prüfsumme.
- `pg_dump`, `pg_restore` und PostgreSQL-Server müssen dieselbe Hauptversion haben.
  Bei Abweichung ist die Sicherung gesperrt und die Diagnose rot.
- Die Aufbewahrung wird mit `BACKUP_RETENTION_HOURLY_KEEP`,
  `BACKUP_RETENTION_DAILY_KEEP` und `BACKUP_RETENTION_EVENT_KEEP` gesteuert. Die
  jüngste struktur- und wiederherstellungsgeprüfte Sicherung bleibt immer erhalten.
- Vor Restore und Update entstehen `PRE_RESTORE` beziehungsweise `PRE_MIGRATION`.
- Backupdateien und Zustandsdateien liegen in den Compose-Volumes `backup_data` und
  `state_data`. Sie gehören niemals in Git.

## 2. Manuelle Sicherung und Prüfung

1. Als `admin` die Administration und **Backups & Datensicherung** öffnen.
2. **Jetzt sichern** wählen und den Status **Strukturgeprüft** abwarten.
3. **Wiederherstellung prüfen** ausführen. Der Dump wird in eine leere
   Nebendatenbank eingespielt, fachlich vermessen und wieder entfernt.
4. Vor einem Fest mindestens ein zusammengehöriges Dump-/Manifest-Paar an einen
   zweiten, geschützten Datenträger kopieren.

Der vollständige Dump enthält auch PIN-Hashes und ist wie eine Zugangsdatenkopie zu
behandeln: nur Administratoren, keine unverschlüsselte E-Mail und kein öffentlicher
Datenträger. Der separat geplante redigierte Export und die einmalige PIN-Einrichtung
sind nicht Teil des Vollrestore-Verfahrens.

## 3. Native Wiederherstellung in der Administration

1. **Wartungsmodus** starten. Während `DRAINING` werden Warteschlangen geleert; erst
   `LOCKED` gibt den Restore frei.
2. Sicherstellen, dass alle Kassengeräte online sind und ihre lokalen Warteschlangen
   leer sind. VereinOrder kann fremde IndexedDB-Warteschlangen nicht selbst sehen.
3. Bei der gewünschten Sicherung **Sicher wiederherstellen** wählen.
4. Den angezeigten Sicherungszeitpunkt wortgleich eingeben und die Warteschlangen-
   Bestätigung setzen.
5. VereinOrder prüft Manifest, SHA-256, freien Speicher und `pg_restore --list`,
   erstellt `PRE_RESTORE`, stellt in einer Nebendatenbank wieder her, prüft Counts,
   Geldsummen, Auditwerte, Migrationen und Fremdschlüssel und schaltet erst danach um.
6. Das Backend beendet sich kontrolliert und wird durch Compose `restart: always`
   erneut gestartet. Die dateibasierte Wartungssperre bleibt `LOCKED`.
7. Katalog, Benutzer, offene Sitzungen, letzte Bestellungen, Zahlungen, Bons und Audit
   fachlich prüfen.
8. Danach entweder:
   - **Wiederherstellung abnehmen und Wartung beenden**: Rückfalldatenbank wird
     entfernt, Entscheidung auditiert, System wird geöffnet.
   - **Wiederherstellung rückgängig machen**: die alte Datenbank wird ohne erneuten
     Dump zurückbenannt. Danach den alten Stand prüfen und die Rücknahme ausdrücklich
     abnehmen.

Der allgemeine Endpunkt **Wartungsmodus beenden** verweigert das Öffnen, solange eine
Restore-Entscheidung aussteht. Ein Prozessabbruch zwischen den beiden PostgreSQL-
Umbenennungen wird anhand der real vorhandenen Datenbanknamen fortgesetzt. Defekte oder
unplausible Zustände bleiben geschlossen.

## 4. Technischer Notfallweg ohne laufendes Backend

Der letzte Rückweg hängt nicht von Node oder Prisma ab. Benötigt werden `psql`,
`pg_dump`, `pg_restore`, `jq` und `sha256sum` sowie dieselben libpq-Variablen wie für
PostgreSQL (`PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`).

**Nur auf dem Server selbst.** Seit #181 bindet `docker-compose.yml` den
Datenbankport nur noch auf die Loopback-Adresse des Hosts
(`127.0.0.1:5432:5432`). `PGHOST=127.0.0.1` erreicht die Datenbank deshalb nur,
wenn dieser Befehl direkt auf dem Server ausgeführt wird, nicht von einem
Laptop oder einem anderen Gerät im Netz aus. Für einen Fernzugriff ist zuerst
ein SSH-Tunnel auf den Server aufzubauen.

Die Sicherungsdateien liegen nicht in einem Verzeichnis neben dem Repository,
sondern im benannten Docker-Volume `vereinorder_backup_data`, das im Container
unter `/backups` eingehängt ist. `BACKUP_DIR` muss deshalb auf den Mountpunkt
dieses Volumes zeigen, zum Beispiel den von Docker verwalteten Pfad
(`docker volume inspect vereinorder_backup_data --format '{{ .Mountpoint }}'`)
oder ein eigenes Bind-Mount an derselben Stelle - nicht `./backups`.

```bash
export POSTGRES_DB=vereinorder
export BACKUP_DIR="$(docker volume inspect vereinorder_backup_data --format '{{ .Mountpoint }}')"
export STATE_DIR=./state
./scripts/ops/restore.sh "$BACKUP_DIR/<datei>.dump" "$BACKUP_DIR/<datei>.manifest.json"
docker compose restart backend
```

Das Skript verlangt den exakten Manifest-Zeitpunkt, prüft SHA-256, Struktur,
Tabellenzählungen und Fremdschlüssel, erzeugt einen separaten Sicherheitsdump und
verwendet dieselben absturzfortsetzbaren Datenbanknamen. Die Zustandsdatei wird für den
anschließenden Backend-Audit im `STATE_DIR` hinterlegt. Die Rückfalldatenbank niemals
vor der fachlichen Abnahme manuell löschen.

## 5. Update mit Sicherheitssicherung

Updates laufen ausschließlich über:

```bash
export ADMIN_TOKEN='<aktuelles Administrator-JWT>'
./scripts/ops/upgrade.sh
```

Das Skript setzt `LOCKED`, erzeugt und prüft `PRE_MIGRATION`, führt `prisma migrate
deploy` und `prisma migrate status` im Backend-Abbild aus und beendet die Wartung erst
nach Erfolg. Bei einem Fehler bleibt das System gesperrt und die Sicherheitssicherung
erhalten.

## 6. ARM64-/AMD64- und Neustart-Abnahme

Vor einem Release und einmal auf dem eingesetzten Raspberry Pi:

1. `pnpm test:pg-tools` ausführen; Server und Client müssen dieselbe Hauptversion
   melden.
2. Backend-Abbild für `linux/amd64` und `linux/arm64` bauen.
3. Auf dem Pi Sicherung und Wiederherstellungsprüfung ausführen.
4. Einen Restore auf einer ausdrücklich gekennzeichneten Testdatenbank umschalten,
   Backend-Neustart abwarten und eine Testbestellung durchführen.
5. Rücknahme ausführen und prüfen, dass der ursprüngliche Stand wieder aktiv ist.

Destruktive Prüfungen dürfen niemals gegen Festdaten laufen. Host, Port und ein
eindeutig auf `_test` lautender Datenbankname sind vorher zu kontrollieren.
