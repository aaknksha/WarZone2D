# BRD traceability checklist

**Important:** the BRD document itself was not available when this was written. Requirement wording comes from
the master prompt's mandatory-mechanics table and sections 5-12. Please compare against the real BRD and
tell me about any mismatch (especially disconnect handling, cooldown value, map size).

Legend: **TESTED** = covered by a passing automated test run in this project.
**BUILT** = implemented, but only you can verify it (needs npm install / a browser / Docker / the cloud).
**TODO** = not done. Nothing is marked complete merely because a button or screen exists.

Test files: `S` = `server/test/simulation.test.ts`, `M` = `server/test/matchManager.test.ts`, `N` = `server/test/network.test.ts`.

## Core rules

| # | Requirement | Implementation | Verification | Status |
|---|---|---|---|---|
| R1 | 2-4 players per match | `shared/config.ts`, `matchManager.joinRoom/startMatch` | M "joining: ...full..." , "start rules" | TESTED |
| R2 | 100 HP start | `GameSimulation` constructor | S "players start at 100 HP..." | TESTED |
| R3 | 180 s match, server timer | `matchDurationMs`, `sim.tick`, server loop in `index.ts` | S timer tests; M "timer is server-controlled" | TESTED (real-time loop: BUILT) |
| R4 | Hit = exactly 20 damage | `applyHit` | S "successful hit deals exactly 20" | TESTED |
| R5 | Eliminated at 0 HP | `applyHit` -> `eliminate` | S "five hits eliminate..." | TESTED |
| R6 | 1 point to the eliminator, no duplicates | `eliminate()` alive-guard | S "five hits...", "six simultaneous projectiles..." | TESTED |
| R7 | One player left -> that player wins | `checkEarlyFinish` | S "five hits...", "disconnect eliminates..." | TESTED |
| R8 | Timer expiry -> highest score wins | `finish("time_up")` | S "timer expiry: highest score wins" | TESTED |
| R9 | Tie for top score = draw | `finish` winnerIds | S "tie ... is a draw" (2- and 3-way, 0-0) | TESTED |
| R10 | Early finish and timer can't contradict | idempotent `finish` | S "a result is final..." | TESTED |
| R11 | Per-room isolated state | one `GameSimulation` per `Room` | M and N isolation tests (A/B vs C/D scenario) | TESTED |
| R12 | Firing cooldown, configurable | `fireCooldownMs`, env `FIRE_COOLDOWN_MS` | S "fire cooldown limits shots" | TESTED |
| R13 | No self-damage, no repeat damage per projectile | owner skip; projectile consumed on hit | S hit tests | TESTED |
| R14 | Walls block movement and projectiles; arena bounds | `shared/collision.ts`, `shared/map.ts` | S walls/bounds/"far side of a wall" tests | TESTED |
| R15 | Eliminated players cannot move/attack | `setInput` rejects | S "eliminated players cannot act" | TESTED |

## Rooms and lobby

| # | Requirement | Implementation | Verification | Status |
|---|---|---|---|---|
| L1 | Server-generated unique room codes | `MatchManager.createRoom` (crypto RNG, retry) | M "room codes...unique", "collisions are retried" | TESTED |
| L2 | Invalid code error | `joinRoom` -> INVALID_CODE / ROOM_NOT_FOUND | M, N join error tests | TESTED |
| L3 | Full room rejected | ROOM_FULL | M, N | TESTED |
| L4 | No joining after start | MATCH_STARTED | M, N | TESTED |
| L5 | Cannot start with < 2 players; host only | `startMatch` | M "start rules" | TESTED |
| L6 | Host identified; reassigned on leave | `lobbyView`, `leave` | M "host is reassigned..." , N lobby test | TESTED |
| L7 | Disconnect handling (elimination, no point) | `removePlayer` | S, M, N disconnect tests | TESTED (*assumed rule*) |
| L8 | Finished-room cleanup | `sweep`, `flush` drops sim | M "finished rooms are swept..." | TESTED |
| L9 | Lobby UI: code + copy, player list, start control | `client/src/ui/ui.ts` | MANUAL_TEST A | BUILT |

