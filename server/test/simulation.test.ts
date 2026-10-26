import { test } from "node:test";
import assert from "node:assert/strict";
import { makeConfig } from "../../shared/config.ts";
const bw = (o: object = {}) => makeConfig({ respawnEnabled: false, countdownMs: 0, ...o });
import { ARENA, WALLS, SPAWNS } from "../../shared/map.ts";
import { GameSimulation } from "../src/game/simulation.ts";
import { parseInput } from "../src/game/validate.ts";

const DT = 1000 / 30;
const roster = (n: number) => ["A", "B", "C", "D"].slice(0, n).map((id) => ({ id, name: id }));
const run = (sim: GameSimulation, ticks: number) => { for (let i = 0; i < ticks; i++) sim.tick(DT); };
const idle = { up: false, down: false, left: false, right: false, fire: false, angle: 0 };

function duel(overrides = {}) {
  const sim = new GameSimulation(bw(overrides), roster(2));
  const a = sim.players.get("A")!;
  const b = sim.players.get("B")!;
  a.x = 200; a.y = 100; b.x = 500; b.y = 100; // open lane, no cover between them
  return { sim, a, b };
}

test("players start at 100 HP, score 0, at spawn points outside solid cover", () => {
  const sim = new GameSimulation(bw(), roster(4));
  for (const p of sim.players.values()) {
    assert.equal(p.health, 100);
    assert.equal(p.score, 0);
    assert.ok(p.alive);
  }
  for (const s of SPAWNS) {
    for (const w of WALLS) {
      const inside = s.x > w.x - 14 && s.x < w.x + w.w + 14 && s.y > w.y - 14 && s.y < w.y + w.h + 14;
      assert.equal(inside, false, `spawn ${s.x},${s.y} overlaps a wall`);
    }
  }
});

test("a successful hit deals exactly 20 damage and never hurts the shooter", () => {
  const { sim, a, b } = duel();
  sim.setInput("A", { ...idle, fire: true });
  run(sim, 1);
  sim.setInput("A", { ...idle });
  run(sim, 60);
  assert.equal(b.health, 80);
  assert.equal(a.health, 100);
  assert.equal(sim.projectiles.length, 0);
});

test("five hits eliminate; killer gets exactly 1 point; early finish picks the survivor", () => {
  const { sim, a, b } = duel({ fireCooldownMs: 100 });
  sim.setInput("A", { ...idle, fire: true });
  for (let i = 0; i < 400 && !sim.finished; i++) sim.tick(DT);
  assert.equal(b.alive, false);
  assert.equal(b.health, 0);
  assert.equal(a.score, 1);
  assert.equal(b.score, 0);
  assert.equal(sim.result?.reason, "last_standing");
  assert.equal(sim.result?.winnerId, "A");
  assert.equal(sim.result?.draw, false);
});

test("six simultaneous projectiles award one elimination point, not several", () => {
  const { sim, a, b } = duel();
  b.x = 400; b.y = 100;
  for (let i = 0; i < 6; i++) sim.projectiles.push({ id: 900 + i, owner: "A", x: 390, y: 100, angle: 0, ageMs: 0 });
  sim.tick(DT);
  assert.equal(b.health, 0);
  assert.equal(a.score, 1);
  assert.equal(b.deaths, 1);
});

test("walls block projectiles: no damage through cover", () => {
  const sim = new GameSimulation(bw(), roster(2));
  const a = sim.players.get("A")!;
  const b = sim.players.get("B")!;
  a.x = 150; a.y = 600; b.x = 300; b.y = 600; // flank barrier at x 200-240 between them
  sim.setInput("A", { ...idle, fire: true });
  run(sim, 1);
  sim.setInput("A", { ...idle });
  run(sim, 60);
  assert.equal(b.health, 100);
});

test("a target hugging the far side of a wall cannot be hit in the same step", () => {
  const sim = new GameSimulation(bw(), roster(2));
  const a = sim.players.get("A")!;
  const b = sim.players.get("B")!;
  a.x = 195; a.y = 600; b.x = 255; b.y = 600; // wall 200-240, B 15px past it
  sim.projectiles.push({ id: 1, owner: "A", x: 195, y: 600, angle: 0, ageMs: 0 });
  run(sim, 5);
  assert.equal(b.health, 100);
});

