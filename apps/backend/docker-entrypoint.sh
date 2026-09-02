#!/bin/sh
# Entrypoint des Backend-Abbilds (#172).
#
# Vor dem Start der Anwendung wird das Datenbankschema auf den aktuellen
# Migrationsstand gebracht. Ohne diesen Schritt bleibt die Datenbank nach
# "docker compose up -d" leer - siehe Befund B20 in
# docs/development/datensicherung.md:930 und die Auswertung in #172.
set -eu

# --- Unprivilegierte Laufzeit (#180) ---------------------------------------
# Bis hierher lief das Backend als root - einschliesslich voller Schreibrechte
# auf die Sicherungen im Volume 'vereinorder_backup_data', also auf genau die
# Daten, die den Ernstfall ueberstehen sollen.
#
# Dieser Abschnitt laeuft VOR allem anderen, insbesondere vor
# 'ensure-secrets.cli.js': Der Schluessel unter STATE_DIR entsteht mit den
# Rechten 0600 (apps/backend/src/secrets/ensure-secrets.ts). Wuerde er noch
# als root geschrieben, koennte ihn danach weder die Anwendung selbst noch
# der Print-Worker im Nachbarcontainer lesen.
#
# Zwei Faelle, unterschieden ueber die eigene Uid:
#
#   root  - der Regelfall aus docker-compose.yml. Die beiden Volumes werden
#           angeglichen, danach wechselt der Prozess auf 'node'.
#   sonst - der Container wurde bereits unprivilegiert gestartet (etwa ueber
#           'docker compose run --user'). Dann ist nichts anzugleichen, und
#           das Skript laeuft unveraendert weiter.
vereinorder_runtime_user=node

if [ "$(id -u)" = "0" ]; then
  vereinorder_runtime_uid="$(id -u "$vereinorder_runtime_user")"

  # Einmalige Uebereignung bestehender Volumes. Ein FRISCHES benanntes Volume
  # uebernimmt Eigentuemer und Rechte aus dem Abbild (apps/backend/Dockerfile:
  # 'mkdir -p /app/backups /app/state && chown node:node ...') und ist hier
  # bereits richtig - die Schleife sieht dann nur nach und tut nichts. Ein
  # VORHANDENES Volume aus der Zeit vor #180 gehoert dagegen root; nur dieser
  # Fall loest das rekursive 'chown' aus, und danach nie wieder, weil das
  # Verzeichnis anschliessend dem Laufzeitbenutzer gehoert.
  for vereinorder_dir in "${BACKUP_DIR:-/app/backups}" "${STATE_DIR:-/app/state}"; do
    [ -d "$vereinorder_dir" ] || mkdir -p "$vereinorder_dir"
    if [ "$(stat -c '%u' "$vereinorder_dir")" != "$vereinorder_runtime_uid" ]; then
      printf 'docker-entrypoint: uebereigne %s an %s (einmalig, #180).\n' \
        "$vereinorder_dir" "$vereinorder_runtime_user"
      chown -R "${vereinorder_runtime_user}:${vereinorder_runtime_user}" \
        "$vereinorder_dir"
    fi
  done

  # HOME zeigt als root auf /root. pnpm - weiter unten fuer
  # 'prisma migrate deploy' aufgerufen - wertet HOME aus; nach dem Wechsel auf
  # 'node' waere /root unerreichbar. Das entpackte pnpm selbst liegt seit #180
  # unter COREPACK_HOME=/opt/corepack und ist fuer alle lesbar.
  HOME="$(getent passwd "$vereinorder_runtime_user" | cut -d: -f6)"
  export HOME

  # 'su-exec' statt 'su': es ERSETZT den eigenen Prozess, statt einen
  # Kindprozess unter einer Login-Shell zu starten. Nur so bleibt PID 1 der
  # Anwendungsprozess, und nur so bleibt das abschliessende 'exec' am
  # Dateiende wirksam - sonst kaeme kein Signal mehr unveraendert bei der
  # Anwendung an (RESTORE_EXIT_AFTER_SWAP).
  printf 'docker-entrypoint: wechsle auf den Benutzer %s (uid %s).\n' \
    "$vereinorder_runtime_user" "$vereinorder_runtime_uid"
  exec su-exec "${vereinorder_runtime_user}:${vereinorder_runtime_user}" \
    "$0" "$@"
fi


# --- Sicherheitsgeheimnisse (#175) -----------------------------------------
# Vor allem anderen, auch vor der Migration: Der Print-Worker startet
# parallel und braucht die Tokendatei so frueh wie moeglich.
#
# Warum hier und nicht in der Anwendung: JWT_SECRET wird zur MODUL-Ladezeit
# gelesen (apps/backend/src/auth/auth.module.ts,
# .../maintenance/maintenance.module.ts), also bereits waehrend
# "require(app.module)" und damit vor der ersten Zeile von bootstrap().
# Ein eigener Prozessschritt vor "exec" kann durch keine Umsortierung von
# Importen zu spaet kommen. Die Rangfolge (Umgebung > Datei > Neuerzeugung)
# steht einmalig in apps/backend/src/secrets/ensure-secrets.ts; das Programm
# unten legt nur fehlende Dateien an und gibt KEINEN Wert auf stdout aus.
printf 'docker-entrypoint: pruefe Sicherheitsgeheimnisse unter STATE_DIR.\n'
node apps/backend/dist/secrets/ensure-secrets.cli.js

# Dieselbe Vorgabe wie in ensure-secrets.ts und maintenance-state.service.ts:
# STATE_DIR, sonst <Arbeitsverzeichnis>/state.
vereinorder_state_dir="${STATE_DIR:-$(pwd)/state}"

# Spiegelt Rang 1 der Rangfolge: Eine gesetzte Umgebungsvariable gewinnt,
# dann wird nichts aus der Datei nachgeladen (und oben auch keine
# geschrieben). Nur wenn sie leer ist, kommt der erzeugte Wert zum Zug.
if [ -z "${JWT_SECRET:-}" ] && [ -r "${vereinorder_state_dir}/jwt-secret" ]; then
  JWT_SECRET="$(cat "${vereinorder_state_dir}/jwt-secret")"
  export JWT_SECRET
fi
if [ -z "${PRINT_WORKER_TOKEN:-}" ] &&
  [ -r "${vereinorder_state_dir}/print-worker-token" ]; then
  PRINT_WORKER_TOKEN="$(cat "${vereinorder_state_dir}/print-worker-token")"
  export PRINT_WORKER_TOKEN
fi

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
