#!/bin/sh
# Abgesicherte Aktualisierung eines bereits eingerichteten Systems (#199).
#
# ENTSCHEIDUNG DER PROJEKTLEITUNG (Issue #199, "Weg B"): Dieses Skript baut
# das Buendel selbst neu, ANSTATT den Bediener zuerst "docker compose up -d
# --build" von Hand ausfuehren zu lassen. Vorher (docs/ops/raspberry-pi-
# setup.md vor #199) stand der Neubau VOR dem Setzen des Wartungsmodus und
# der PRE_MIGRATION-Sicherung - der Entrypoint (#172,
# apps/backend/docker-entrypoint.sh) migriert dabei aber automatisch und
# UNGESCHUETZT, noch bevor irgendeine Sicherung des Vor-Migrations-Standes
# existiert. Die spaeter erzeugte Sicherung enthielt dann bereits das neue
# Schema.
#
# Warum nicht stattdessen der Entrypoint die Migration auf einem befuellten
# System verweigert (verworfener "Weg A"): Ein Backend, das beim Start die
# Migration verweigert und mit Fehlerstatus abbricht, kommt unter
# "restart: always" (docker-compose.yml:26) gar nicht mehr hoch - und ohne
# laufendes Backend laesst sich "POST /maintenance/start" nicht mehr
# aufrufen. Weg A koennte sich damit selbst blockieren.
#
# Neuer Ablauf, in dieser Reihenfolge:
#   1. Vorbedingungen pruefen (jq, docker, ADMIN_TOKEN).
#   2. POST /maintenance/start, auf Phase LOCKED warten.
#   3. POST /backup/pre-migration - jetzt garantiert VOR jeder Migration.
#   4. Die GERADE LAUFENDEN Abbilder von backend, frontend und print-worker
#      unter "<Abbildname>:previous" sichern (#201) - das ist die letzte
#      Gelegenheit dazu, denn Schritt 6 ueberschreibt denselben Abbildnamen
#      sofort wieder. Ohne diesen Schritt gibt es nach einem fehlgeschlagenen
#      Neubau keinen Weg zurueck ausser einem vollstaendigen Neubau aus einem
#      alten Stand - siehe scripts/ops/rollback.sh fuer den Rueckweg selbst.
#   5. docker compose up -d --build. SKIP_AUTO_MIGRATE wird ABSICHTLICH
#      NICHT gesetzt: Die Automigration im Entrypoint ist erwuenscht, nur
#      ihr Zeitpunkt war falsch. Sie laeuft jetzt genau hier, im
#      geschuetzten Fenster zwischen Sicherung und Wiederoeffnung.
#   6. Auf ein wieder antwortendes Backend warten, mit Zeitgrenze.
#   7. "prisma migrate status" zur Kontrolle, gegen den bereits laufenden
#      Container (kein zusaetzlicher Einwegcontainer noetig, siehe unten).
#   8. POST /maintenance/end.
#
# Die beiden vormaligen "docker compose run --rm --no-deps
# -e SKIP_AUTO_MIGRATE=1 backend ..."-Aufrufe (frueher hier an dieser
# Stelle) entfallen ERSATZLOS:
#   - "prisma migrate deploy" lief dort, weil dieses Skript den Neubau
#     bisher NICHT selbst ausloeste und die Migration deshalb separat
#     nachholen musste. Schritt 4 uebernimmt das jetzt ueber den
#     ohnehin vorhandenen Entrypoint-Mechanismus - ein zweiter,
#     redundanter Migrationslauf waere unnoetig und muesste ueber
#     SKIP_AUTO_MIGRATE eigens vor einer Dopplung geschuetzt werden.
#   - "prisma migrate status" (nur informativ) lief dort aus demselben
#     Grund mit. Schritt 6 unten fuehrt denselben Befehl weiterhin aus,
#     aber per "docker compose exec" GEGEN DEN BEREITS LAUFENDEN
#     Container aus Schritt 4 - ohne einen weiteren, kurzlebigen
#     Container zu starten und ohne SKIP_AUTO_MIGRATE, das fuer "exec"
#     ohnehin wirkungslos waere (der Entrypoint laeuft bei "exec" kein
#     zweites Mal).
#
# FEHLERVERHALTEN (#199, Punkt 1): Schlaegt ein Schritt NACH erfolgreichem
# Sperren fehl, bleibt das System ABSICHTLICH im Wartungsmodus gesperrt -
# ein System, das sich nach einer halb gelaufenen Migration selbst wieder
# oeffnet, waere gefaehrlicher als eines, das gesperrt bleibt. "set -eu"
# allein wuerde das nur wortlos tun; die Funktion "report_failure" unten
# (per "trap ... EXIT" registriert) macht bei jedem Fehlschlag nach dem
# Sperren ausdruecklich sichtbar, WAS fehlgeschlagen ist, DASS das System
# gesperrt bleibt, und WIE man wieder herauskommt.
set -eu

