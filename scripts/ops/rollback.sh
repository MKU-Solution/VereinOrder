#!/bin/sh
# Rueckweg auf die vorige Softwarefassung von backend, frontend und
# print-worker, OHNE erneuten Bau (#201).
#
# AUSGANGSLAGE: "docker-compose.yml" gibt fuer diese drei Dienste nur
# HINWEIS seit #200: Die drei Dienste tragen jetzt ein "image:" (ghcr.io).
# Der Absatz unten beschreibt den Zustand davor; die Mechanik bleibt dieselbe,
# nur der Abbildname kommt nicht mehr aus Projekt- plus Dienstnamen, sondern
# aus der Compose-Konfiguration selbst.
#
# "build:" an, kein "image:". Compose vergab den Abbildnamen selbst aus
# Projekt- und Dienstname ("<Projekt>-<Dienst>", z. B. "vereinorder-
# backend") und ueberschreibt genau diesen Namen bei jedem Neubau. Ohne
# Gegenmassnahme verliert das vorige Abbild damit seinen Namen, und der
# einzige verbleibende Weg zurueck waere ein vollstaendiger Neubau aus einem
# alten Stand - im Festbetrieb inakzeptabel. "scripts/ops/upgrade.sh"
# (#199, #201) sichert deshalb vor jedem Neubau das dann noch laufende
# Abbild unter "<Abbildname>:previous". Dieses Skript aktiviert genau diese
# Sicherung wieder - durch Umbenennen ("docker tag"), nicht durch Bauen.
#
# WARUM UEBER DEN LAUFENDEN CONTAINER, NICHT UEBER GERATENE NAMEN: Der
# Containername ist NICHT der Abbildname - und seit #185 vergibt
# docker-compose.yml ihn nicht einmal mehr selbst, sondern ueberlaesst ihn
# Compose (Projekt- plus Dienstname). Erst recht nichts zu raten also.
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
# WOHER DIE PRUEFUNG WEISS, WAS "SEIT DER SICHERUNG" BEDEUTET: "upgrade.sh"
# hinterlegt den Migrationsstand zum Sicherungszeitpunkt als einfache Datei
# im "state_data"-Volume ("/app/state/rollback-previous-migration-marker"),
# NICHT als Tabelle in der Anwendungsdatenbank - eine dort eingecheckte
# Tabelle bräuchte eine Prisma-Migration (AGENTS.md: "Datenbankaenderungen
# benoetigen nachvollziehbare, eingecheckte SQL-Migrationen") und würde ohne
# das über "pg_dump" in jede Sicherung wandern. Wichtiger noch: Ein nativer
# Restore (apps/backend/src/backup/restore-swap.ts, "RestoreSwapCoordinator")
# vertauscht ganze DATENBANKEN per SQL ("ALTER DATABASE ... RENAME TO ...",
# "postgresql-backup.tools.ts", "renameDatabase") - eine Markierung
# INNERHALB der Datenbank würde dabei durch den Stand aus der eingespielten
# Sicherung ersetzt und beschriebe danach einen anderen Augenblick als den,
# den sie beschreiben soll. Am Quelltext geprueft (Stand dieser Aenderung):
# "FileRestoreSwapStateStore" (restore-swap.ts) ist die einzige
# Dateisystem-Beruehrung des gesamten Restore-Ablaufs und schreibt
# ausschliesslich ihre EIGENE, anders benannte Datei
# ("restore-swap-state.json") im selben Volume - nie ein Verzeichnis-Wisch,
# nie ein Zugriff auf andere Dateinamen. Unsere Markierungsdatei bleibt
# davon unberuehrt, weil ihr Name nicht kollidiert; der eigentliche
# Datentausch laeuft ohnehin rein per SQL gegen "postgres_data", nicht
# gegen das Dateisystem. Gelesen wird die Markierung hier ueber einen kurzlebigen
# Hilfscontainer (Schritt 2 unten) - unabhaengig davon, ob das Backend noch
# antwortet, und OHNE ein Abbild aus dem Netz zu brauchen: Verwendet wird
# das bereits lokal vorhandene Postgres-Abbild (docker-compose.yml,
# Dienst "postgres" - Pflichtabhaengigkeit jeder lauffaehigen Installation),
# nur um dessen Alpine-Shell fuer ein "cat" zu nutzen, nicht um den
# Postgres-Server selbst zu starten.
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

