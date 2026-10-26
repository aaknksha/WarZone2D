import { test } from "node:test";
import assert from "node:assert/strict";
import { makeConfig } from "../../shared/config.ts";
const bw = (o: object = {}) => makeConfig({ respawnEnabled: false, countdownMs: 0, ...o });
import { MatchManager } from "../src/matches/matchManager.ts";
import { registerSocket } from "../src/network/handlers.ts";
import type { SocketLike } from "../src/network/handlers.ts";
import { buildHealth } from "../src/network/health.ts";

const DT = 1000 / 30;
const silent = { info() {}, warn() {}, error() {} };

class FakeSocket implements SocketLike {
  handlers = new Map<string, (...a: any[]) => void>();
  received: { event: string; payload: any }[] = [];
  disconnected = false;
  id: string;
  net: FakeNet;
  constructor(id: string, net: FakeNet) { this.id = id; this.net = net; }
  on(ev: string, cb: (...a: any[]) => void) { this.handlers.set(ev, cb); }
  emit(ev: string, ...a: any[]) { this.received.push({ event: ev, payload: a[0] }); }
  join(room: string) { (this.net.rooms.get(room) ?? this.net.rooms.set(room, new Set()).get(room)!).add(this.id); }
  leave(room: string) { this.net.rooms.get(room)?.delete(this.id); }
  disconnect() { this.disconnected = true; }
  /** Client -> server with ack; returns the ack synchronously. */
  call(ev: string, payload?: unknown): any {
    let res: any;
    this.handlers.get(ev)?.(payload, (r: any) => { res = r; });
    return res;
  }
  send(ev: string, payload?: unknown) { this.handlers.get(ev)?.(payload); }
  drop() { this.handlers.get("disconnect")?.(); for (const r of this.net.rooms.values()) r.delete(this.id); }
  count(ev: string) { return this.received.filter((m) => m.event === ev).length; }
}
class FakeNet {
  rooms = new Map<string, Set<string>>();
  sockets = new Map<string, FakeSocket>();
  sink = (room: string, event: string, payload: unknown) => {
    for (const id of this.rooms.get(room) ?? []) this.sockets.get(id)!.received.push({ event, payload });
  };
}

function world(overrides = {}, now: () => number = Date.now) {
  const net = new FakeNet();
  const cfg = bw({ fireCooldownMs: 100, ...overrides });
  const mgr = new MatchManager(cfg, net.sink);
  const connect = (id: string) => {
    const s = new FakeSocket(id, net);
    net.sockets.set(id, s);
    registerSocket(s, mgr, cfg, silent, now);
    return s;
  };
  return { net, mgr, connect, cfg };
}
const idle = { up: false, down: false, left: false, right: false, fire: false, angle: 0 };

test("a connecting client receives its id and the game config", () => {
  const { connect, cfg } = world();
  const a = connect("A");
  assert.deepEqual(a.received[0], { event: "hello", payload: { id: "A", config: cfg } });
});

test("create/join/start flow with acks and room-scoped broadcasts", () => {
  const { connect } = world();
  const a = connect("A"), b = connect("B");
  const created = a.call("room:create", { name: "Alpha" });
  assert.ok(created.ok);
  assert.equal(created.you, "A");
  const joined = b.call("room:join", { code: created.code.toLowerCase(), name: "Bravo" });
  assert.ok(joined.ok);
  assert.equal(joined.lobby.players.length, 2);
  assert.equal(a.count("lobby"), 1); // host saw the join; the joiner got it via the ack
  assert.deepEqual(b.call("room:start"), { ok: false, error: "NOT_HOST" });
  assert.deepEqual(a.call("room:start"), { ok: true, code: created.code });
  assert.equal(a.count("matchStart"), 1);
  assert.equal(b.count("matchStart"), 1);
});

test("join errors reach the client: invalid, unknown, full, started", () => {
  const { connect } = world();
  const [a, b, c, d, e, f] = ["A", "B", "C", "D", "E", "F"].map(connect) as FakeSocket[];
  const { code } = a!.call("room:create", { name: "A" });
  assert.deepEqual(b!.call("room:join", { code: "no", name: "B" }), { ok: false, error: "INVALID_CODE" });
  assert.deepEqual(b!.call("room:join", { code: "ZZZZZ", name: "B" }), { ok: false, error: "ROOM_NOT_FOUND" });
  for (const s of [b!, c!, d!]) assert.ok(s.call("room:join", { code, name: "x" }).ok);
  assert.deepEqual(e!.call("room:join", { code, name: "E" }), { ok: false, error: "ROOM_FULL" });
  a!.call("room:start");
  d!.call("room:leave");
  assert.deepEqual(f!.call("room:join", { code, name: "F" }), { ok: false, error: "MATCH_STARTED" });
});

