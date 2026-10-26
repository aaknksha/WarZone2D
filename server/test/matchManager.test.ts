import { test } from "node:test";
import assert from "node:assert/strict";
import { makeConfig } from "../../shared/config.ts";
const bw = (o: object = {}) => makeConfig({ respawnEnabled: false, countdownMs: 0, ...o });
import { MatchManager } from "../src/matches/matchManager.ts";
import { TokenBucket } from "../src/utils/rateLimiter.ts";

const DT = 1000 / 30;
type Msg = { room: string; event: string; payload: any };

function setup(overrides = {}, opts = {}) {
  const log: Msg[] = [];
  const mgr = new MatchManager(bw({ fireCooldownMs: 100, ...overrides }), (room, event, payload) => log.push({ room, event, payload }), opts);
  return { mgr, log };
}
const idle = { up: false, down: false, left: false, right: false, fire: false, angle: 0 };

test("room codes are server-generated, well-formed and unique", () => {
  const { mgr } = setup();
  const codes = new Set<string>();
  for (let i = 0; i < 300; i++) {
    const r = mgr.createRoom(`p${i}`, "x");
    assert.ok(r.ok);
    if (r.ok) { assert.match(r.code, /^[A-HJ-NP-Z2-9]{5}$/); codes.add(r.code); }
  }
  assert.equal(codes.size, 300);
});

test("code collisions are retried", () => {
  const seq = ["AAAAA", "AAAAA", "BBBBB"];
  const { mgr } = setup({}, { codeGen: () => seq.shift() ?? "CCCCC" });
  const a = mgr.createRoom("p1", "a");
  const b = mgr.createRoom("p2", "b");
  assert.ok(a.ok && b.ok);
  assert.equal(a.ok && a.code, "AAAAA");
  assert.equal(b.ok && b.code, "BBBBB");
});

test("joining: valid, case-insensitive, invalid, unknown, full, started, duplicate", () => {
  const { mgr } = setup();
  const c = mgr.createRoom("p1", "Host");
  assert.ok(c.ok); if (!c.ok) return;
  assert.ok(mgr.joinRoom("p2", c.code.toLowerCase(), "B").ok);
  assert.deepEqual(mgr.joinRoom("x", "bad", "X"), { ok: false, error: "INVALID_CODE" });
  assert.deepEqual(mgr.joinRoom("x", 42, "X"), { ok: false, error: "INVALID_CODE" });
  assert.deepEqual(mgr.joinRoom("x", "ZZZZZ", "X"), { ok: false, error: "ROOM_NOT_FOUND" });
  assert.deepEqual(mgr.joinRoom("p2", c.code, "B"), { ok: false, error: "ALREADY_IN_ROOM" });
  assert.ok(mgr.joinRoom("p3", c.code, "C").ok);
  assert.ok(mgr.joinRoom("p4", c.code, "D").ok);
  assert.deepEqual(mgr.joinRoom("p5", c.code, "E"), { ok: false, error: "ROOM_FULL" });
  assert.ok(mgr.startMatch("p1").ok);
  mgr.leave("p4");
  assert.deepEqual(mgr.joinRoom("p6", c.code, "F"), { ok: false, error: "MATCH_STARTED" });
});

test("start rules: needs 2+ players, host only, not twice", () => {
  const { mgr } = setup();
  const c = mgr.createRoom("p1", "H"); assert.ok(c.ok); if (!c.ok) return;
  assert.deepEqual(mgr.startMatch("p1"), { ok: false, error: "NOT_ENOUGH_PLAYERS" });
  mgr.joinRoom("p2", c.code, "B");
  assert.deepEqual(mgr.startMatch("p2"), { ok: false, error: "NOT_HOST" });
  assert.deepEqual(mgr.startMatch("ghost"), { ok: false, error: "NOT_IN_ROOM" });
  assert.ok(mgr.startMatch("p1").ok);
  assert.deepEqual(mgr.startMatch("p1"), { ok: false, error: "BAD_STATE" });
});

test("host is reassigned when the host leaves the lobby; empty rooms are deleted", () => {
  const { mgr } = setup();
  const c = mgr.createRoom("p1", "H"); assert.ok(c.ok); if (!c.ok) return;
  mgr.joinRoom("p2", c.code, "B");
  mgr.leave("p1");
  assert.equal(mgr.roomOf("p2")?.hostId, "p2");
  mgr.leave("p2");
  assert.equal(mgr.getStatus(c.code), null);
  assert.equal(mgr.stats().rooms, 0);
});

test("unauthorised and malformed gameplay actions are rejected", () => {
  const { mgr } = setup();
  const c = mgr.createRoom("p1", "H"); assert.ok(c.ok); if (!c.ok) return;
  mgr.joinRoom("p2", c.code, "B");
  assert.deepEqual(mgr.handleInput("p1", idle), { ok: false, error: "BAD_STATE" }); // still lobby
  assert.deepEqual(mgr.handleInput("ghost", idle), { ok: false, error: "NOT_IN_ROOM" });
  mgr.startMatch("p1");
  assert.deepEqual(mgr.handleInput("p1", { angle: "boom" }), { ok: false, error: "BAD_PAYLOAD" });
  assert.deepEqual(mgr.handleInput("p1", { angle: 0, health: 9999, score: 99 }), { ok: true });
  const sim = mgr.getSim(c.code)!;
  assert.equal(sim.players.get("p1")!.health, 100); // clients cannot set authoritative state
  assert.equal(sim.players.get("p1")!.score, 0);
});

