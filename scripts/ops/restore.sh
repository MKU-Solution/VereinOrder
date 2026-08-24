#!/bin/sh
set -eu

if [ "$#" -ne 2 ]; then
  printf 'Verwendung: %s <dump.dump> <dump.manifest.json>\n' "$0" >&2
  exit 2
fi

DUMP_FILE="$1"
MANIFEST_FILE="$2"
LIVE_DATABASE="${POSTGRES_DB:-vereinorder}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
STATE_DIR="${STATE_DIR:-./state}"

for tool in jq sha256sum pg_restore pg_dump psql; do
  command -v "$tool" >/dev/null 2>&1 || {
    printf 'Fehlendes Werkzeug: %s\n' "$tool" >&2
    exit 3
  }
done

[ -f "$DUMP_FILE" ] || { printf 'Dump nicht gefunden.\n' >&2; exit 4; }
[ -f "$MANIFEST_FILE" ] || { printf 'Manifest nicht gefunden.\n' >&2; exit 4; }
case "$LIVE_DATABASE" in
  vereinorder|vereinorder_[a-z0-9_]*) ;;
  *) printf 'Unsicherer POSTGRES_DB-Name.\n' >&2; exit 5 ;;
esac

KIND=$(jq -er '.kind' "$MANIFEST_FILE")
MANIFEST_VERSION=$(jq -er '.manifestVersion' "$MANIFEST_FILE")
CREATED_AT=$(jq -er '.createdAt' "$MANIFEST_FILE")
EXPECTED_DUMP=$(jq -er '.dumpFile' "$MANIFEST_FILE")
EXPECTED_SHA=$(jq -er '.dumpSha256' "$MANIFEST_FILE")

[ "$KIND" = "VEREINORDER_DB_BACKUP" ] || {
  printf 'Unbekannte Sicherungsart.\n' >&2; exit 6;
}
[ "$MANIFEST_VERSION" = "1" ] || {
  printf 'Unbekannte Manifestversion.\n' >&2; exit 6;
}
[ "$(basename "$DUMP_FILE")" = "$EXPECTED_DUMP" ] || {
  printf 'Dump und Manifest gehören nicht zusammen.\n' >&2; exit 6;
}
ACTUAL_SHA=$(sha256sum "$DUMP_FILE" | awk '{print $1}')
[ "$ACTUAL_SHA" = "$EXPECTED_SHA" ] || {
  printf 'SHA-256-Prüfsumme stimmt nicht.\n' >&2; exit 6;
}
pg_restore --list "$DUMP_FILE" >/dev/null

printf 'Sicherungszeitpunkt exakt eingeben: %s\n> ' "$CREATED_AT"
IFS= read -r CONFIRMATION
[ "$CONFIRMATION" = "$CREATED_AT" ] || {
  printf 'Bestätigung stimmt nicht exakt.\n' >&2; exit 7;
}

TOKEN=$(printf '%s' "$EXPECTED_SHA" | cut -c1-16)
STAGED_DATABASE="vereinorder_restore_${TOKEN}"
PREVIOUS_DATABASE="vereinorder_pre_${TOKEN}"
mkdir -p "$BACKUP_DIR"
mkdir -p "$STATE_DIR"
SAFETY_DUMP="${BACKUP_DIR}/vereinorder_$(date -u +%Y-%m-%dT%H-%M-%S.000Z)_prerestore.dump"
STATE_FILE="${STATE_DIR}/restore-swap-state.json"

exists_database() {
  psql --no-psqlrc --set=ON_ERROR_STOP=1 --dbname=postgres --tuples-only \
    --no-align --command="SELECT 1 FROM pg_database WHERE datname = '$1'" |
    grep -qx 1
}

