# Multi-Stage Dockerfile for VereinOrder Backend (ARM64 / AMD64)
FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm and openssl for Prisma
RUN npm install -g pnpm
RUN apk add --no-cache openssl

# Copy monorepo package manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/database/package.json ./packages/database/
COPY apps/backend/package.json ./apps/backend/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy schema and generate Prisma Client
COPY packages/database ./packages/database
RUN pnpm --filter @vereinorder/database run build

# Copy backend source and build
COPY apps/backend ./apps/backend
RUN pnpm --filter @vereinorder/backend run build

# Production Stage
FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache openssl

RUN npm install -g pnpm

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/database/package.json ./packages/database/
COPY apps/backend/package.json ./apps/backend/

RUN pnpm install --prod --frozen-lockfile

COPY --from=builder /app/packages/database ./packages/database
COPY --from=builder /app/apps/backend/dist ./apps/backend/dist

# Create backup directory
RUN mkdir -p /app/backups

EXPOSE 3000

CMD ["node", "apps/backend/dist/main"]
