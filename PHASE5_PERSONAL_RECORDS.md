# Phase 5: Personal Match History & Opponent Leaderboard

- `/api/matches` returns only completed matches where the signed-in user participated. Includes players in each match.
- `/api/leaderboard` lists all authenticated players who participated in any of the signed-in user’s matches, including the signed-in user. Aggregates only shared matches.
- Match scores are linked to verified account UUIDs at Socket.IO connection time; display names are not trusted.
- `/api/auth/profile` statistics increment once for each newly saved match.
- Existing Phase 2 records with NULL user_id cannot be attributed reliably and will not appear. Play new matches after installing this update.
- Rebuild frontend, game, and API together: `docker compose -f docker-compose.full.yml up -d --build`. Preserve existing `.env` and database volumes.
- For test sessions, each player must register and log in separately (use a different browser profile/incognito window).
- Production hardening: session revocation for already connected sockets, multi-instance authoritative identity persistence, and secure HTTPS deployment still require further work.
