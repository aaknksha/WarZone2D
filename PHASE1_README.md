# WARZONE 2D — Option B, Phase 1 scaffold


## Run locally
1. Install Docker Desktop (Linux containers mode).
2. Copy `.env.full.example` to `.env`; replace `POSTGRES_PASSWORD` with a long random value. Do not commit `.env`.
3. From the project root run `docker compose -f docker-compose.full.yml up --build -d`.
4. Open `http://localhost:8080`; check `http://localhost:8080/health` and `http://localhost:8080/api/health`.
5. Inspect logs: `docker compose -f docker-compose.full.yml logs --tail=100`.
6. Stop: `docker compose -f docker-compose.full.yml down` (do not add `-v` unless you intend to delete data).

## What works / what does not
- The original Phaser client and original Socket.IO game server are preserved. The game still uses **in-memory** rooms and disconnects are not yet recoverable.
- New PostgreSQL tables exist and the API can query the leaderboard; the game does **not yet write** match results to the database.
- Redis is running but game-server session state is **not yet integrated** with Redis.
- Caddy routes `/socket.io` to the game, `/api` to the API, and `/` to the frontend.
- Local HTTP only. To use automatic HTTPS, point a real domain to the VM, configure `SITE_ADDRESS=your-domain`, expose 80/443, and change the proxy port bindings accordingly.
- This is single-VM Compose. Multi-VM scaling, secure accounts, persistent reconnect tokens, and restart-safe matches are **future phases**.

## Security notes
Only the proxy is published to the host; Postgres and Redis stay private on the Compose network. Use a unique database password. The `/api/leaderboard` endpoint is public and read-only. Add authentication and authorization before exposing account or write endpoints.

## Verification
`docker compose -f docker-compose.full.yml config` checks configuration; `docker compose -f docker-compose.full.yml ps` shows running services. No live Docker build has been performed in this environment.