if exists_database "$LIVE_DATABASE" && ! exists_database "$STAGED_DATABASE" && ! exists_database "$PREVIOUS_DATABASE"; then
  pg_dump --format=custom --compress=6 --no-owner --no-privileges \
    --file="$SAFETY_DUMP" --dbname="$LIVE_DATABASE"
  pg_restore --list "$SAFETY_DUMP" >/dev/null
  sha256sum "$SAFETY_DUMP" >"${SAFETY_DUMP}.sha256"
  psql --no-psqlrc --set=ON_ERROR_STOP=1 --dbname=postgres \
    --command="CREATE DATABASE \"${STAGED_DATABASE}\" TEMPLATE template0"
  pg_restore --dbname="$STAGED_DATABASE" --single-transaction --exit-on-error \
    --no-owner --no-privileges "$DUMP_FILE"
  jq -r '.countsAfter | to_entries[] | [.key, (.value|tostring)] | @tsv' \
    "$MANIFEST_FILE" | while IFS="$(printf '\t')" read -r table expected; do
      printf '%s' "$table" | grep -Eq '^[A-Za-z_][A-Za-z0-9_]*$' || {
        printf 'Unsicherer Tabellenname im Manifest.\n' >&2
        exit 9
      }
      actual=$(psql --no-psqlrc --set=ON_ERROR_STOP=1 \
        --dbname="$STAGED_DATABASE" --tuples-only --no-align \
        --command="SELECT COUNT(*) FROM \"${table}\"")
      [ "$actual" = "$expected" ] || {
        printf 'Tabellenzählung für %s weicht ab.\n' "$table" >&2
        exit 9
      }
    done
  invalid_fk=$(psql --no-psqlrc --set=ON_ERROR_STOP=1 \
    --dbname="$STAGED_DATABASE" --tuples-only --no-align \
    --command="SELECT COUNT(*) FROM pg_constraint WHERE contype = 'f' AND NOT convalidated")
  [ "$invalid_fk" = "0" ] || {
    printf 'Nicht validierte Fremdschlüssel gefunden.\n' >&2; exit 9;
  }
  ACTIVE_SESSIONS=$(psql --no-psqlrc --set=ON_ERROR_STOP=1 \
    --dbname="$LIVE_DATABASE" --tuples-only --no-align \
    --command='SELECT COUNT(*) FROM "CashierSession" WHERE status = '\''ACTIVE'\''')
  REQUESTED_AT=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
  jq -n \
    --arg swapId "$TOKEN" \
    --arg live "$LIVE_DATABASE" \
    --arg staged "$STAGED_DATABASE" \
    --arg previous "$PREVIOUS_DATABASE" \
    --arg requestedAt "$REQUESTED_AT" \
    --arg filename "$EXPECTED_DUMP" \
    --arg createdAt "$CREATED_AT" \
    --arg checksum "$EXPECTED_SHA" \
    --arg safety "$(basename "$SAFETY_DUMP")" \
    --argjson activeSessions "$ACTIVE_SESSIONS" \
    '{version:1, swapId:$swapId, phase:"REQUESTED", liveDatabase:$live,
      stagedDatabase:$staged, previousDatabase:$previous,
      requestedAt:$requestedAt, context:{backupFilename:$filename,
      backupCreatedAt:$createdAt, backupChecksumSha256:$checksum,
      safetyBackupFilename:$safety, requestedByUserId:"technical-emergency",
      requestedByUsername:"Technischer Notfallweg",
      activeCashierSessions:$activeSessions}}' >"${STATE_FILE}.tmp"
  mv "${STATE_FILE}.tmp" "$STATE_FILE"
fi

if exists_database "$STAGED_DATABASE" && [ ! -f "$STATE_FILE" ]; then
  printf 'Vorbereitete Datenbank ohne Zustandsdatei gefunden; keine Umschaltung ausgeführt.\n' >&2
  exit 8
fi

if exists_database "$LIVE_DATABASE" && exists_database "$STAGED_DATABASE" && ! exists_database "$PREVIOUS_DATABASE"; then
  psql --no-psqlrc --set=ON_ERROR_STOP=1 --dbname=postgres \
    --command="SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${LIVE_DATABASE}' AND pid <> pg_backend_pid()" \
    --command="ALTER DATABASE \"${LIVE_DATABASE}\" RENAME TO \"${PREVIOUS_DATABASE}\""
  jq '.phase = "LIVE_RENAMED"' "$STATE_FILE" >"${STATE_FILE}.tmp"
  mv "${STATE_FILE}.tmp" "$STATE_FILE"
fi

if ! exists_database "$LIVE_DATABASE" && exists_database "$STAGED_DATABASE" && exists_database "$PREVIOUS_DATABASE"; then
  psql --no-psqlrc --set=ON_ERROR_STOP=1 --dbname=postgres \
    --command="ALTER DATABASE \"${STAGED_DATABASE}\" RENAME TO \"${LIVE_DATABASE}\""
  jq '.phase = "SWAPPED"' "$STATE_FILE" >"${STATE_FILE}.tmp"
  mv "${STATE_FILE}.tmp" "$STATE_FILE"
fi

if exists_database "$LIVE_DATABASE" && ! exists_database "$STAGED_DATABASE" && exists_database "$PREVIOUS_DATABASE"; then
  printf 'Wiederherstellung abgeschlossen. Rückfalldatenbank: %s\n' "$PREVIOUS_DATABASE"
  printf 'Backend neu starten, fachlich prüfen und erst danach die Rückfalldatenbank entfernen.\n'
  exit 0
fi

printf 'Unplausible Datenbanklage; keine weitere Änderung ausgeführt.\n' >&2
exit 8
