# Manual end-to-end test (do this with real browsers)

Automated tests cover the server logic with fake sockets. They **cannot** prove that the real Socket.IO
connection, the Phaser client, or the deployed VM work. This checklist does. Use two browser windows
(or devices) per match, so four windows for the full scenario. For faster runs start the server with
`MATCH_DURATION_MS=30000`.

Mark each line PASS/FAIL and note anything odd.

## A. Single match (players A, B)
- [ ] A: PLAY -> CREATE PRIVATE MATCH. A room code appears; COPY works.
- [ ] A's lobby shows 1/4, A marked HOST, START disabled ("need at least 2").
- [ ] B: JOIN with the code (try lowercase). Both lobbies show 2/4; START enabled for A only.
- [ ] A and B both see their own soldier ringed in cyan; they spawn in different corners.
- [ ] WASD moves; the soldier faces the mouse; walk animation plays only while moving.
- [ ] Soldiers cannot walk through walls/crates/sandbags or out of the arena.
- [ ] Click fires; a bullet with a trail travels; muzzle flash + sound play on both screens.
- [ ] Bullets stop at walls (dust puff). Standing behind cover protects you.
- [ ] Each hit: "-20", HP bar drops by exactly 20 on both screens. Self-hits never happen.
- [ ] Holding the button fires at a steady rate, not faster.
- [ ] 5th hit: elimination blast, kill feed line, killer's score becomes 1 (once only).
- [ ] The match ends immediately (last player standing). Results show VICTORY / DEFEAT correctly.
- [ ] BACK TO MENU works for both.

## B. Timer paths
- [ ] Start a match and do not fight: at 0:00 the result is DRAW (0-0).
- [ ] 3 players: A eliminates B, then everyone stops fighting. At 0:00 A (1 point) wins; the result is not a draw.
- [ ] Timer is identical on all screens (server-controlled), even if one tab is in the background.

## C. Join rules
- [ ] Wrong code -> "No match found". Garbage like `a` -> "doesn't look like a valid room code".
- [ ] 5th player joining a 4-player room -> "room is full".
- [ ] Joining after the host pressed START -> "already started".
- [ ] A player cannot start; only the host (non-host START is disabled).

## D. Two independent matches at once (players A, B in room 1; C, D in room 2)
- [ ] Both matches running; moves, shots, damage, scores in room 1 never appear in room 2.
- [ ] Close C's tab mid-match: D immediately wins room 2 (disconnect = elimination, no point to anyone); room 1 is unaffected.
- [ ] Finish room 1 normally. Both rooms ended independently with correct results.

## E. Disconnects
- [ ] 3 players: close one tab mid-match -> match continues; a "left the battle" line appears.
- [ ] Lobby: host closes tab -> another player becomes HOST.
- [ ] Stop the server mid-match: clients show "Connection lost" and return to the menu.

## F. Deployment (section 8 of DEPLOY_GCE.md)
- [ ] Everything above also works against `http://EXTERNAL_IP`.
- [ ] Screenshot of Cloud Monitoring CPU during a match.
