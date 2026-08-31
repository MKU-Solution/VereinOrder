#!/bin/sh
set -eu

API_BASE_URL="${API_BASE_URL:-http://127.0.0.1:3000}"
: "${ADMIN_TOKEN:?ADMIN_TOKEN mit einem aktuellen Administrator-Token ist erforderlich}"
AUTH_HEADER="Authorization: Bearer ${ADMIN_TOKEN}"
command -v jq >/dev/null 2>&1 || {
  printf 'Fehlendes Werkzeug: jq\n' >&2
  exit 3
}
command -v docker >/dev/null 2>&1 || {
  printf 'Fehlendes Werkzeug: docker\n' >&2
  exit 3
}

curl --fail --silent --show-error --request POST \
  --header "$AUTH_HEADER" --header 'Content-Type: application/json' \
  --data '{"reason":"Softwareaktualisierung mit PRE_MIGRATION-Sicherung"}' \
  "${API_BASE_URL}/maintenance/start" >/dev/null

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

curl --fail --silent --show-error --request POST --header "$AUTH_HEADER" \
  "${API_BASE_URL}/backup/pre-migration" >/dev/null

# SKIP_AUTO_MIGRATE=1 haelt den Entrypoint (#172, apps/backend/docker-entrypoint.sh)
# davon ab, hier zusaetzlich selbst zu migrieren - er wuerde sonst vor dem
# untenstehenden, ausdruecklich uebergebenen Befehl laufen und "migrate
# deploy" doppelt ausfuehren. "set -eu" am Kopf dieses Skripts sorgt weiterhin
# dafuer, dass ein Fehlschlag von "docker compose run" (z. B. weil die
# Migration fehlschlaegt) das Skript sofort abbricht, bevor "maintenance/end"
# erreicht wird.
docker compose run --rm --no-deps -e SKIP_AUTO_MIGRATE=1 backend \
  pnpm --filter @vereinorder/database exec prisma migrate deploy
docker compose run --rm --no-deps -e SKIP_AUTO_MIGRATE=1 backend \
  pnpm --filter @vereinorder/database exec prisma migrate status

curl --fail --silent --show-error --request POST --header "$AUTH_HEADER" \
  "${API_BASE_URL}/maintenance/end" >/dev/null
printf 'Update mit PRE_MIGRATION-Sicherung erfolgreich abgeschlossen.\n'
