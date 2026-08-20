#!/bin/bash
# VereinOrder - PostgreSQL Wiederherstellungs-Script
set -e

if [ -z "$1" ]; then
  echo "Verwendung: ./restore.sh <pfad-zu-backup-datei.sql.gz>"
  exit 1
fi

BACKUP_FILE="$1"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "❌ Fehler: Datei $BACKUP_FILE nicht gefunden!"
  exit 1
fi

echo "⚠️  WARNUNG: Dies überschreibt die aktuelle Datenbank mit $BACKUP_FILE!"
read -p "Möchtest du wirklich fortfahren? (j/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Jj]$ ]]; then
  echo "Wiederherstellung abgebrochen."
  exit 1
fi

echo "🔄 Stelle Datenbank wieder her..."

if [ -n "$DOCKER_CONTAINER" ]; then
  gunzip -c "$BACKUP_FILE" | docker exec -i vereinorder_postgres psql -U postgres -d VereinOrder_test
else
  gunzip -c "$BACKUP_FILE" | psql -U postgres -d VereinOrder_test
fi

echo "✅ Wiederherstellung erfolgreich abgeschlossen!"
