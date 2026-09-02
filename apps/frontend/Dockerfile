# Multi-Stage Dockerfile for VereinOrder Frontend (SPA + Nginx)
FROM node:20-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/frontend/package.json ./apps/frontend/

RUN pnpm install --frozen-lockfile

# Copy and build the shared package (Issue #89: gemeinsame Texte fuer
# fachliche Ablehnungen, die Backend und Frontend uebereinstimmend
# verwenden muessen)
COPY packages/shared ./packages/shared
RUN pnpm --filter @vereinorder/shared run build

COPY apps/frontend ./apps/frontend
RUN pnpm --filter @vereinorder/frontend run build

# Nginx Stage
FROM nginx:alpine AS runner

COPY --from=builder /app/apps/frontend/dist /usr/share/nginx/html
COPY apps/frontend/nginx.conf /etc/nginx/conf.d/default.conf

# #180: Auch der nginx-HAUPTPROZESS laeuft unprivilegiert. nginx:alpine setzt
# von sich aus nur seine Arbeitsprozesse auf den Benutzer 'nginx' herunter;
# der Hauptprozess blieb root, und mit ihm jede Schwachstelle in ihm.
#
# Drei Dinge sind dafuer noetig, alle drei nur wegen der fehlenden
# Rootrechte:
#
#   1. Der Containerport wandert auf 8080 (apps/frontend/nginx.conf) - Ports
#      unter 1024 kann ein unprivilegierter Prozess nicht binden. Am Host
#      bleibt es bei 80, docker-compose.yml bildet 80 auf 8080 ab.
#   2. Die 'user'-Anweisung entfaellt. Sie ergibt nur Sinn, wenn der
#      Hauptprozess Rootrechte hat; nginx wuerde sie sonst bei jedem Start
#      mit einer Warnung uebergehen.
#   3. Die Datei mit der Prozessnummer wandert nach /tmp, und der
#      Zwischenspeicher unter /var/cache/nginx wird uebereignet. Beides liegt
#      im Vorgabezustand unter root-eigenen Verzeichnissen; nginx bricht ohne
#      diese Zeilen bereits beim Start ab.
#
# Die beiden 'grep' pruefen das Ergebnis der Ersetzungen, statt ihnen zu
# vertrauen: Aendert ein kuenftiges nginx:alpine den Aufbau seiner
# nginx.conf, soll der BAU fehlschlagen und nicht der Container im
# Festbetrieb.
#
# Kein Wechsel auf nginxinc/nginx-unprivileged: Das offizielle nginx-Abbild
# bleibt damit die einzige Bezugsquelle des Buendels. Die Alternative haette
# eine zweite Herkunft in eine Installation gebracht, die auf einem Rechner
# ohne Netz betrieben wird.
RUN sed -i -e '/^user  *nginx;/d' \
      -e 's#^pid  *.*#pid /tmp/nginx.pid;#' /etc/nginx/nginx.conf \
  && grep -qx 'pid /tmp/nginx.pid;' /etc/nginx/nginx.conf \
  && ! grep -q '^user' /etc/nginx/nginx.conf \
  && chown -R nginx:nginx /var/cache/nginx

# /usr/share/nginx/html gehoert bewusst weiterhin root und ist fuer 'nginx'
# nur lesbar: Der Webserver hat keinen Grund, die von ihm ausgelieferten
# Dateien zu veraendern.
USER nginx

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