# --- Abbildkennungen aus der Compose-Konfiguration (#200) --------------------
# Seit #200 tragen backend, frontend und print-worker ein "image:"
# (ghcr.io/...). Der frueher hier berechnete Name "<Projekt>-<Dienst>" - den
# Compose selbst vergibt, SOLANGE nur "build:" dasteht - trifft damit nicht
# mehr zu. Gefragt wird deshalb Compose selbst, wie schon beim
# PostgreSQL-Abbild weiter unten: nicht geraten, sondern erfragt.
COMPOSE_CONFIG_JSON=$(docker compose config --format json) || {
  printf 'Compose-Konfiguration konnte nicht gelesen werden. Dieses Skript im\n' >&2
  printf 'Projektverzeichnis mit "docker-compose.yml" ausfuehren.\n' >&2
  exit 3
}

# Die konfigurierte Kennung eines Dienstes, samt Marke:
#   "ghcr.io/mku-solution/vereinorder-backend:latest"
vereinorder_configured_image() {
  printf '%s' "$COMPOSE_CONFIG_JSON" |
    jq -er --arg dienst "$1" '.services[$dienst].image'
}

# Dieselbe Kennung ohne Marke, als Ablageort fuer ":previous":
#   "ghcr.io/mku-solution/vereinorder-backend"
# Der Ausdruck schneidet nur eine Marke ab, keinen Port im Registrynamen -
# nach dem letzten ":" darf kein "/" mehr folgen.
vereinorder_image_repository() {
  printf '%s' "$1" | sed 's|:[^:/]*$||'
}

# --- 1. Gesicherte Abbilder pruefen ------------------------------------------
# Alle drei Dienste muessen ein gesichertes Abbild haben, bevor irgendetwas
# angefasst wird: ein Rueckweg, der nur fuer einen Teil der Dienste
# funktioniert, wuerde eine inkonsistente Kombination aus alter und neuer
# Software in Betrieb nehmen - schlimmer als gar kein Rueckweg.
step="Gesicherte Abbilder pruefen"
missing=""
for rollback_service in backend frontend print-worker; do
  image_name=$(vereinorder_image_repository \
    "$(vereinorder_configured_image "$rollback_service")")
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
# dieses Abbild als Vorgaenger sicherte (Datei
# "rollback-previous-migration-marker" im "state_data"-Volume, von genau
# diesem Lauf geschrieben - Begruendung fuer Datei statt Datenbanktabelle
# im Kopfkommentar dieser Datei), mit dem JETZT zuletzt angewendeten
# Migrationsstand. Ist der jetzige Stand neuer, migrierte das Schema seit
# der Sicherung weiter - die alte Anwendungslogik liefe gegen ein Schema,
# fuer das sie nicht gebaut wurde. Bewusst NICHT der Bauzeitpunkt des
# Abbilds selbst als Vergleichswert: Ein frisch gebautes Abbild durchlaeuft
# seine EIGENE erste Migration erst bei seinem ERSTEN Start danach, ihr
# Zeitpunkt liegt also praktisch immer NACH dem Bauzeitpunkt - ein Vergleich
# dagegen waere fast immer faelschlich positiv.
step="Migrationsrisiko pruefen"

STATE_VOLUME=$(docker compose config --format json | jq -er '.volumes.state_data.name') || {
  printf 'Name des "state_data"-Volumes konnte nicht ermittelt werden.\n' >&2
  exit 3
}
POSTGRES_IMAGE=$(docker compose config --format json | jq -er '.services.postgres.image') || {
  printf 'Postgres-Abbildname konnte nicht ermittelt werden.\n' >&2
  exit 3
}

migration_check_possible=1
schema_risk=0
marker_value=""
if marker_value=$(docker run --rm -v "${STATE_VOLUME}:/state:ro" "$POSTGRES_IMAGE" \
  cat /state/rollback-previous-migration-marker 2>/dev/null) && [ -n "$marker_value" ]; then
  # Der Vergleich selbst laeuft als einzelne, rein lesende SQL-Abfrage IN
  # Postgres (Zeitstempelvergleich per "::timestamptz"), nicht ueber das
  # Parsen von Zeitstempeln im Shell-Skript.
  if migration_check_result=$(docker compose exec -T postgres psql --no-psqlrc \
    --set=ON_ERROR_STOP=1 -U "$POSTGRES_USER_NAME" -d "$POSTGRES_DB_NAME" \
    --tuples-only --no-align \
    --command="SELECT ((SELECT MAX(finished_at) FROM \"_prisma_migrations\" WHERE finished_at IS NOT NULL) > '${marker_value}'::timestamptz)" \
    2>/dev/null); then
    case "$migration_check_result" in
      t) schema_risk=1 ;;
      f) schema_risk=0 ;;
      *) migration_check_possible=0 ;;
    esac
  else
    migration_check_possible=0
  fi
else
  migration_check_possible=0
fi

