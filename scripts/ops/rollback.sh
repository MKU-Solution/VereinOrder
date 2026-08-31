#!/bin/sh
# Rueckweg auf die vorige Softwarefassung von backend, frontend und
# print-worker, OHNE erneuten Bau (#201).
#
# AUSGANGSLAGE: "docker-compose.yml" gibt fuer diese drei Dienste nur
# "build:" an, kein "image:". Compose vergibt den Abbildnamen selbst aus
# Projekt- und Dienstname ("<Projekt>-<Dienst>", z. B. "vereinorder-
# backend") und ueberschreibt genau diesen Namen bei jedem Neubau. Ohne
# Gegenmassnahme verliert das vorige Abbild damit seinen Namen, und der
# einzige verbleibende Weg zurueck waere ein vollstaendiger Neubau aus einem
# alten Stand - im Festbetrieb inakzeptabel. "scripts/ops/upgrade.sh"
# (#199, #201) sichert deshalb vor jedem Neubau das dann noch laufende
# Abbild unter "<Abbildname>:previous". Dieses Skript aktiviert genau diese
# Sicherung wieder - durch Umbenennen ("docker tag"), nicht durch Bauen.
#
# WARUM UEBER DEN LAUFENDEN CONTAINER, NICHT UEBER GERATENE NAMEN: Der feste
# "container_name" (z. B. "vereinorder_backend") ist NICHT der Abbildname.
# "scripts/ops/upgrade.sh" ermittelt das zu sichernde Abbild deshalb ueber
# "docker inspect" auf den tatsaechlich laufenden Container. Dieses Skript
# hier braucht den Abbildnamen nur fuer die Zielseite (welchen Namen Compose
# beim naechsten "docker compose up -d" erwartet) und berechnet ihn deshalb
# genauso: aus dem von Compose selbst gemeldeten Projektnamen
# ("docker compose config --format json", Feld ".name") und dem festen
# Dienstnamen - nicht geraten, sondern von Compose selbst erfragt.
#
# WARUM KEIN WARTUNGSMODUS UEBER DIE HTTP-API: Der Ernstfall, der diesen
# Rueckweg ausloest, kann genau der sein, in dem das Backend gar nicht mehr
# antwortet (Absturzschleife nach einem fehlerhaften Neubau) - ein Rueckweg,
# der ein funktionierendes Backend voraussetzt, um ein kaputtes Backend zu
# ersetzen, waere dieselbe Falle wie der in #199 verworfene "Weg A". Dieses
# Skript haelt "backend", "frontend" und "print-worker" deshalb direkt ueber
# Docker an ("docker compose stop") - das haengt nicht davon ab, ob die
# Anwendung selbst noch antwortet. Die Wartungssperre selbst muss dafuer
# nicht neu gesetzt werden: Sie liegt dateibasiert im "state_data"-Volume
# (docker-compose.yml, "STATE_DIR") und ueberlebt jeden Container-Tausch von
# sich aus. War das System schon gesperrt (etwa weil "upgrade.sh" nach einem
# fehlgeschlagenen Neubau absichtlich gesperrt geblieben ist, siehe dortiger
# Kopfkommentar), kommt das reaktivierte alte Backend WEITERHIN gesperrt
# wieder hoch. War es offen (der haeufigere Fall: die Aktualisierung lief
# scheinbar sauber durch, ein Fehler zeigte sich erst im echten Betrieb),
# kommt die alte, funktionierende Fassung bewusst sofort wieder offen hoch -
# genau das ist der Zweck eines schnellen Rueckwegs.
#
# WARUM DIE PRE_MIGRATION-WIEDERHERSTELLUNG NIEMALS AUTOMATISCH LAEUFT: Ein
# Software-Ruecksprung allein aendert die Datenbank nicht. Lief seit dem
# gesicherten Abbild eine Migration (der Entrypoint migriert automatisch,
# #199), liefe die alte Anwendungslogik gegen ein bereits weiter migriertes
# Schema. Dieses Skript prueft das (siehe unten, rein lesend) und WARNT
# deutlich - es fuehrt aber unter keinen Umstaenden selbst eine
# PRE_MIGRATION-Wiederherstellung (scripts/ops/restore.sh) aus. Diese wirft
# Bestellungen und Zahlungen weg, die seit der Sicherung entstanden sind -
# eine Entscheidung mit diesem Gewicht trifft ausschliesslich ein Mensch,
# nie ein Skript im Ernstfall unter Zeitdruck. Ein Skript, das dabei
# ungefragt Daten ersetzt, ist gefaehrlicher als eines, das innehaelt.
#
# KEINE INTERAKTIVEN ABFRAGEN: Erkennt die Pruefung unten ein Migrationsrisiko
# (oder kann es mangels erreichbarer Datenbank nicht ausschliessen), bricht
# das Skript ab und verlangt eine ausdrueckliche Bestaetigung ueber die
# Umgebungsvariable ROLLBACK_ACKNOWLEDGE_SCHEMA_RISK=1 - keine Eingabeaufforderung.
set -eu

