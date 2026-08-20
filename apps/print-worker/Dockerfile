# Multi-Stage Dockerfile for VereinOrder Print-Worker
FROM node:20-alpine AS builder

WORKDIR /app

RUN npm install -g pnpm

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/print-worker/package.json ./apps/print-worker/

RUN pnpm install --frozen-lockfile

COPY apps/print-worker ./apps/print-worker
RUN pnpm --filter @vereinorder/print-worker run build

# Production Stage
FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

RUN npm install -g pnpm

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/print-worker/package.json ./apps/print-worker/

RUN pnpm install --prod --frozen-lockfile

COPY --from=builder /app/apps/print-worker/dist ./apps/print-worker/dist

CMD ["node", "apps/print-worker/dist/index.js"]