## Networking and security

| # | Requirement | Implementation | Verification | Status |
|---|---|---|---|---|
| N1 | Socket.IO realtime sync | `server/src/index.ts`, `network/handlers.ts`, `client/src/network/net.ts` | handlers tested via fake socket (N); real wire: MANUAL_TEST | BUILT |
| N2 | Broadcasts scoped to the room | `io.to(room)` via manager sink | N "clients only ever receive their own room's state" (fake router) | TESTED (logic) / BUILT (real Socket.IO) |
| N3 | Clients can't set health/score/winner | server accepts only validated input flags + angle | N "cannot inject authoritative state", S input validation | TESTED |
| N4 | Reject unauthorised/unregistered/eliminated actions | `handleInput` | M "unauthorised...", S | TESTED |
| N5 | Malformed payloads handled | `parseInput`, try/catch in handlers | S validation, N "malformed payloads..." | TESTED |
| N6 | Event-rate and payload limits | `TokenBucket`, `maxHttpBufferSize: 4096` | N rate-limit test, M token bucket test | TESTED (rate) / BUILT (size cap) |
| N7 | HTTP health endpoint | `GET /health` in `index.ts` | N health payload test; HTTP route itself: `curl /health` | BUILT |
| N8 | Graceful shutdown | SIGTERM/SIGINT handler | none | BUILT |
| N9 | Structured logs | `utils/logger.ts` (JSON lines) | visible in `docker compose logs` | BUILT |

## Client and game feel

| # | Requirement | Implementation | Verification | Status |
|---|---|---|---|---|
| C1 | Genuine Phaser game, not a dashboard | `client/src/game/scenes/*` | MANUAL_TEST A | BUILT |
| C2 | Pixel-art battlefield, animated soldiers, projectiles, FX | `textures.ts`, `arena.ts`, `effects.ts`, `PlayerView.ts` | MANUAL_TEST A | BUILT |
| C3 | WASD/arrows + mouse aim + click fire | `GameScene.update` | MANUAL_TEST A | BUILT |
| C4 | HUD: timer, scores, health, kill feed | `ui.ts` | MANUAL_TEST A | BUILT |
| C5 | Local player clearly indicated | cyan ring + marker | MANUAL_TEST A | BUILT |
| C6 | Results: winner/draw, scores, stats | `UI.showResults` | MANUAL_TEST A/B | BUILT |
| C7 | Sound + mute | `systems/audio.ts` (synth) | MANUAL_TEST A | BUILT |
| C8 | Menu with Play/Create/Join/Controls/connection status | `index.html`, `ui.ts` | MANUAL_TEST A/C | BUILT |
| C9 | Client prediction/interpolation (optional) | local-move prediction + drift correction; remote smoothing | MANUAL_TEST A | BUILT (simplified) |
| C10 | Countdown, background music | not implemented | n/a | TODO (optional) |
| C11 | Phaser Arcade Physics | replaced by shared custom collision (identical on client and server); documented decision | S collision tests | DECISION |

## Infrastructure and documentation

| # | Requirement | Implementation | Verification | Status |
|---|---|---|---|---|
| I1 | Dockerfile + Compose, healthcheck, restart policy, log rotation | `Dockerfile`, `docker-compose.yml` | `docker compose up --build` (not run by author) | BUILT |
| I2 | `.env.example` without secrets | `.env.example` | n/a | DONE |
| I3 | GCE deployment documented | `docs/DEPLOY_GCE.md` | **not performed** | BUILT (doc only) |
| I4 | Deployed and verified on GCE | - | checklist in DEPLOY_GCE.md section 8 | TODO (yours) |
| I5 | Metrics demonstrated | documented in DEPLOY_GCE.md section 10 | screenshot needed | TODO (yours) |
| I6 | Multi-window end-to-end test | `docs/MANUAL_TEST.md` | not performed | TODO (yours) |
| I7 | README, architecture diagram, workflow | `README.md` | n/a | DONE |
| I8 | Optional: Cloud Logging shipping | described, untested | - | TODO (optional) |
