# ══════════════════════════════════════════════════════════════════════════════
#  BAML Risk Intelligence Platform — Frontend Dockerfile
#  Three-stage build:
#    deps     — install npm dependencies (cached unless package-lock changes)
#    builder  — compile the Next.js application
#    runner   — minimal image containing only the standalone server output
#
#  Requires next.config.ts to have `output: 'standalone'`.
# ══════════════════════════════════════════════════════════════════════════════

# ── Stage 1: install dependencies ────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

# Copy only the lockfile and manifest so this layer is cached until they change
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts


# ── Stage 2: build the application ───────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Inherit installed node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy full source
COPY . .

# Disable Next.js telemetry in CI / Docker builds
ENV NEXT_TELEMETRY_DISABLED=1

# BACKEND_URL is used by next.config.ts rewrites at build time.
# Override at runtime via docker-compose or Railway env vars.
ARG BACKEND_URL=http://backend:8000
ENV BACKEND_URL=${BACKEND_URL}

RUN npm run build


# ── Stage 3: minimal production runner ───────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Non-root user
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

# Copy the standalone server (already includes the minimal node_modules subset)
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./

# Copy static assets and public directory separately
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public        ./public

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME=0.0.0.0

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
    CMD wget -qO- http://localhost:3000/ > /dev/null 2>&1 || exit 1

CMD ["node", "server.js"]