API_BASE_URL="${API_BASE_URL:-http://127.0.0.1:3000}"
: "${ADMIN_TOKEN:?ADMIN_TOKEN mit einem aktuellen Administrator-Token ist erforderlich}"
AUTH_HEADER="Authorization: Bearer ${ADMIN_TOKEN}"

# Zeitgrenze fuer Schritt 5 (#199, Punkt 3). Ohne sie wuerde das Skript bei
# einer fehlgeschlagenen Migration ewig auf ein Backend warten, das wegen
# "restart: always" (docker-compose.yml:26) endlos in der Neustartschleife
# haengt, statt jemals wieder zu antworten.
UPGRADE_READY_TIMEOUT_SECONDS="${UPGRADE_READY_TIMEOUT_SECONDS:-300}"
UPGRADE_READY_POLL_SECONDS="${UPGRADE_READY_POLL_SECONDS:-2}"

# Fester Pfad des JWT-Schluessels im STATE_DIR-Volume, siehe
# docker-compose.yml:64 ("STATE_DIR: /app/state", kein ueberschreibbarer
# Vorgabewert dort) und apps/backend/src/secrets/ensure-secrets.ts
# (JWT_SECRET_FILE = "jwt-secret"). Ueberschreibbar nur fuer abweichende
# lokale Testaufbauten.
BACKEND_STATE_JWT_SECRET_PATH="${BACKEND_STATE_JWT_SECRET_PATH:-/app/state/jwt-secret}"

command -v jq >/dev/null 2>&1 || {
  printf 'Fehlendes Werkzeug: jq\n' >&2
  exit 3
}
command -v docker >/dev/null 2>&1 || {
  printf 'Fehlendes Werkzeug: docker\n' >&2
  exit 3
}

# --- Fehlerbehandlung (#199, Punkt 1) ---------------------------------------
# "step" haelt fest, an welcher Stelle des Ablaufs das Skript gerade steht,
# "maintenance_locked" ob "POST /maintenance/start" bereits ein bestaetigtes
# LOCKED erreicht hat - erst ab dann ist "das System bleibt gesperrt" ueber-
# haupt eine zutreffende Aussage. "legacy_jwt_secret_risk" traegt die
# Vorabpruefung aus Punkt 2 (siehe unten) in die Fehlermeldung.
step="Vorbedingungen pruefen"
maintenance_locked=0
legacy_jwt_secret_risk=0

