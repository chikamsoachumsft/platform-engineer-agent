FROM node:22-alpine AS base

# ── Build stage: server ──────────────────────────────────────────────
FROM base AS build-server
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src/ src/
RUN npx tsc

# ── Build stage: dashboard ───────────────────────────────────────────
FROM base AS build-web
WORKDIR /app/web
COPY web/package.json web/package-lock.json* ./
RUN npm ci --ignore-scripts
COPY web/ .
RUN npm run build

# ── Production stage ─────────────────────────────────────────────────
FROM base AS production
WORKDIR /app

# Only install production dependencies
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts

# Copy compiled server
COPY --from=build-server /app/dist/ dist/

# Copy Bicep templates (needed at runtime for IaC generation)
COPY src/infra-gen/templates/ dist/infra-gen/templates/

# Copy built dashboard
COPY --from=build-web /app/web/dist/ web/dist/

# Non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "dist/index.js"]
