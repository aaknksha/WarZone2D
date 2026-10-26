# syntax=docker/dockerfile:1
# Build context is the repository root (the client and server both import ./shared).

# ---- stage 1: build the browser client ----
FROM node:22-alpine AS client-build
WORKDIR /app
COPY client/package.json client/package-lock.json* ./client/
RUN cd client && (if [ -f package-lock.json ]; then npm ci; else npm install; fi)
COPY shared ./shared
COPY client ./client
RUN cd client && npm run build

# ---- stage 2: runtime (server + built client on one port) ----
FROM node:22-alpine AS runtime
ENV NODE_ENV=production PORT=3000 CLIENT_DIST=/app/client/dist
WORKDIR /app
# root package.json marks ./shared as ES modules for Node
COPY package.json ./
COPY server/package.json server/package-lock.json* ./server/
RUN cd server && (if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi)
COPY shared ./shared
COPY server ./server
COPY --from=client-build /app/client/dist ./client/dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health >/dev/null || exit 1
WORKDIR /app/server
CMD ["node", "src/index.ts"]
