# ---------------------------------------------------------------------------
# Stage 1: Build TypeScript
# ---------------------------------------------------------------------------
FROM node:20-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts

# Install dev deps for build only
RUN npm install --ignore-scripts typescript@5
RUN npx tsc

# ---------------------------------------------------------------------------
# Stage 2: Production image with Chromium
# ---------------------------------------------------------------------------
FROM node:20-slim

# Install Chromium (pulls all required system libraries as dependencies)
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

# Tell puppeteer-core where to find Chromium
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_ENV=production

WORKDIR /app

# Copy production node_modules and compiled JS
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./

# Data directory lives on Railway volume mount (STOCK_TRACKER_HOME=/data)
# No .stock-tracker directory in the image — it's on the persistent volume

EXPOSE 3000

CMD ["node", "dist/src/cli.js", "worker"]
