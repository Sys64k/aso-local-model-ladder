# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# deps: install all dependencies (dev deps are needed for `next build`)
# ---------------------------------------------------------------------------
FROM node:22-alpine AS deps
# libc6-compat helps prebuilt native binaries (e.g. SWC) run on musl
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---------------------------------------------------------------------------
# build: compile the Next.js app into a standalone server
# ---------------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# `public/` is optional; make sure it exists so the runner COPY never fails.
RUN mkdir -p public && npm run build

# ---------------------------------------------------------------------------
# runner: minimal image with only the standalone output
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 --ingroup nodejs nextjs

COPY --from=build --chown=nextjs:nodejs /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q --spider "http://127.0.0.1:${PORT}/" || exit 1

CMD ["node", "server.js"]
