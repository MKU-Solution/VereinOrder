# VereinOrder – Datensicherung und Wiederherstellung

Dieses Handbuch beschreibt den derzeit tatsächlich verfügbaren Stand von Issue #67.
VereinOrder ist keine RKSV-Registrierkasse.

## 1. Datensicherung

- VereinOrder erstellt stündlich eine vollständige PostgreSQL-Sicherung – unabhängig
  vom Veranstaltungsstatus. Zusätzlich wird 90 Sekunden nach dem Start gesichert, wenn
  die jüngste native Sicherung mindestens eine Stunde alt ist.
- Im gesperrten Wartungsmodus (`LOCKED`) wird kein geplanter Lauf gestartet. Ein
  Administrator kann dort weiterhin eine manuelle Sicherung anlegen.
- Eine Sicherung besteht immer aus zwei Dateien mit gleichem Stamm:
  `vereinorder_<ISO>_<auslöser>.dump` und
  `vereinorder_<ISO>_<auslöser>.manifest.json`.
- Der Dump wird im PostgreSQL-Custom-Format erzeugt. Vor der Veröffentlichung werden
  SHA-256, Größe, Tabellen- und Migrationsstand sowie `pg_restore --list` geprüft. Das
  Manifest wird zuletzt geschrieben und ist der Commit-Marker der Sicherung.
- `pg_dump`, `pg_restore` und PostgreSQL-Server müssen dieselbe Hauptversion haben.
  Eine fehlende oder abweichende Werkzeugversion sperrt die Sicherung und wird in der
  Systemdiagnose als Fehler angezeigt.

## 2. Manuelle Sicherung und externe Kopie

1. Als Administrator die Administration öffnen.
2. Den Bereich **„Backups & Datensicherung“** auswählen.
3. **„Jetzt sichern (Manuelles Backup)“** anklicken.
4. Warten, bis der neue Eintrag als **„Strukturgeprüft“** erscheint.
5. Über **„Dump“** und **„Manifest“** beide Dateien herunterladen und gemeinsam an
   einen zweiten, geschützten Ort kopieren.

Der native Dump ist eine vollständige interne Sicherung und enthält auch
Authentifizierungsdaten wie PIN-Hashes. Er darf nur Administratoren zugänglich sein,
nicht unverschlüsselt per E-Mail oder öffentlichem Datenträger weitergegeben und nicht
in das Git-Repository eingecheckt werden. Ein redigierter Export folgt in einem späteren
#67-Schnitt.

Vor dem Vertrauen auf eine Sicherung müssen beide Dateien vorhanden sein. Ein einzelner
Dump ohne Manifest ist kein veröffentlichter Sicherungsstand. JSON-Dateien werden nur
als **„Altbestand (JSON)“** angezeigt.

## 3. Wiederherstellung – aktueller Stand

Die native Wiederherstellung eines PostgreSQL-Dumps ist noch nicht freigegeben. Die
Administration zeigt für native Sicherungen deshalb bewusst keine
**„Wiederherstellen“**-Schaltfläche. Auch der API-Endpunkt lehnt `.dump`- und
`.manifest.json`-Dateien ab. Das alte `infrastructure/scripts/restore.sh` gehört nicht
zum nativen Format und darf dafür nicht verwendet werden.

Die vorhandene JSON-Wiederherstellung ist ein Übergangsweg für Altbestände. Sie ist nur
für Administratoren und ausschließlich im vollständig gesperrten Wartungsmodus
(`LOCKED`) verfügbar. Sie ersetzt Daten in der aktuellen Datenbank und ist kein Ersatz
für den noch folgenden, abgesicherten nativen Wiederherstellungsweg über eine
Nebendatenbank.

Bis dieser Folgeschnitt umgesetzt und mit einer echten Testdatenbank abgenommen ist,
gilt bei einem Wiederherstellungsbedarf:

1. System im Wartungsmodus auf `LOCKED` setzen und keine weiteren Buchungen zulassen.
2. Dump und zugehöriges Manifest unverändert sichern; keine Datei umbenennen oder
   bearbeiten.
3. Keine eigenständige Wiederherstellung in der Betriebsdatenbank versuchen.
4. Den technischen Verantwortlichen mit beiden Dateien und dem Diagnosebericht
   hinzuziehen.

## 4. Kontrolle

In der Systemdiagnose müssen PostgreSQL-Sicherung sowie Werkzeugversionen fehlerfrei
sein. In der Sicherungsliste werden beschädigte oder unvollständige Paare sichtbar als
defekt geführt. Änderungen an einer bereits gelisteten Datei lösen bei der nächsten
Abfrage eine erneute Hash- und Strukturprüfung aus.
