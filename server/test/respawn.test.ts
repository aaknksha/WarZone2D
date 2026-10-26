import { test } from "node:test";
import assert from "node:assert/strict";
import { makeConfig } from "../../shared/config.ts";
import { SPAWNS } from "../../shared/map.ts";
import { GameSimulation } from "../src/game/simulation.ts";
import { MatchManager } from "../src/matches/matchManager.ts";

const DT = 1000 / 30;
const run = (sim: GameSimulation, ticks: number) => { for (let i = 0; i < ticks; i++) sim.tick(DT); };
const idle = { up: false, down: false, left: false, right: false, fire: false, angle: 0 };
const roster = (n: number) => ["A", "B", "C", "D"].slice(0, n).map((id) => ({ id, name: id }));
const cfg = (o = {}) => makeConfig({ countdownMs: 0, ...o });

/** A at (200,100), B at (500,100) in an open lane. */
function duel(o = {}, rng: () => number = () => 0) {
  const sim = new GameSimulation(cfg(o), roster(2), rng);
  const a = sim.players.get("A")!, b = sim.players.get("B")!;
  a.x = 200; a.y = 100; b.x = 500; b.y = 100;
  return { sim, a, b };
}
/** Eliminate `victim` with a point-blank shot from `killer`. */
function eliminate(sim: GameSimulation, victim = "B", killer = "A") {
  const v = sim.players.get(victim)!;
  v.health = 20;
  sim.projectiles.push({ id: 5000 + sim.projectiles.length, owner: killer, x: v.x - 20, y: v.y, angle: 0, ageMs: 0 });
  sim.tick(DT);
  assert.equal(v.alive, false);
}

test("an eliminated player respawns after the delay and the match keeps going", () => {
  const { sim, a, b } = duel({}, () => 0); // rng 0 -> minimum delay (3 s)
  eliminate(sim);
  assert.equal(sim.finished, false); // no early finish with respawn on
  assert.equal(a.score, 1);
  const snap = sim.snapshot().players.find((p) => p.id === "B")!;
  assert.equal(snap.alive, false);
  assert.ok(snap.respawnInMs > 2900 && snap.respawnInMs <= 3000, `respawnInMs=${snap.respawnInMs}`);
  run(sim, 89); // ~2.97 s later: still dead
  assert.equal(b.alive, false);
  run(sim, 3);
  assert.equal(b.alive, true);
  assert.equal(b.health, 100);
  assert.ok(sim.drainEvents().some((e) => e.type === "respawn" && e.player === "B"));
});

test("respawn delay stays inside the 3-5 second window", () => {
  for (const [rng, lo, hi] of [[() => 0, 2900, 3000], [() => 0.999999, 4900, 5000], [() => 0.5, 3900, 4000]] as const) {
    const { sim } = duel({}, rng);
    eliminate(sim);
    const ms = sim.snapshot().players.find((p) => p.id === "B")!.respawnInMs;
    assert.ok(ms >= lo && ms <= hi, `${ms} not in [${lo},${hi}]`);
  }
});

test("dead players cannot act until they respawn", () => {
  const { sim } = duel({}, () => 0);
  eliminate(sim);
  assert.equal(sim.setInput("B", { ...idle, fire: true }), false);
  run(sim, 95);
  assert.equal(sim.setInput("B", { ...idle }), true);
});

test("respawn picks the spawn point farthest from living opponents", () => {
  const { sim, b } = duel({}, () => 0); // A sits near spawn 0 (top-left)
  eliminate(sim);
  run(sim, 95);
  const far = SPAWNS[1]!; // bottom-right
  assert.ok(Math.hypot(b.x - far.x, b.y - far.y) < 1, `respawned at ${b.x},${b.y}`);
});

test("spawn protection: shots pass through, then damage applies once it ends", () => {
  const { sim, b } = duel({ spawnProtectionMs: 1000 }, () => 0);
  eliminate(sim);
  run(sim, 95);
  assert.equal(sim.snapshot().players.find((p) => p.id === "B")!.invulnerable, true);
  const shoot = () => sim.projectiles.push({ id: 9000 + sim.projectiles.length, owner: "A", x: b.x - 20, y: b.y, angle: 0, ageMs: 0 });
  shoot();
  run(sim, 2);
  assert.equal(b.health, 100); // protected
  run(sim, 40); // > 1 s later
  assert.equal(sim.snapshot().players.find((p) => p.id === "B")!.invulnerable, false);
  shoot();
  run(sim, 2);
  assert.equal(b.health, 80);
});