report_failure() {
  status=$?
  if [ "$status" -eq 0 ]; then
    return 0
  fi
  printf '\n' >&2
  printf '=== AKTUALISIERUNG FEHLGESCHLAGEN (Schritt: %s, Exitcode %s) ===\n' \
    "$step" "$status" >&2
  if [ "$maintenance_locked" -eq 1 ]; then
    printf 'Das System bleibt ABSICHTLICH im Wartungsmodus (Phase LOCKED) gesperrt.\n' >&2
    printf 'Es wird NICHT automatisch wieder geoeffnet: Sicherung und/oder Migration\n' >&2
    printf 'koennten unvollstaendig sein, und ein System, das sich nach einer halb\n' >&2
    printf 'gelaufenen Migration selbst wieder oeffnet, waere gefaehrlicher als eines,\n' >&2
    printf 'das gesperrt bleibt.\n' >&2
    if [ "$legacy_jwt_secret_risk" -eq 1 ]; then
      printf '\n' >&2
      printf 'Vor dem Neubau wurde kein persistenter JWT_SECRET gefunden (siehe Warnung\n' >&2
      printf 'oben, Installation von vor #175) - das ist die wahrscheinlichste Ursache:\n' >&2
      printf 'Der Neubau in Schritt 4 hat einen NEUEN Schluessel erzeugt, und das anfangs\n' >&2
      printf 'geholte ADMIN_TOKEN ist seither ungueltig. Sicherung und Migration lief das\n' >&2
      printf 'NICHT an - nur ein an dieses Token gebundener Schritt kann daran gescheitert\n' >&2
      printf 'sein (typischerweise "POST /maintenance/end" selbst).\n' >&2
    fi
    printf '\n' >&2
    printf 'Weg heraus:\n' >&2
    printf '  1. Ursache klaeren: "docker compose logs backend" und die Meldung oben.\n' >&2
    printf '  2. Ein GUELTIGES Administrator-Token besorgen (ggf. neu anmelden, siehe\n' >&2
    printf '     Hinweis zum Schluesselwechsel oben, falls zutreffend).\n' >&2
    printf '  3. Ist das Schema nach Einschaetzung des Bedieners korrekt migriert\n' >&2
    printf '     ("docker compose exec -T backend pnpm --filter @vereinorder/database\n' >&2
    printf '     exec prisma migrate status" pruefen): Wartungsmodus manuell beenden:\n' >&2
    printf '       curl --fail -X POST -H "Authorization: Bearer <Token>" \\\n' >&2
    printf '         %s/maintenance/end\n' "$API_BASE_URL" >&2
    printf '  4. Ist das Schema NICHT sauber migriert oder die Ursache unklar: NICHT\n' >&2
    printf '     manuell entsperren. Stattdessen den Notfall-Restore in\n' >&2
    printf '     docs/ops/backup-recovery.md mit der soeben erzeugten\n' >&2
    printf '     PRE_MIGRATION-Sicherung durchfuehren.\n' >&2
  else
    printf 'Der Wartungsmodus wurde noch nicht bestaetigt gesperrt - das System duerfte\n' >&2
    printf 'sich noch im gewohnten Betriebszustand befinden. Ursache pruefen und erneut\n' >&2
    printf 'versuchen.\n' >&2
  fi
}
trap report_failure EXIT

# --- 1. Wartungsmodus setzen -------------------------------------------------
step="Wartungsmodus setzen (POST /maintenance/start)"
curl --fail --silent --show-error --request POST \
  --header "$AUTH_HEADER" --header 'Content-Type: application/json' \
  --data '{"reason":"Softwareaktualisierung mit PRE_MIGRATION-Sicherung"}' \
  "${API_BASE_URL}/maintenance/start" >/dev/null

step="Auf Wartungsphase LOCKED warten"
attempt=0
while [ "$attempt" -lt 90 ]; do
  phase=$(curl --fail --silent --show-error --header "$AUTH_HEADER" \
    "${API_BASE_URL}/maintenance" | jq -r '.phase')
  [ "$phase" = "LOCKED" ] && break
  attempt=$((attempt + 1))
  sleep 2
done
[ "${phase:-}" = "LOCKED" ] || {
  printf 'Wartungsmodus wurde nicht LOCKED. Update abgebrochen.\n' >&2
  exit 10
}
maintenance_locked=1

# --- 2. PRE_MIGRATION-Sicherung ---------------------------------------------
# Ab hier garantiert VOR jeder Schemaaenderung: Der Neubau (und damit die
# automatische Migration im Entrypoint) folgt erst danach in Schritt 4/5.
step="PRE_MIGRATION-Sicherung anlegen (POST /backup/pre-migration)"
curl --fail --silent --show-error --request POST --header "$AUTH_HEADER" \
  "${API_BASE_URL}/backup/pre-migration" >/dev/null