test("players cannot leave the arena or pass through walls", () => {
  const sim = new GameSimulation(bw(), roster(2));
  const a = sim.players.get("A")!;
  a.x = 100; a.y = 100;
  sim.setInput("A", { ...idle, left: true, up: true });
  run(sim, 120);
  assert.ok(a.x >= 14 && a.y >= 14);
  a.x = 150; a.y = 600;
  sim.setInput("A", { ...idle, right: true });
  run(sim, 120);
  assert.ok(a.x <= 200 - 14 + 1e-6, `x=${a.x}`);
  a.x = ARENA.width - 100; a.y = ARENA.height - 100;
  sim.setInput("A", { ...idle, right: true, down: true });
  run(sim, 120);
  assert.ok(a.x <= ARENA.width - 14 && a.y <= ARENA.height - 14);
});

test("diagonal movement is not faster than straight movement", () => {
  const s1 = new GameSimulation(bw(), roster(2));
  const s2 = new GameSimulation(bw(), roster(2));
  for (const [s, input] of [[s1, { ...idle, right: true }], [s2, { ...idle, right: true, down: true }]] as const) {
    const p = s.players.get("A")!; p.x = 400; p.y = 100;
    s.setInput("A", input);
    run(s, 10);
  }
  const d1 = s1.players.get("A")!.x - 400;
  const p2 = s2.players.get("A")!;
  assert.ok(Math.abs(Math.hypot(p2.x - 400, p2.y - 100) - d1) < 0.01);
});

test("fire cooldown limits shots", () => {
  const { sim, a } = duel({ fireCooldownMs: 350 });
  sim.setInput("A", { ...idle, fire: true });
  run(sim, 10); // ~333 ms
  assert.equal(a.shots, 1);
  run(sim, 5);
  assert.equal(a.shots, 2);
});

test("timer expiry: highest score wins", () => {
  const { sim, a } = duel({ matchDurationMs: 600 });
  a.score = 1;
  run(sim, 30);
  assert.equal(sim.result?.reason, "time_up");
  assert.equal(sim.result?.winnerId, "A");
  assert.equal(sim.result?.draw, false);
});

test("timer expiry: tie for highest score is a draw (including 0-0 and 3-way ties)", () => {
  const { sim } = duel({ matchDurationMs: 600 });
  run(sim, 30);
  assert.equal(sim.result?.draw, true);
  assert.equal(sim.result?.winnerId, null);
  assert.deepEqual(sim.result?.winnerIds.sort(), ["A", "B"]);

  const s3 = new GameSimulation(bw({ matchDurationMs: 600 }), roster(3));
  s3.players.get("A")!.score = 2;
  s3.players.get("B")!.score = 2;
  run(s3, 30);
  assert.equal(s3.result?.draw, true);
  assert.deepEqual(s3.result?.winnerIds.sort(), ["A", "B"]);
});

test("a result is final: timer expiry after an early finish cannot change it", () => {
  const { sim, b } = duel({ matchDurationMs: 600 });
  b.health = 20;
  sim.projectiles.push({ id: 1, owner: "A", x: 480, y: 100, angle: 0, ageMs: 0 });
  sim.tick(DT);
  assert.equal(sim.result?.reason, "last_standing");
  run(sim, 60); // well past the timer
  assert.equal(sim.result?.reason, "last_standing");
  assert.equal(sim.result?.winnerId, "A");
});

test("eliminated players cannot act", () => {
  const { sim, b } = duel();
  b.health = 20;
  sim.projectiles.push({ id: 1, owner: "A", x: 480, y: 100, angle: 0, ageMs: 0 });
  sim.tick(DT);
  assert.equal(sim.setInput("B", { ...idle, fire: true }), false);
});

test("disconnect eliminates without awarding points; last survivor wins early", () => {
  const sim = new GameSimulation(bw(), roster(3));
  sim.removePlayer("B");
  assert.equal(sim.finished, false);
  assert.equal(sim.players.get("B")!.alive, false);
  assert.equal([...sim.players.values()].reduce((n, p) => n + p.score, 0), 0);
  sim.removePlayer("C");
  assert.equal(sim.result?.reason, "last_standing");
  assert.equal(sim.result?.winnerId, "A");
  assert.equal(sim.players.get("A")!.score, 0);
});

test("input validation rejects malformed payloads", () => {
  assert.ok(parseInput({ up: true, angle: 1 }));
  for (const bad of [null, 5, "x", [], {}, { angle: NaN }, { angle: Infinity }, { angle: "1" }, { up: 1, angle: 0 }, { fire: "yes", angle: 0 }, { angle: 1e9 }]) {
    assert.equal(parseInput(bad), null, JSON.stringify(bad));
  }
});
