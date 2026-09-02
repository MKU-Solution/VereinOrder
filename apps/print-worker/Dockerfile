# Multi-Stage Dockerfile for VereinOrder Print-Worker
FROM node:20-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/print-worker/package.json ./apps/print-worker/

RUN pnpm install --frozen-lockfile

COPY apps/print-worker ./apps/print-worker
RUN pnpm --filter @vereinorder/print-worker run build

# Production Stage
FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/print-worker/package.json ./apps/print-worker/

RUN pnpm install --prod --frozen-lockfile

COPY --from=builder /app/apps/print-worker/dist ./apps/print-worker/dist

# #180: Der Worker laeuft nicht mehr als root. node:20-alpine bringt den
# unprivilegierten Benutzer "node" (uid 1000) mit; bis hierher blieb er
# ungenutzt, und jeder Fehler im Worker oder in einer seiner Abhaengigkeiten
# lief mit Rootrechten.
#
# Von den drei Abbildern ist dieses das einfachste: Der Worker bindet keinen
# privilegierten Port und schreibt nirgendwo hin. /app gehoert weiterhin root
# und ist fuer "node" nur lesbar - der Worker kann seinen eigenen Programmcode
# damit nicht mehr veraendern.
#
# Nicht unabhaengig vom Backend, anders als in #180 zunaechst angenommen:
# docker-compose.yml haengt das Volume "state_data" hier (nur lesend) ein, und
# der Worker liest daraus das Worker-Token (apps/print-worker/src/token.ts).
# Diese Datei traegt die Rechte 0600 (apps/backend/src/secrets/ensure-secrets.ts)
# und gehoert dem Benutzer, unter dem das BACKEND sie schreibt. Beide Abbilder
# muessen deshalb denselben Benutzer verwenden; liefe hier "node" und dort
# weiter root, koennte der Worker sein Token nicht mehr lesen und der
# PrintWorkerGuard wiese jede seiner Anfragen ab.
USER node

CMD ["node", "apps/print-worker/dist/index.js"]
