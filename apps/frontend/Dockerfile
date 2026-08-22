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

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
