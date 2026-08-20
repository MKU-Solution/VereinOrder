#!/bin/bash
# VereinOrder - Automatisches PostgreSQL Backup Script
set -e

BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/vereinorder_db_${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "📦 Erstelle VereinOrder Datenbank-Backup: $BACKUP_FILE"

if [ -n "$DOCKER_CONTAINER" ]; then
  docker exec -t vereinorder_postgres pg_dump -U postgres VereinOrder_test | gzip > "$BACKUP_FILE"
else
  pg_dump -U postgres -d VereinOrder_test | gzip > "$BACKUP_FILE"
fi

# Checksumme berechnen
sha256sum "$BACKUP_FILE" > "${BACKUP_FILE}.sha256"

echo "✅ Backup erfolgreich erstellt: $BACKUP_FILE"
echo "Prüfsumme: $(cat "${BACKUP_FILE}.sha256")"