test("two simultaneous matches are fully isolated (BRD scenario A/B vs C/D)", () => {
  const { mgr, log } = setup();
  const r1 = mgr.createRoom("A", "A"); const r2 = mgr.createRoom("C", "C");
  assert.ok(r1.ok && r2.ok); if (!r1.ok || !r2.ok) return;
  assert.ok(mgr.joinRoom("B", r1.code, "B").ok);
  assert.ok(mgr.joinRoom("D", r2.code, "D").ok);
  assert.ok(mgr.startMatch("A").ok);
  assert.ok(mgr.startMatch("C").ok);
  const s1 = mgr.getSim(r1.code)!; const s2 = mgr.getSim(r2.code)!;

  // Room 1: A hunts B. Room 2: C and D idle at spawn.
  s1.players.get("A")!.x = 200; s1.players.get("A")!.y = 100;
  s1.players.get("B")!.x = 500; s1.players.get("B")!.y = 100;
  const c0 = { ...s2.players.get("C")! }; const d0 = { ...s2.players.get("D")! };
  mgr.handleInput("A", { ...idle, fire: true });
  mgr.handleInput("D", { ...idle, left: true, angle: 1 });
  for (let i = 0; i < 400 && mgr.getStatus(r1.code) === "playing"; i++) mgr.tickAll(DT);

  assert.equal(mgr.getStatus(r1.code), "finished");
  assert.equal(mgr.getResult(r1.code)?.winnerId, "A");
  assert.equal(mgr.getStatus(r2.code), "playing");
  const c1 = s2.players.get("C")!;
  assert.equal(c1.health, 100); assert.equal(c1.score, 0); assert.equal(c1.x, c0.x);
  assert.equal(s2.players.get("D")!.health, 100);
  assert.ok(s2.players.get("D")!.x < d0.x); // room 2 kept simulating on its own

  // broadcasts only ever mention the addressed room's players
  const members: Record<string, string[]> = { [r1.code]: ["A", "B"], [r2.code]: ["C", "D"] };
  for (const m of log.filter((l) => l.event === "state")) {
    for (const p of m.payload.players) assert.ok(members[m.room]!.includes(p.id), `${p.id} leaked into ${m.room}`);
  }
  assert.ok(log.some((l) => l.event === "matchEnd" && l.room === r1.code));
  assert.ok(!log.some((l) => l.event === "matchEnd" && l.room === r2.code));

  // disconnect in room 2 ends room 2 only, with the remaining player winning
  mgr.leave("C");
  assert.equal(mgr.getStatus(r2.code), "finished");
  assert.equal(mgr.getResult(r2.code)?.winnerId, "D");
  assert.equal(mgr.getResult(r1.code)?.winnerId, "A");
});

test("a disconnect mid-match in a 3-player room keeps the match running", () => {
  const { mgr } = setup();
  const c = mgr.createRoom("A", "A"); assert.ok(c.ok); if (!c.ok) return;
  mgr.joinRoom("B", c.code, "B"); mgr.joinRoom("C", c.code, "C");
  mgr.startMatch("A");
  mgr.leave("B");
  assert.equal(mgr.getStatus(c.code), "playing");
  assert.equal(mgr.getSim(c.code)!.players.get("B")!.alive, false);
  assert.deepEqual(mgr.handleInput("B", idle), { ok: false, error: "NOT_IN_ROOM" });
});

test("timer is server-controlled: ticks alone end the match, with a draw at equal scores", () => {
  const { mgr } = setup({ matchDurationMs: 1000 });
  const c = mgr.createRoom("A", "A"); assert.ok(c.ok); if (!c.ok) return;
  mgr.joinRoom("B", c.code, "B"); mgr.startMatch("A");
  for (let i = 0; i < 40 && mgr.getStatus(c.code) === "playing"; i++) mgr.tickAll(DT);
  assert.equal(mgr.getResult(c.code)?.draw, true);
});

test("finished rooms are swept after the TTL and players are released", () => {
  let t = 0;
  const { mgr, log } = setup({ matchDurationMs: 300, finishedRoomTtlMs: 5000 }, { now: () => t });
  const c = mgr.createRoom("A", "A"); assert.ok(c.ok); if (!c.ok) return;
  mgr.joinRoom("B", c.code, "B"); mgr.startMatch("A");
  for (let i = 0; i < 20; i++) mgr.tickAll(DT);
  assert.equal(mgr.getStatus(c.code), "finished");
  assert.equal(mgr.getSim(c.code), null); // live state dropped
  t = 4999; assert.deepEqual(mgr.sweep(), []);
  t = 5000; assert.deepEqual(mgr.sweep(), [c.code]);
  assert.ok(log.some((l) => l.event === "roomClosed"));
  assert.equal(mgr.stats().players, 0);
  assert.ok(mgr.createRoom("A", "A").ok); // free to play again
});

test("token bucket allows bursts then throttles, then refills", () => {
  let t = 0;
  const b = new TokenBucket(3, 1, () => t);
  assert.deepEqual([b.take(), b.take(), b.take(), b.take()], [true, true, true, false]);
  t = 1000;
  assert.equal(b.take(), true);
  assert.equal(b.take(), false);
});