command -v docker >/dev/null 2>&1 || {
  printf 'Fehlendes Werkzeug: docker\n' >&2
  exit 3
}
command -v jq >/dev/null 2>&1 || {
  printf 'Fehlendes Werkzeug: jq\n' >&2
  exit 3
}

POSTGRES_DB_NAME="${POSTGRES_DB:-vereinorder}"
POSTGRES_USER_NAME="${POSTGRES_USER:-postgres}"

step="Vorbedingungen pruefen"

report_failure() {
  status=$?
  if [ "$status" -eq 0 ]; then
    return 0
  fi
  printf '\n' >&2
  printf '=== RUECKWEG FEHLGESCHLAGEN (Schritt: %s, Exitcode %s) ===\n' \
    "$step" "$status" >&2
  printf 'Ursache pruefen (siehe Meldung oben) und erneut versuchen. Bereits\n' >&2
  printf 'aktivierte Abbilder wurden NICHT automatisch zurueckgesetzt - mit\n' >&2
  printf '"docker compose ps" und "docker inspect --format {{.Image}} <Container>"\n' >&2
  printf 'pruefen, welche Fassung je Dienst tatsaechlich laeuft.\n' >&2
}
trap report_failure EXIT

COMPOSE_PROJECT=$(docker compose config --format json | jq -er '.name') || {
  printf 'Compose-Projekt konnte nicht ermittelt werden. Dieses Skript im\n' >&2
  printf 'Projektverzeichnis mit "docker-compose.yml" ausfuehren.\n' >&2
  exit 3
}

# --- 1. Gesicherte Abbilder pruefen ------------------------------------------
# Alle drei Dienste muessen ein gesichertes Abbild haben, bevor irgendetwas
# angefasst wird: ein Rueckweg, der nur fuer einen Teil der Dienste
# funktioniert, wuerde eine inkonsistente Kombination aus alter und neuer
# Software in Betrieb nehmen - schlimmer als gar kein Rueckweg.
step="Gesicherte Abbilder pruefen"
missing=""
for rollback_service in backend frontend print-worker; do
  image_name="${COMPOSE_PROJECT}-${rollback_service}"
  if ! docker image inspect "${image_name}:previous" >/dev/null 2>&1; then
    missing="${missing}
 - ${image_name}:previous"
  fi
done
if [ -n "$missing" ]; then
  printf 'Kein Rueckweg moeglich: es fehlt ein gesichertes voriges Abbild fuer:\n' >&2
  printf '%s\n' "$missing" >&2
  printf '\n' >&2
  printf 'Ein gesichertes Abbild entsteht erst bei einem erfolgreichen Lauf von\n' >&2
  printf '"scripts/ops/upgrade.sh" (#201). Vor dem allerersten Aktualisierungslauf -\n' >&2
  printf 'oder wenn seither ein Abbild manuell entfernt wurde - gibt es folglich noch\n' >&2
  printf 'keinen Rueckweg. Abgebrochen, es wurde NICHTS veraendert.\n' >&2
  exit 4