if [ "$migration_check_possible" -ne 1 ] || [ "$schema_risk" -eq 1 ]; then
  printf '\n' >&2
  if [ "$migration_check_possible" -ne 1 ]; then
    printf '=== Migrationsstand konnte NICHT ermittelt werden ===\n' >&2
    printf 'Entweder fehlt die Markierung aus dem sichernden "upgrade.sh"-Lauf im\n' >&2
    printf '"state_data"-Volume ("rollback-previous-migration-marker"), oder die\n' >&2
    printf 'Datenbank (Dienst "postgres") war fuer die Pruefung nicht erreichbar. Ob\n' >&2
    printf 'seit dem gesicherten Abbild migriert wurde, ist damit UNBEKANNT und wird\n' >&2
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
  # Ziel ist die KONFIGURIERTE Marke, nicht pauschal ":latest": Steht in
  # VEREINORDER_VERSION eine gepinnte Fassung, muss das gesicherte Abbild
  # unter genau dieser Marke stehen, sonst zoege "docker compose up -d" die
  # gepinnte Fassung aus der Registry wieder heran.
  configured_image=$(vereinorder_configured_image "$rollback_service")
  image_name=$(vereinorder_image_repository "$configured_image")
  docker tag "${image_name}:previous" "$configured_image"
done

# --- 5. Dienste mit dem aktivierten Abbild neu starten, ausdruecklich ohne
# erneuten Bau ("--no-build" verweigert einen Bau, selbst wenn Compose ihn
# aus anderem Grund fuer noetig hielte) UND ausdruecklich mit erzwungenem
# Neuanlegen ("--force-recreate").
#
# WARUM "--force-recreate": Schritt 4 haengt nur die MARKE um ("docker tag"),
# nicht den Containerinhalt - der Containername, den Compose beim naechsten
# "up" anspricht, aendert sich dadurch nicht, und ein Container TRAEGT das
# Abbild, mit dem er einmal ERZEUGT wurde, unabhaengig davon, wohin seine
# Marke seither zeigt. Ob ein blosses "docker compose up -d --no-build" einen
# noch LAUFENDEN Container unter dieser Lage neu anlegt oder ihn unveraendert
# durchlaufen laesst, entscheidet eine Compose-interne Heuristik (im
# Wesentlichen ein Konfigurations-Hash aus der aufgeloesten Dienstdefinition),
# die NICHT zuverlaessig bei jeder Compose-Fassung dieselbe Abbild-ID-basierte
# Pruefung vornimmt: Ein Lauf dieses Skripts in der CI (#255, PR #258, unter
# Linux) blieb nach genau dieser Abfolge nachweislich auf dem NEUEN Abbild
# stehen - "docker compose ps" zeigte "Starting"/"Started", nirgends
# "Recreate". Ein lokaler Lauf auf Windows mit Docker Desktop (Compose
# v5.5.0) zeigte im selben Ablauf dagegen ein korrektes "Recreate" fuer
# "backend" - der Fehler ist also nachweislich umgebungs- bzw.
# versionsabhaengig, nicht grundsaetzlich falsch auf jeder Installation.
# "--force-recreate" umgeht diese Heuristik vollstaendig, statt sich auf sie
# zu verlassen: Es legt jeden der drei Container unbedingt neu an, unabhaengig
# davon, ob Compose eine Aenderung erkennt. Schritt 6 unten prueft zusaetzlich
# NACH dem Neustart, dass die Abbild-ID des tatsaechlich laufenden Containers
# mit der soeben aktivierten uebereinstimmt - das faengt auch den Fall ab,
# dass "${image_name}:previous" aus Schritt 4 aus irgendeinem Grund (z. B.
# einem fehlerhaft gepflegten Sicherungsschritt) auf das FALSCHE Abbild
# zeigte; "--force-recreate" allein wuerde diesen Fall NICHT erkennen, es
# wuerde nur zuverlaessig neu anlegen, nicht pruefen, WAS es neu angelegt hat.
#
# WARUM DAS "postgres" NICHT MIT ERFASST: "--force-recreate" wirkt nur auf
# die Dienste, die explizit auf der Befehlszeile stehen - "backend",
# "frontend" und "print-worker", genau wie schon "--no-build". "postgres"
# steht dort bewusst weiterhin NICHT: Es ist weder Ziel dieses Rueckwegs
# (nur die drei Anwendungsdienste haben ein gesichertes ":previous"-Abbild,
# siehe Schritt 1) noch darf eine Datenbank im Festbetrieb durch einen reinen
# Software-Rueckweg angefasst werden (siehe Kopfkommentar, Abschnitt "WARUM
# DIE PRE_MIGRATION-WIEDERHERSTELLUNG NIEMALS AUTOMATISCH LAEUFT"). Lokal
# nachgeprueft (Windows, Docker Desktop): Container-ID und Erzeugungszeitpunkt
# von "postgres" blieben ueber einen solchen Aufruf hinweg unveraendert - er
# wird nicht einmal neu gestartet, nur als bereits laufend/gesund erkannt.
# "depends_on: postgres: condition: service_healthy" (backend) und
# "depends_on: backend: condition: service_healthy" (print-worker) bleiben
# davon unberuehrt: Compose wartet weiterhin in dieser Reihenfolge, erzwungen
# neu angelegt oder nicht - ebenfalls lokal am Protokoll nachgeprueft
# ("Healthy" vor "print-worker ... Starting").
step="Dienste mit dem gesicherten Abbild neu starten (ohne Bau, erzwungen neu angelegt)"
docker compose up -d --no-build --force-recreate backend frontend print-worker

