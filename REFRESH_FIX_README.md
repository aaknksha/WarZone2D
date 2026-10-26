# Refresh recovery fix

Fixed: frontend previously navigated to the menu on disconnect; server sent matchStart before hello; frontend connected before the UI listeners were registered.

## Test
1. Start the six-service Docker Compose stack.
2. Join the same room from two separate browser sessions and start a match.
3. Refresh one browser tab within 30 seconds. The same match should load with the same player ID.
4. Check `docker compose -f docker-compose.full.yml logs game --tail=40` for `player resumed match`.

Limitations: same-process recovery only; VM failure and multi-VM recovery still need Redis-backed room ownership and snapshot restoration.