fi

# --- 2. Migrationsrisiko pruefen (rein lesend, aendert keine Daten) ---------
# Vergleicht den Migrationsstand ZUM ZEITPUNKT, als "scripts/ops/upgrade.sh"
# dieses Abbild als Vorgaenger sicherte (Tabelle
# "_vereinorder_rollback_marker", von genau diesem Lauf angelegt), mit dem
# JETZT zuletzt angewendeten Migrationsstand. Ist der jetzige Stand neuer,
# migrierte das Schema seit der Sicherung weiter - die alte Anwendungslogik
# liefe gegen ein Schema, fuer das sie nicht gebaut wurde. Bewusst NICHT der
# Bauzeitpunkt des Abbilds selbst als Vergleichswert: Ein frisch gebautes
# Abbild durchlaeuft seine EIGENE erste Migration erst bei seinem ERSTEN
# Start danach, ihr Zeitpunkt liegt also praktisch immer NACH dem
# Bauzeitpunkt - ein Vergleich dagegen waere fast immer faelschlich positiv.
# Der Vergleich selbst laeuft als einzelne, rein lesende SQL-Abfrage IN
# Postgres (Zeitstempelvergleich per "::timestamptz"), nicht ueber das
# Parsen von Zeitstempeln im Shell-Skript.
step="Migrationsrisiko pruefen"

migration_check_possible=1
schema_risk=0
if migration_check_result=$(docker compose exec -T postgres psql --no-psqlrc \
  --set=ON_ERROR_STOP=1 -U "$POSTGRES_USER_NAME" -d "$POSTGRES_DB_NAME" \
  --tuples-only --no-align \
  --command='SELECT (
      (SELECT MAX(finished_at) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL)
      >
      (SELECT last_migration_finished_at FROM "_vereinorder_rollback_marker" WHERE id)
    )' \
  2>/dev/null); then
  case "$migration_check_result" in
    t) schema_risk=1 ;;
    f) schema_risk=0 ;;
    *) migration_check_possible=0 ;;
  esac
else
  migration_check_possible=0
fi

if [ "$migration_check_possible" -ne 1 ] || [ "$schema_risk" -eq 1 ]; then
  printf '\n' >&2
  if [ "$migration_check_possible" -ne 1 ]; then
    printf '=== Migrationsstand konnte NICHT ermittelt werden ===\n' >&2
    printf 'Die Datenbank (Dienst "postgres") war fuer die Pruefung nicht erreichbar,\n' >&2
    printf 'oder es fehlt die Markierung aus dem sichernden "upgrade.sh"-Lauf\n' >&2
    printf '("_vereinorder_rollback_marker" bzw. "_prisma_migrations"). Ob seit dem\n' >&2
    printf 'gesicherten Abbild migriert wurde, ist damit UNBEKANNT und wird\n' >&2
    printf 'sicherheitshalber als moeglich behandelt.\n' >&2
  else
    printf '=== Seit dem gesicherten Abbild wurde migriert ===\n' >&2
    printf 'Die zuletzt angewendete Migration ist NEUER als der Migrationsstand, den\n' >&2
    printf '"scripts/ops/upgrade.sh" beim Sichern dieses Abbilds festgehalten hat. Die\n' >&2
    printf 'alte Anwendungslogik liefe damit gegen ein bereits weiter migriertes\n' >&2
    printf 'Schema.\n' >&2
  fi
  printf '\n' >&2
  printf 'Dieser Rueckweg tauscht AUSSCHLIESSLICH die Software aus - er fasst die\n' >&2
  printf 'Datenbank NICHT an. Pruefen Sie, ob zusaetzlich eine PRE_MIGRATION-\n' >&2
  printf 'Wiederherstellung noetig ist (docs/ops/backup-recovery.md, Abschnitt "Update\n' >&2
  printf 'mit Sicherheitssicherung" bzw. "Technischer Notfallweg"; die dazugehoerige\n' >&2
  printf 'Sicherung stammt aus demselben "scripts/ops/upgrade.sh"-Lauf, der dieses\n' >&2
  printf 'Abbild als Vorgaenger gesichert hat). Dieses Skript fuehrt eine solche\n' >&2
  printf 'Wiederherstellung NIEMALS selbst aus - das bleibt eine bewusste,\n' >&2
  printf 'menschliche Entscheidung.\n' >&2
  printf '\n' >&2
  if [ "${ROLLBACK_ACKNOWLEDGE_SCHEMA_RISK:-0}" != "1" ]; then
    printf 'Abgebrochen. Es wurde NICHTS veraendert. Zum Fortfahren TROTZ dieses\n' >&2
    printf 'Risikos ausdruecklich bestaetigen:\n' >&2
    printf '  ROLLBACK_ACKNOWLEDGE_SCHEMA_RISK=1 %s\n' "$0" >&2
    exit 5
  fi
  printf 'ROLLBACK_ACKNOWLEDGE_SCHEMA_RISK=1 gesetzt - fahre trotz des Risikos fort.\n' >&2
  printf '\n' >&2
