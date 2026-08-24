#!/bin/sh
set -eu

API_BASE_URL="${API_BASE_URL:-http://127.0.0.1:3000}"
: "${ADMIN_TOKEN:?ADMIN_TOKEN mit einem aktuellen Administrator-Token ist erforderlich}"

curl --fail --silent --show-error \
  --request POST \
  --header "Authorization: Bearer ${ADMIN_TOKEN}" \
  "${API_BASE_URL}/backup/create"
printf '\nNative Sicherung wurde über VereinOrder erstellt und auditiert.\n'