# --- Vorabpruefung: droht ein Schluesselwechsel? (#199, Punkt 2) -----------
# Installationen von vor #175 kannten weder ein persistentes JWT_SECRET
# noch die zugehoerige Datei unter STATE_DIR. Ist beides nicht vorhanden,
# erzeugt der Entrypoint beim gleich folgenden Neubau (Schritt 4) einen
# NEUEN Schluessel (apps/backend/src/secrets/ensure-secrets.ts) - das
# eingangs geholte ADMIN_TOKEN wird dadurch ungueltig, und "POST
# /maintenance/end" scheitert am Ende mit 401, NACHDEM Sicherung und
# Migration bereits erfolgreich gelaufen sind. Eine Warnung VOR dem Neubau
# ist hier aussagekraeftiger als eine Fehlermeldung danach: Sie erklaert
# die Ursache, bevor der Bediener sie an einem scheinbar grundlosen 401 am
# Ende raten muesste. Geprueft wird deshalb zweifach, weil ein gesetztes
# JWT_SECRET die Datei absichtlich NICHT anlegt (ensureSecret(): eine
# gesetzte Umgebungsvariable gewinnt immer und wird nicht auf die Platte
# geschrieben):
#   1. Ist JWT_SECRET fuer den Dienst "backend" ueber Umgebung/.env gesetzt
#      (bleibt beim Neubau unveraendert erhalten)?
#   2. Sonst: liegt die Schluesseldatei bereits auf dem persistenten
#      STATE_DIR-Volume (ueberlebt das Neuanlegen des Containers)?
# Beide Fragen lassen sich VOR dem Neubau beantworten, waehrend der alte
# Backend-Container noch laeuft.
step="Persistenten JWT_SECRET pruefen"
resolved_jwt_secret=$(docker compose config --format json 2>/dev/null |
  jq -r '.services.backend.environment.JWT_SECRET // ""')
jwt_secret_persisted=0
if [ -n "$resolved_jwt_secret" ]; then
  jwt_secret_persisted=1
elif docker compose exec -T backend test -f "$BACKEND_STATE_JWT_SECRET_PATH" 2>/dev/null; then
  jwt_secret_persisted=1
fi
if [ "$jwt_secret_persisted" -eq 0 ]; then
  legacy_jwt_secret_risk=1
  printf '\n' >&2
  printf '=== WARNUNG: kein persistenter JWT_SECRET gefunden (Installation von vor #175) ===\n' >&2
  printf 'Der gleich folgende Neubau (docker compose up -d --build) erzeugt in diesem\n' >&2
  printf 'Fall einen NEUEN Schluessel. Das aktuelle ADMIN_TOKEN wird dadurch ungueltig,\n' >&2
  printf 'und "POST /maintenance/end" am Ende dieses Skripts wird voraussichtlich mit\n' >&2
  printf '401 fehlschlagen. Das ist bekannt: Sicherung und Migration laufen davon\n' >&2
  printf 'unberuehrt vollstaendig durch, nur das Entsperren am Ende braucht danach ein\n' >&2
  printf 'neues ADMIN_TOKEN (neu anmelden, "POST /maintenance/end" von Hand nachholen -\n' >&2
  printf 'Einzelheiten folgen unten, falls es so weit kommt).\n' >&2
  printf '\n' >&2
fi

# --- Vorige Abbilder sichern (#201) -----------------------------------------
# "docker-compose.yml" gibt fuer backend, frontend und print-worker nur
# "build:" an, kein "image:". Compose vergibt den Abbildnamen dabei selbst
# aus Projekt- und Dienstname ("<Projekt>-<Dienst>", z. B.
# "vereinorder-backend") und ueberschreibt genau diesen Namen bei jedem
# Neubau - das vorige Abbild verliert seinen Namen und ist ohne diesen
# Schritt nur noch ueber seine Abbild-ID ansprechbar, wenn ueberhaupt (ein
# "docker image prune" raeumt unbenannte/"dangling" Abbilder weg). Der
# "container_name" (z. B. "vereinorder_backend") ist NICHT der Abbildname
# und dient hier nur dazu, ueber den tatsaechlich laufenden Container an das
# tatsaechlich laufende Abbild zu kommen - erraten wird nichts.
#
# Genau EINE Vorgaengerfassung wird aufbewahrt (Tag ":previous", bei jedem
# Lauf ueberschrieben): Jeder Aktualisierungslauf erzeugt genau eine neue
# PRE_MIGRATION-Sicherung (Schritt 3 oben), und nur die zu DIESEM Lauf
# gehoerende Sicherung passt sicher zu dem hier gesicherten Abbild. Mehrere
# Vorgaengerfassungen vorzuhalten wuerde verlangen, jede einzelne mit der
# jeweils zugehoerigen PRE_MIGRATION-Sicherung zu verknuepfen, ohne dafuer
# einen belastbaren Zusatznutzen zu liefern - der Rueckweg
# (scripts/ops/rollback.sh) federt ohnehin nur den letzten Schritt ab, nicht
# beliebig viele. Ein getaggtes Abbild gilt Docker NIEMALS als "dangling";
# ein einfaches "docker image prune" entfernt "<Abbildname>:previous" daher
# nicht. Nur "docker image prune -a" wuerde es entfernen, sobald kein
# Container mehr darauf verweist (docs/ops/backup-recovery.md).
step="Vorige Abbilder sichern (#201)"
COMPOSE_PROJECT_FOR_ROLLBACK=$(docker compose config --format json | jq -er '.name')
for rollback_service in backend frontend print-worker; do
  running_container_id=$(docker compose ps -q "$rollback_service")
  if [ -z "$running_container_id" ]; then
    printf 'Kein laufender Container fuer "%s" gefunden; ueberspringe Sicherung des\n' \
      "$rollback_service" >&2
    printf 'vorigen Abbilds (vermutlich Ersteinrichtung ohne vorherigen Aktualisierungslauf).\n' >&2
    continue
  fi
  running_image_id=$(docker inspect --format '{{.Image}}' "$running_container_id")
  rollback_image_name="${COMPOSE_PROJECT_FOR_ROLLBACK}-${rollback_service}"
  docker tag "$running_image_id" "${rollback_image_name}:previous"
  printf 'Voriges Abbild gesichert: %s:previous (%s)\n' "$rollback_image_name" "$running_image_id"
