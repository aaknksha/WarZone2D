# WARZONE 2D — Phase 3B checkpoint prototype

Built on the working Phase 3A Refresh Fix. Redis writes full authoritative game-room checkpoints every ~2 seconds, with a 1-hour TTL, and reloads them on game-process startup. It preserves internal simulation state including health, scores, projectiles, respawn timing, and room membership. The original browser reconnect behavior remains in place. Use the same `.env` as Phase 3A.

## Local test

1. Stop the old deployment with `docker compose -f docker-compose.full.yml down` (do NOT use `-v`).
2. Extract this ZIP and copy your existing `.env` into the new `warzone2d` folder.
3. Run `docker compose -f docker-compose.full.yml up --build -d`.
4. Start a two-player match; wait at least 5 seconds.
5. Run `docker compose -f docker-compose.full.yml exec redis redis-cli EXISTS warzone:game:local:v1` (expect `1`).
6. Run `docker compose -f docker-compose.full.yml restart game`.
7. Check `docker compose -f docker-compose.full.yml logs game --tail=40` for `redis checkpoint restored`.
8. Reload both browsers promptly; they should reconnect to the recovered match if the match has not finished.

## Limitations — important

- **Single game-server owner only.** Never run two game processes using the same checkpoint key. This is NOT safe for an autoscaled multi-game-server MIG: ownership locks, fencing, routing, and coordinated failover are not implemented.
- Checkpoints are asynchronous, so up to roughly 2 seconds of progress can be lost after a crash. If the game container restarts while the match is active, clients will temporarily disconnect and need to reconnect.
- A match can expire while clients are absent; normal disconnect grace-period behavior applies.
- Redis must remain available. This simple RESP client supports unauthenticated `redis://` on DB 0 only; for production use a supported Redis client with TLS, auth, reconnect and backoff.
- No automatic load-balancer draining or VM failover. These remain separate implementation stages.
- The prototype has not been verified in a live multiplayer Docker test in this environment.