# --- 6. Aktivierten Stand bestaetigen UND tatsaechlich pruefen -------------
# Bisher (vor dieser Aenderung) las dieser Schritt nur die Abbild-ID hinter
# der MARKE aus ("docker image inspect ... $configured_image") und meldete
# das als Erfolg - unabhaengig davon, welches Abbild der Container aus
# Schritt 5 TATSAECHLICH fuehrt. Genau das verdeckte den oben beschriebenen
# Fehler: Die Marke stimmte, der Bediener sah eine plausible Erfolgsmeldung,
# der Container lief weiter mit der neuen Fassung. Derselbe blinde Fleck fiel
# bereits bei der Umsetzung von #255 auf, als "backend:previous" versuchsweise
# auf das Frontend-Abbild gebogen wurde und das Skript trotzdem Erfolg
# meldete. Ab hier gilt deshalb: Fuer jeden Dienst wird zusaetzlich die
# Abbild-ID des tatsaechlich laufenden CONTAINERS ermittelt ("docker inspect
# --format {{.Image}} <Container>", derselbe Weg, den "upgrade.sh" beim
# Sichern verwendet) und mit der soeben aktivierten Abbild-ID verglichen. Erst
# wenn ALLE drei uebereinstimmen, gilt der Rueckweg als erfolgreich - eine
# Abweichung ist ein Fehlschlag mit klarer Meldung, kein stiller Erfolg, und
# faellt in dieselbe Fehlerbehandlung ("report_failure" ueber "step") wie
# jeder andere Schritt dieses Skripts.
step="Aktivierten Stand bestaetigen"
printf '\n'
printf 'Abbilder nach dem Rueckweg pruefen (aktiviert vs. tatsaechlich laufend):\n'
activation_mismatch=""
for rollback_service in backend frontend print-worker; do
  configured_image=$(vereinorder_configured_image "$rollback_service")
  active_id=$(docker image inspect --format '{{.Id}}' "$configured_image")
  active_created=$(docker image inspect --format '{{.Created}}' "$configured_image")
  printf ' - %-10s %s  (%s, erstellt %s)\n' "$rollback_service" \
    "$configured_image" "$active_id" "$active_created"

  running_container_id=$(docker compose ps -q "$rollback_service")
  running_image_id=$(docker inspect --format '{{.Image}}' "$running_container_id")
  if [ "$running_image_id" != "$active_id" ]; then
    activation_mismatch="${activation_mismatch}
 - ${rollback_service}: aktiviert ${active_id}, tatsaechlich laeuft aber ${running_image_id}"
  fi
done
if [ -n "$activation_mismatch" ]; then
  printf '\n' >&2
  printf '=== RUECKWEG NICHT WIRKSAM: aktiviertes und laufendes Abbild weichen ab ===\n' >&2
  printf '%s\n' "$activation_mismatch" >&2
  printf '\n' >&2
  printf 'Die Abbildmarke wurde umgehaengt und "docker compose up --force-recreate"\n' >&2
  printf 'ist gelaufen, aber mindestens ein Container fuehrt nicht das soeben\n' >&2
  printf 'aktivierte Abbild. Das System steht damit NICHT nachweislich auf der\n' >&2
  printf 'vorigen Fassung - eine Erfolgsmeldung waere an dieser Stelle falsch. Mit\n' >&2
  printf '"docker compose ps" und "docker inspect --format {{.Image}} <Container>"\n' >&2
  printf 'pruefen, welche Fassung je Dienst tatsaechlich laeuft, und die Ursache\n' >&2
  printf 'klaeren (z. B. ein falsch gesetztes ":previous"-Abbild).\n' >&2
  exit 6
fi
printf '\n'
printf 'Rueckweg abgeschlossen. Fuer alle drei Dienste stimmt die soeben aktivierte\n'
printf 'Abbild-ID mit der des tatsaechlich laufenden Containers ueberein (siehe oben).\n'
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