done

# Migrationsstand ZUM SICHERUNGSZEITPUNKT festhalten, fuer den Rueckweg
# (scripts/ops/rollback.sh). WARUM NICHT einfach der Bauzeitpunkt des
# gesicherten Abbilds selbst: Ein frisch gebautes Abbild durchlaeuft seine
# EIGENE erste automatische Migration erst beim ERSTEN Start danach - ihr
# Zeitpunkt liegt also praktisch immer NACH dem Bauzeitpunkt des Abbilds,
# selbst wenn seither nie wieder migriert wurde. Ein Vergleich "juengste
# Migration neuer als Abbild-Bauzeitpunkt" waere deshalb fast immer wahr und
# damit wertlos. Festgehalten wird stattdessen der Migrationsstand IN DEM
# AUGENBLICK, in dem dieses Abbild zum Vorgaenger wird (jetzt, vor dem
# Neubau) - der Rueckweg vergleicht spaeter den DANN aktuellen Stand
# dagegen. Abgelegt wird das in einer eigenen, winzigen Tabelle in Postgres
# (nicht im "state_data"-Volume, das nur ueber das Backend erreichbar waere,
# und nicht in "backup_data", das der Sicherungsverwaltung des Backends
# gehoert): "postgres" laeuft unabhaengig davon, wie kaputt backend nach
# Schritt 4 ist, und braucht dafuer kein zusaetzliches Abbild.
step="Migrationsstand zum Sicherungszeitpunkt festhalten (#201)"
docker compose exec -T postgres psql --no-psqlrc --set=ON_ERROR_STOP=1 \
  -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-vereinorder}" \
  --command='CREATE TABLE IF NOT EXISTS "_vereinorder_rollback_marker" (
    id boolean PRIMARY KEY DEFAULT true,
    captured_at timestamptz NOT NULL,
    last_migration_finished_at timestamptz,
    CONSTRAINT _vereinorder_rollback_marker_single_row CHECK (id)
  )' \
  --command='INSERT INTO "_vereinorder_rollback_marker" (id, captured_at, last_migration_finished_at)
    VALUES (true, now(), (SELECT MAX(finished_at) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL))
    ON CONFLICT (id) DO UPDATE SET
      captured_at = EXCLUDED.captured_at,
      last_migration_finished_at = EXCLUDED.last_migration_finished_at' >/dev/null

# --- 4. Neubau: der Entrypoint migriert dabei automatisch (#199, Punkt 4) --
step="Neubau (docker compose up -d --build)"
docker compose up -d --build

