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
RUN pnpm install --frozen-lockfile

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
RUN apk add --no-cache openssl

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/database/package.json ./packages/database/
COPY packages/shared/package.json ./packages/shared/
COPY apps/backend/package.json ./apps/backend/

RUN pnpm install --prod --frozen-lockfile

COPY --from=builder /app/packages/database ./packages/database
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/apps/backend/dist ./apps/backend/dist

# Create backup directory
RUN mkdir -p /app/backups

EXPOSE 3000

CMD ["node", "apps/backend/dist/main"]
