# WARZONE 2D — Phase 2 UI update

New main-menu screens: **LEADERBOARD** and **MATCH HISTORY**, with refresh buttons, loading/error/empty states, responsive scrollable tables. Data is fetched live from `/api/leaderboard` and `/api/matches`; no hardcoded sample data. Existing respawn gameplay is unchanged.

## Windows CMD

1. Extract the ZIP, open `warzone2d` in VS Code.
2. Copy your existing `.env` from Phase 2 (retain POSTGRES_PASSWORD and INTERNAL_API_SECRET).
3. Stop the older Compose project first if it is running on port 8080.
4. Run `docker compose -f docker-compose.full.yml up --build -d`.
5. Visit http://localhost:8080 and click LEADERBOARD or MATCH HISTORY.
6. Finish a match with two players and click REFRESH.

Note: rankings aggregate by display name because authentication has not yet been added. Match history shows completed matches only.