# --- 5. Auf ein wieder antwortendes Backend warten, mit Zeitgrenze --------
# GET /maintenance ist auf Klassenebene @MaintenancePublic() (siehe
# apps/backend/src/maintenance/maintenance.controller.ts) und antwortet
# deshalb auch waehrend LOCKED ohne Anmeldung - anders als praktisch jede
# andere Route, die der globale MaintenanceGuard bei LOCKED mit 503
# abweist. Derselbe Endpunkt dient bereits oben (Schritt "Auf
# Wartungsphase LOCKED warten") als Beleg dafuer.
step="Auf antwortendes Backend nach dem Neubau warten"
elapsed=0
ready=0
while [ "$elapsed" -lt "$UPGRADE_READY_TIMEOUT_SECONDS" ]; do
  if curl --fail --silent --show-error --max-time 5 "${API_BASE_URL}/maintenance" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep "$UPGRADE_READY_POLL_SECONDS"
  elapsed=$((elapsed + UPGRADE_READY_POLL_SECONDS))
done
if [ "$ready" -ne 1 ]; then
  printf 'Backend antwortet nach dem Neubau nicht innerhalb von %s Sekunden.\n' \
    "$UPGRADE_READY_TIMEOUT_SECONDS" >&2
  printf 'Moegliche Ursache: "prisma migrate deploy" im Entrypoint ist fehlgeschlagen\n' >&2
  printf 'und der Container haengt in der Neustartschleife ("restart: always",\n' >&2
  printf 'docker-compose.yml:26). Containerprotokoll des Backends (letzte 200 Zeilen):\n' >&2
  docker compose logs --no-color --tail 200 backend >&2 || true
  exit 12
fi

# --- 6. Migrationsstand zur Kontrolle ---------------------------------------
# Gegen den bereits laufenden Container aus Schritt 4, siehe Begruendung im
# Dateikopf, warum die vormaligen "docker compose run"-Aufrufe entfallen.
step="Migrationsstand pruefen (prisma migrate status)"
docker compose exec -T backend \
  pnpm --filter @vereinorder/database exec prisma migrate status

# --- 7. Wartungsmodus beenden ------------------------------------------------
step="Wartungsmodus beenden (POST /maintenance/end)"
# "set +e" rund um genau diesen Aufruf, NICHT "if ! curl ...; then": "!"
# negiert den Exitstatus der Pipeline selbst, und "$?" liefert im
# "then"-Zweig danach 0 (den Status der bereits negierten Pipeline), nicht
# den tatsaechlichen Fehlercode von curl - ein lokaler Testlauf gegen ein
# echtes Docker-Buendel (Sonderfall #199 Punkt 2, fehlender JWT_SECRET) hat
# genau das aufgedeckt: das Skript waere mit Exitcode 0 durchgelaufen, obwohl
# "maintenance/end" mit 401 fehlgeschlagen war - das System waere als
# scheinbar erfolgreich entsperrt gemeldet worden, dabei ist es tatsaechlich
# WEITER gesperrt.
set +e
curl --fail --silent --show-error --request POST --header "$AUTH_HEADER" \
  "${API_BASE_URL}/maintenance/end" >/dev/null
end_status=$?
set -e
if [ "$end_status" -ne 0 ]; then
  if [ "$legacy_jwt_secret_risk" -eq 1 ]; then
    printf '\n' >&2
    printf '=== ADMIN_TOKEN wurde ungueltig (angekuendigter Sonderfall) ===\n' >&2
    printf 'Wie oben gewarnt: Der Neubau hat einen neuen JWT_SECRET erzeugt, das\n' >&2
    printf 'eingangs geholte ADMIN_TOKEN ist seither ungueltig. PRE_MIGRATION-Sicherung\n' >&2
    printf 'und Migration sind bereits erfolgreich abgeschlossen - nur dieser letzte,\n' >&2
    printf 'an das alte Token gebundene Schritt ist gescheitert.\n' >&2
    printf '\n' >&2
    printf 'Weg heraus:\n' >&2
    printf '  1. Neu anmelden (POST %s/auth/login) und ein frisches ADMIN_TOKEN holen.\n' \
      "$API_BASE_URL" >&2
    printf '  2. Wartungsmodus damit beenden:\n' >&2
    printf '       curl --fail -X POST -H "Authorization: Bearer <neues Token>" \\\n' >&2
    printf '         %s/maintenance/end\n' "$API_BASE_URL" >&2
    printf '  3. Danach JWT_SECRET dauerhaft setzen (z. B. in der .env), damit dieser\n' >&2
    printf '     Fall bei kuenftigen Aktualisierungen nicht erneut auftritt.\n' >&2
  fi
  exit "$end_status"
fi

printf 'Update mit PRE_MIGRATION-Sicherung erfolgreich abgeschlossen.\n'