test("two live matches: clients only ever receive their own room's state", () => {
  const { connect, mgr } = world();
  const [A, B, C, D] = ["A", "B", "C", "D"].map(connect) as FakeSocket[];
  const r1 = A!.call("room:create", { name: "A" }); B!.call("room:join", { code: r1.code, name: "B" });
  const r2 = C!.call("room:create", { name: "C" }); D!.call("room:join", { code: r2.code, name: "D" });
  A!.call("room:start"); C!.call("room:start");
  const s1 = mgr.getSim(r1.code)!;
  s1.players.get("A")!.x = 200; s1.players.get("A")!.y = 100;
  s1.players.get("B")!.x = 500; s1.players.get("B")!.y = 100;
  A!.send("input", { ...idle, fire: true });
  D!.send("input", { ...idle, left: true, angle: 0.5 });
  for (let i = 0; i < 400 && mgr.getStatus(r1.code) === "playing"; i++) mgr.tickAll(DT);

  assert.equal(A!.count("matchEnd"), 1);
  assert.equal(B!.count("matchEnd"), 1);
  assert.equal(C!.count("matchEnd") + D!.count("matchEnd"), 0);
  for (const [sock, ids] of [[A!, ["A", "B"]], [B!, ["A", "B"]], [C!, ["C", "D"]], [D!, ["C", "D"]]] as const) {
    const states = sock.received.filter((m) => m.event === "state");
    assert.ok(states.length > 5);
    for (const st of states) for (const p of st.payload.players) assert.ok(ids.includes(p.id), `${p.id} leaked to ${sock.id}`);
  }
  // room 2 keeps running, then a disconnect ends only room 2
  assert.equal(mgr.getStatus(r2.code), "playing");
  C!.drop();
  assert.equal(mgr.getResult(r2.code)?.winnerId, "D");
  assert.equal(mgr.getResult(r1.code)?.winnerId, "A");
  assert.equal(D!.count("matchEnd"), 1);
});

test("clients cannot inject authoritative state through input payloads", () => {
  const { connect, mgr } = world();
  const [A, B] = ["A", "B"].map(connect) as FakeSocket[];
  const { code } = A!.call("room:create", { name: "A" }); B!.call("room:join", { code, name: "B" }); A!.call("room:start");
  A!.send("input", { ...idle, health: 9999, score: 50, winner: "A", x: 700, y: 700 });
  const p = mgr.getSim(code)!.players.get("A")!;
  assert.equal(p.health, 100); assert.equal(p.score, 0); assert.notEqual(p.x, 700);
});

test("malformed payloads and missing acks never throw", () => {
  const { connect } = world();
  const a = connect("A");
  for (const bad of [undefined, null, 5, "str", [], { name: {} }, { code: { x: 1 } }, () => {}]) {
    assert.doesNotThrow(() => a.handlers.get("room:create")?.(bad));
    assert.doesNotThrow(() => a.handlers.get("room:join")?.(bad));
    assert.doesNotThrow(() => a.handlers.get("input")?.(bad));
  }
  assert.doesNotThrow(() => a.handlers.get("room:start")?.());
  assert.doesNotThrow(() => a.handlers.get("room:leave")?.());
});

test("rate limiting throttles floods and eventually disconnects abusive clients", () => {
  let t = 0;
  const { connect } = world({}, () => t);
  const a = connect("A");
  const results = Array.from({ length: 40 }, () => a.call("room:join", { code: "ZZZZZ", name: "x" }));
  assert.ok(results.some((r) => r.error === "RATE_LIMITED"));
  assert.equal(a.disconnected, false);
  for (let i = 0; i < 400; i++) a.send("input", { not: "valid" });
  assert.equal(a.disconnected, true);
  t = 10_000; // buckets refill with time
  assert.notEqual(connect("B").call("room:join", { code: "ZZZZZ", name: "x" }).error, "RATE_LIMITED");
});

test("disconnecting in the lobby frees the room code for others to see an updated lobby", () => {
  const { connect } = world();
  const [A, B] = ["A", "B"].map(connect) as FakeSocket[];
  const { code } = A!.call("room:create", { name: "A" }); B!.call("room:join", { code, name: "B" });
  A!.drop();
  const last = [...B!.received].reverse().find((m) => m.event === "lobby")!.payload;
  assert.equal(last.hostId, "B");
  assert.equal(last.players.length, 1);
});

test("health endpoint payload reports status and live counts", () => {
  const { connect, mgr } = world();
  const [A, B] = ["A", "B"].map(connect) as FakeSocket[];
  const { code } = A!.call("room:create", { name: "A" }); B!.call("room:join", { code, name: "B" }); A!.call("room:start");
  assert.deepEqual(buildHealth(mgr, 0, 5000), { status: "ok", uptimeSec: 5, rooms: 1, players: 2, playing: 1 });
});
