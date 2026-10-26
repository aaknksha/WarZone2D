# WARZONE 2D — Phase 4 Login, Register, Profile

This archive is built from the uploaded Phase3B ZIP. That ZIP did **not** include the newer API authentication files shown in your local test logs, so this archive includes compatible authentication backend code and database migration as well as the frontend changes.

## IMPORTANT: preserve your existing local data

1. Back up your current project folder and `.env` before copying files from this ZIP.
2. Extract this archive to a separate directory first. You may run it there using your existing `.env` values, or carefully copy the modified files into your existing project. **Do not replace your existing `.env` with the example file.**
3. Ensure `.env` has `SESSION_SECRET=` with a unique random value at least 32 characters long. Keep your existing `POSTGRES_PASSWORD` and `INTERNAL_API_SECRET` unchanged.
4. From the project directory in Windows CMD:

   docker compose -f docker-compose.full.yml up -d --build

5. Open http://localhost:8080, register, log in, view My Profile, and log out.

Never use `docker compose down -v`: it deletes the database/Redis volumes.

## Notes

- Frontend login is a UI gate only. The Socket.IO game server does not yet verify the login session. Do not treat this as secure access control for a public deployment.
- Player profile stats are initialized to zero and not yet linked to match result persistence.
- Login uses same-origin Redis-backed session cookies.
- Registration does not automatically log in; use the login form after registering.
- This environment could run JavaScript syntax checks but could not download npm packages or run the full Vite/Docker build. Verify with `cd client && npm ci && npm run typecheck && npm run build` and Docker Compose locally.
