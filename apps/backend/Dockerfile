# Multi-Stage Dockerfile for VereinOrder Backend (ARM64 / AMD64)
FROM node:20-alpine AS builder

WORKDIR /app

# Install pinned pnpm and openssl for Prisma
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
RUN apk add --no-cache openssl

# Copy monorepo package manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/database/package.json ./packages/database/
COPY packages/shared/package.json ./packages/shared/
COPY apps/backend/package.json ./apps/backend/

# Install dependencies
#
# @prisma/client richtet ueber sein eigenes Postinstall ein "prisma generate"
# aus - an dieser Stelle liegt das Schema aber noch nicht im Bau (es kommt
# erst mit der naechsten COPY-Zeile), das Postinstall meldet deshalb
# "prisma:warn We could not find your Prisma schema in the default
# locations" und erzeugt deshalb keinen Client. PRISMA_SKIP_POSTINSTALL_GENERATE
# unterdrueckt genau dieses Postinstall (node_modules/@prisma/client/scripts/
# postinstall.js: "if (!process.env.PRISMA_SKIP_POSTINSTALL_GENERATE)
# { main() ... }").
#
# Uebersprungen wird damit ZUSAETZLICH das "createDefaultGeneratedThrowFiles()"
# am Anfang von main(): Ohne Postinstall fehlt "node_modules/.prisma/client"
# ganz, statt die Stubs zu enthalten, die eine Verwendung vor dem Erzeugen mit
# einer verstaendlichen Meldung abfangen. Das ist hier unschaedlich, aber nur
# aus einem Grund: Der naechste Schritt, der den Client braucht, erzeugt ihn
# vorher selbst. Das ist NICHT am Skriptnamen abzulesen - "run build" von
# @vereinorder/database ist zwar nur "tsc", zieht aber ueber den npm-Hook
# "prebuild" ein "prisma generate" vor (packages/database/package.json). Wer
# diese Reihenfolge aendert, muss die Zeile hier mit aendern.
#
# Nur fuer diese eine Zeile gesetzt, nicht als ENV der Schicht, damit spaetere
# Schritte, die das Generat wirklich brauchen, unberuehrt bleiben.
RUN PRISMA_SKIP_POSTINSTALL_GENERATE=1 pnpm install --frozen-lockfile

# Copy schema and generate Prisma Client
COPY packages/database ./packages/database
RUN pnpm --filter @vereinorder/database run build

# Copy and build the shared package (Issue #89: gemeinsame Texte fuer
# fachliche Ablehnungen, die Backend und Frontend uebereinstimmend
# verwenden muessen)
COPY packages/shared ./packages/shared
RUN pnpm --filter @vereinorder/shared run build

# Copy backend source and build
COPY apps/backend ./apps/backend
RUN pnpm --filter @vereinorder/backend run build

# Production Stage
FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache openssl postgresql16-client su-exec

# #180: corepack legt sein entpacktes pnpm unter $COREPACK_HOME ab, Vorgabe
# ~/.cache/node/corepack. Der Bau laeuft als root, die Anwendung spaeter als
# "node" - ohne diese Zeile laege pnpm unter /root/.cache und waere fuer den
# Laufzeitbenutzer unerreichbar. Der Entrypoint ruft pnpm aber auf
# ("prisma migrate deploy"), und der Festbetrieb hat kein Netz, ueber das
# corepack es nachladen koennte.
ENV COREPACK_HOME=/opt/corepack
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate \
  && chmod -R a+rX /opt/corepack

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/database/package.json ./packages/database/
COPY packages/shared/package.json ./packages/shared/
COPY apps/backend/package.json ./apps/backend/

# Wie im Builder: Das Schema liegt in dieser Schicht erst nach der naechsten
# COPY-Zeile vor, das Postinstall von @prisma/client warnte deshalb hier
# ebenso "prisma:warn We could not find your Prisma schema in the default
# locations". PRISMA_SKIP_POSTINSTALL_GENERATE unterdrueckt das Postinstall
# selbst (siehe Begruendung und Fundstelle beim Builder oben); die
# tatsaechliche, plattformspezifische Erzeugung erfolgt weiter unten
# ausdruecklich und wird dort auch geprueft.
RUN PRISMA_SKIP_POSTINSTALL_GENERATE=1 pnpm install --prod --frozen-lockfile

COPY --from=builder /app/packages/database ./packages/database

# pnpm install runs before the Prisma schema is present in this stage. Generate
# the platform-specific production client after copying the database package;
# otherwise @prisma/client falls back to its ungenerated stub at runtime.
RUN pnpm --filter @vereinorder/database run db:generate \
  && pnpm --filter @vereinorder/backend exec node -e "const { Prisma } = require('@vereinorder/database'); if (typeof Prisma.validator !== 'function') throw new Error('Prisma Client wurde nicht generiert')"

COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/apps/backend/dist ./apps/backend/dist

# #180: Beide Einhaengepunkte im Abbild anlegen UND uebereignen. /app/backups
# entstand bisher als root:root, /app/state gab es im Abbild ueberhaupt nicht
# - Docker legte den Einhaengepunkt beim ersten Start selbst an, ebenfalls als
# root:root. Ein frisch erzeugtes benanntes Volume uebernimmt Eigentuemer und
# Rechte des Verzeichnisses aus dem Abbild; fuer NEUE Installationen ist damit
# alles erledigt. Bestehende Volumes gleicht der Entrypoint an.
RUN mkdir -p /app/backups /app/state \
  && chown node:node /app/backups /app/state

# Entrypoint (#172): fuehrt "prisma migrate deploy" vor dem Anwendungsstart
# aus. Endet mit "exec \"$@\"", damit CMD unveraendert bleibt und Signale
# durchgereicht werden (wichtig fuer RESTORE_EXIT_AFTER_SWAP).
#
# #180: Hier steht bewusst KEIN "USER node", anders als in den beiden anderen
# Abbildern - der Benutzerwechsel liegt im Entrypoint. Der Grund ist die
# Vertraeglichkeit mit bestehenden Installationen: Deren Volumes
# "vereinorder_backup_data" und "vereinorder_state_data" enthalten Dateien,
# die als root entstanden sind. Nur ein Schritt MIT Rootrechten kann sie
# einmalig uebereignen, und er muss vor dem Anwendungsstart liegen. Mit einem
# "USER node" an dieser Stelle wuerde nicht die Neuinstallation scheitern,
# sondern der naechste gewoehnliche Neustart einer bestehenden - mit einem
# Wartungszustand, der sich nicht mehr schreiben laesst, also im
# unguenstigsten denkbaren Augenblick.
#
# Der Entrypoint gleicht die Volumes deshalb als root an und wechselt danach
# ueber "su-exec" dauerhaft auf "node"; der Anwendungsprozess selbst laeuft
# nie mit Rootrechten. Genau dieses Vorgehen verwendet auch das
# PostgreSQL-Abbild dieses Buendels. Nachgewiesen wird es in der CI ueber die
# Uid von PID 1 im laufenden Container, nicht ueber die Abbildmetadaten -
# gemessen wird der Prozess, nicht die Absicht.
COPY apps/backend/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

EXPOSE 3000

CMD ["node", "apps/backend/dist/main"]
