#!/bin/sh
# Entrypoint des Backend-Abbilds (#172).
#
# Vor dem Start der Anwendung wird das Datenbankschema auf den aktuellen
# Migrationsstand gebracht. Ohne diesen Schritt bleibt die Datenbank nach
# "docker compose up -d" leer - siehe Befund B20 in
# docs/development/datensicherung.md:930 und die Auswertung in #172.
set -eu

if [ "${SKIP_AUTO_MIGRATE:-0}" = "1" ]; then
  # scripts/ops/upgrade.sh fuehrt "prisma migrate deploy" und
  # "prisma migrate status" fuer ein bestehendes, befuelltes System bereits
  # selbst und ausdruecklich aus - dort erst NACH gesetztem Wartungsmodus und
  # einer frischen PRE_MIGRATION-Sicherung (upgrade.sh:16-40). Ohne dieses
  # Abschalten wuerde die Migration bei jedem "docker compose run"-Aufruf aus
  # upgrade.sh doppelt laufen: einmal hier im Entrypoint und einmal durch den
  # von upgrade.sh selbst uebergebenen Befehl. upgrade.sh setzt diese
  # Variable deshalb gezielt fuer seine eigenen Aufrufe.
  printf 'docker-entrypoint: SKIP_AUTO_MIGRATE=1 gesetzt, automatische Migration wird uebersprungen.\n'
else
  # Kein Warten auf PostgreSQL noetig: docker-compose.yml startet den Dienst
  # "backend" erst, wenn der Dienst "postgres" ueber "condition:
  # service_healthy" als bereit gemeldet wurde (docker-compose.yml:53-55).
  # Ein zusaetzlicher Wartelooop hier waere doppelte Absicherung ohne Nutzen
  # und sollte nicht "sicherheitshalber" nachgeruestet werden.
  printf 'docker-entrypoint: fuehre "prisma migrate deploy" aus.\n'
  if ! pnpm --filter @vereinorder/database exec prisma migrate deploy; then
    # Fehlerstatus statt Weiterlaufens gegen ein halbes Schema: "restart:
    # always" (docker-compose.yml:26) versucht den Start dann erneut.
    printf 'docker-entrypoint: "prisma migrate deploy" fehlgeschlagen, breche ab.\n' >&2
    exit 1
  fi

  printf 'docker-entrypoint: Migrationsstand nach dem Deploy:\n'
  # Bewusst NICHT scharf, anders als "deploy" oben: "migrate status" dient
  # laut #172 nur dazu, den angewandten Stand im Containerprotokoll sichtbar
  # zu machen. Sein Rueckgabewert ist nicht nur bei ausstehenden Migrationen
  # ungleich null, sondern auch bei einer Schema-Abweichung (drift) - etwa
  # nach einer Wiederherstellung ueber apps/backend/src/backup/*, die die
  # Datenbank durch eine Sicherung ersetzt. "deploy" direkt darueber ist zu
  # diesem Zeitpunkt bereits erfolgreich durchgelaufen; wuerde dieser rein
  # informative Aufruf unter "set -eu" das Skript trotzdem abbrechen, stuerbe
  # der Container an einem Protokollbefehl und liefe unter "restart: always"
  # in einer Neustartschleife, obwohl das Schema laengst auf dem
  # gewuenschten Stand ist. "|| true" faengt den Rueckgabewert ab, die
  # Ausgabe von "migrate status" selbst wird trotzdem protokolliert.
  pnpm --filter @vereinorder/database exec prisma migrate status || true
fi

# "exec" ersetzt den Shell-Prozess durch den eigentlichen CMD-Prozess, damit
# Signale (z. B. fuer den kontrollierten Neustart ueber
# RESTORE_EXIT_AFTER_SWAP) unveraendert bei der Anwendung ankommen und
# apps/backend/Dockerfile:65 ("CMD [\"node\", \"apps/backend/dist/main\"]")
# unveraendert bleiben kann.
exec "$@"