fi

# --- 3. Dienste anhalten, damit waehrend des Tauschs kein Datenverkehr laeuft
step="Dienste anhalten (backend, frontend, print-worker)"
docker compose stop backend frontend print-worker

# --- 4. Gesicherte Abbilder aktivieren (Umbenennen, KEIN Bau) ---------------
step="Gesicherte Abbilder aktivieren"
for rollback_service in backend frontend print-worker; do
  image_name="${COMPOSE_PROJECT}-${rollback_service}"
  docker tag "${image_name}:previous" "${image_name}:latest"
done

# --- 5. Dienste mit dem aktivierten Abbild neu starten, ausdruecklich ohne
# erneuten Bau ("--no-build" verweigert einen Bau, selbst wenn Compose ihn
# aus anderem Grund fuer noetig hielte).
step="Dienste mit dem gesicherten Abbild neu starten (ohne Bau)"
docker compose up -d --no-build backend frontend print-worker

# --- 6. Aktivierten Stand bestaetigen ---------------------------------------
step="Aktivierten Stand bestaetigen"
printf '\n'
printf 'Rueckweg abgeschlossen. Aktivierte Abbilder (ohne Neubau):\n'
for rollback_service in backend frontend print-worker; do
  image_name="${COMPOSE_PROJECT}-${rollback_service}"
  active_id=$(docker image inspect --format '{{.Id}}' "${image_name}:latest")
  active_created=$(docker image inspect --format '{{.Created}}' "${image_name}:latest")
  printf ' - %-10s %s  (%s, gebaut %s)\n' "$rollback_service" "$image_name" \
    "$active_id" "$active_created"
done
printf '\n'
API_BASE_URL="${API_BASE_URL:-http://127.0.0.1:3000}"
if maintenance_phase=$(curl --fail --silent --show-error --max-time 5 \
  "${API_BASE_URL}/maintenance" 2>/dev/null | jq -er '.phase' 2>/dev/null); then
  printf 'Wartungsphase des reaktivierten Backends: %s\n' "$maintenance_phase"
  if [ "$maintenance_phase" = "LOCKED" ]; then
    printf 'Das System bleibt gesperrt, bis ein Administrator es ausdruecklich wieder\n'
    printf 'oeffnet - je nach obiger Migrationspruefung ggf. erst nach einer\n'
    printf 'PRE_MIGRATION-Wiederherstellung.\n'
  fi
else
  printf 'Backend antwortet noch nicht auf "%s/maintenance" (kann direkt nach dem\n' \
    "$API_BASE_URL"
  printf 'Neustart normal sein). Status mit "docker compose logs backend" pruefen.\n'
fi
printf '\nFachlich pruefen, dass die erwartete vorige Fassung tatsaechlich laeuft.\n'
