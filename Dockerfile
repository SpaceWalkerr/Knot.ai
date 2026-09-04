# Single service: Fastify server (run via tsx) that also serves the built web app.
FROM node:20-bookworm-slim

# better-sqlite3 is a native module — needs a toolchain to compile at install time.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first (better layer caching). NODE_ENV is unset here so devDeps
# (vite, the web toolchain) are installed for the build step below.
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/
RUN npm ci --no-audit --fund=false

# Source + build the web bundle into apps/web/dist
COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787

# Server runs straight from TS via tsx — no server build step, @knot/shared stays source.
CMD ["npm", "run", "start"]
