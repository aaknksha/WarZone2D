# Phase 3A — reconnect grace period (local single game server)

This is an incremental implementation, NOT yet a multi-VM-safe release.

## Added
- Stable per-tab player ID via sessionStorage and Socket.IO auth.
- Reconnects reuse the player ID instead of creating a new member.
- Server delays removing disconnected members for 30 seconds.
- Reconnected players rejoin their room and receive lobby/game snapshot or finished result.
- Respawning and Phase 2 leaderboard/history retained.
- Caddyfile adjusted for local HTTP.

## Test
1. Copy .env from the prior release; do not commit it.
2. `docker compose -f docker-compose.full.yml up --build -d`
3. Open http://localhost:8080 in two separate browser tabs and join the same room.
4. Start match; briefly disconnect network or refresh one tab, reconnect within 30 seconds, verify lobby and state restored.
5. Leave offline for >30 seconds; the player should be removed.
6. Verify /api/leaderboard and /api/matches after completed matches.

## Critical limits before GCP MIG deployment
- Rooms and simulations are still in-memory per game server.
- Redis-backed room ownership, snapshots, and failover are NOT implemented.
- A VM restart or routing to a different VM loses live match state.
- Socket.IO client reconnect may produce a short visible pause.
- Do NOT deploy multiple game server replicas behind a general load balancer yet.
- For secure production sessions, use server-issued signed opaque tokens and session revocation.
- Use shared PostgreSQL and Redis rather than duplicating their Compose containers on each VM.
