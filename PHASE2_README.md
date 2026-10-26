# WARZONE 2D — Option B Phase 2

Includes the uploaded v2 game with server-authoritative respawning (3–5 seconds after death, 2 seconds invulnerability) and PostgreSQL-backed match results, match history and name-based leaderboard.

## Upgrade from Phase 1 on Windows
1. Back up your existing `.env` and copy it into this project folder. Do not replace your old project until you have backed it up.
2. Add `INTERNAL_API_SECRET=` with a long randomly generated secret to `.env`. Keep your existing POSTGRES_PASSWORD unchanged to preserve the database.
3. Run `docker compose -f docker-compose.full.yml config --quiet`.
4. Run `docker compose -f docker-compose.full.yml up --build -d`.
5. Run `docker compose -f docker-compose.full.yml ps` and `docker compose -f docker-compose.full.yml logs --tail=50 api game proxy`.
6. Open http://localhost:8080, create a room, join with another browser and finish a match.
7. Check http://localhost:8080/api/health, /api/leaderboard and /api/matches.

Database migration 002 is applied at API startup, including when reusing an existing PostgreSQL volume. Do not use `docker compose down -v`.

## Notes
- A match is stored when it finishes normally, including timer expiry or opponents leaving. The write retries 5 times; it is not yet crash-durable if the API is down throughout retries.
- Player statistics are grouped by display name; accounts and secure identity are not yet implemented. Two people choosing the same name share a leaderboard row.
- The game still uses in-memory live matches; Redis is present for a later reconnect/session-recovery phase.
- Automatic respawning is in the uploaded v2 gameplay source, not a new client-side timer.