test("kill streaks build, reset on death, and best streak is reported", () => {
  const { sim, a, b } = duel({ spawnProtectionMs: 0, matchDurationMs: 20_000 }, () => 0);
  eliminate(sim);
  assert.equal(a.streak, 1);
  run(sim, 95);
  b.health = 20;
  sim.projectiles.push({ id: 7000, owner: "A", x: b.x - 20, y: b.y, angle: 0, ageMs: 0 });
  sim.tick(DT);
  assert.equal(a.streak, 2);
  const kill = sim.drainEvents().filter((e) => e.type === "kill");
  assert.deepEqual(kill.map((e) => (e as { streak: number }).streak), [1, 2]);
  assert.equal(b.streak, 0);
  run(sim, 700); // let the clock run out
  const r = sim.result!;
  assert.equal(r.reason, "time_up");
  assert.equal(r.standings.find((s) => s.id === "A")!.bestStreak, 2);
  assert.equal(r.winnerId, "A");
});

test("with respawn on, the timer decides the match, not an early finish", () => {
  const { sim } = duel({ matchDurationMs: 1000 }, () => 0);
  eliminate(sim);
  run(sim, 40);
  assert.equal(sim.result?.reason, "time_up");
  assert.equal(sim.result?.winnerId, "A");
});

test("a 0-0 expiry is still a draw with respawn on", () => {
  const { sim } = duel({ matchDurationMs: 600 });
  run(sim, 30);
  assert.equal(sim.result?.draw, true);
});

test("a player who disconnects while waiting to respawn never returns; the last one connected wins", () => {
  const { sim } = duel({}, () => 0);
  eliminate(sim);
  sim.removePlayer("B");
  assert.equal(sim.result?.reason, "opponents_left");
  assert.equal(sim.result?.winnerId, "A");
});

test("3 players: a disconnect does not end the match and the leaver never respawns", () => {
  const sim = new GameSimulation(cfg(), roster(3), () => 0);
  sim.removePlayer("C");
  run(sim, 250);
  assert.equal(sim.finished, false);
  assert.equal(sim.players.get("C")!.alive, false);
  assert.equal(sim.snapshot().players.find((p) => p.id === "C")!.disconnected, true);
});

test("respawn disabled reproduces the BRD: elimination is final and ends the match", () => {
  const { sim, b } = duel({ respawnEnabled: false });
  eliminate(sim);
  assert.equal(sim.result?.reason, "last_standing");
  assert.equal(b.respawnAt, null);
});

test("countdown freezes players and the match clock, then GO starts play", () => {
  const sim = new GameSimulation(makeConfig({ countdownMs: 3000 }), roster(2));
  const a = sim.players.get("A")!;
  const x0 = a.x;
  sim.setInput("A", { ...idle, right: true, fire: true });
  run(sim, 60); // 2 s
  assert.equal(a.x, x0);
  assert.equal(a.shots, 0);
  assert.equal(sim.elapsedMs, 0);
  const snap = sim.snapshot();
  assert.ok(snap.countdownMs > 900 && snap.countdownMs <= 1000, `countdownMs=${snap.countdownMs}`);
  assert.equal(snap.remainingMs, 180_000);
  run(sim, 41);
  assert.equal(sim.drainEvents().filter((e) => e.type === "go").length, 1);
  run(sim, 10);
  assert.ok(a.x > x0);
  assert.ok(sim.elapsedMs > 0);
});

test("manager: a started match begins in countdown and the match clock waits for GO", () => {
  const log: { event: string; payload: any }[] = [];
  const mgr = new MatchManager(makeConfig(), (_r, event, payload) => log.push({ event, payload }));
  const c = mgr.createRoom("A", "A"); assert.ok(c.ok); if (!c.ok) return;
  mgr.joinRoom("B", c.code, "B");
  mgr.startMatch("A");
  assert.equal(log.find((l) => l.event === "matchStart")!.payload.snapshot.countdownMs, 3000);
  for (let i = 0; i < 100; i++) mgr.tickAll(DT); // 3.3 s
  const last = [...log].reverse().find((l) => l.event === "state")!.payload;
  assert.equal(last.countdownMs, 0);
  assert.ok(last.remainingMs > 179_000);
  assert.ok(log.some((l) => l.event === "events" && l.payload.some((e: any) => e.type === "go")));
});
