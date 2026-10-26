import { randomInt, randomUUID } from "node:crypto";
import type { GameConfig } from "../../../shared/config.ts";
import { GameSimulation } from "../game/simulation.ts";
import type { MatchResult } from "../game/simulation.ts";
import type { ErrorCode, LobbyView, RoomStatus } from "../../../shared/protocol.ts";

export type { ErrorCode, LobbyView, RoomStatus };
import { parseInput, parseName } from "../game/validate.ts";

export type Fail = { ok: false; error: ErrorCode };

/** Every outbound broadcast is addressed to exactly one room code. */
export type Sink = (roomCode: string, event: string, payload: unknown) => void;

interface Room {
  code: string;
  hostId: string;
  status: RoomStatus;
  members: Map<string, { id: string; name: string }>;
  sim: GameSimulation | null;
  result: MatchResult | null;
  createdAt: number;
  matchId: string | null;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface ManagerOptions {
  codeGen?: () => string;
  now?: () => number;
  maxRooms?: number;
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

export class MatchManager {
  private readonly cfg: GameConfig;
  private readonly sink: Sink;
  private readonly rooms = new Map<string, Room>();
  private readonly playerRoom = new Map<string, string>();
  private readonly codeGen: () => string;
  private readonly now: () => number;
  private readonly maxRooms: number;
  private readonly codeRe: RegExp;

  constructor(cfg: GameConfig, sink: Sink, opts: ManagerOptions = {}) {
    this.cfg = cfg;
    this.sink = sink;
    this.now = opts.now ?? Date.now;
    this.maxRooms = opts.maxRooms ?? 500;
    this.codeRe = new RegExp(`^[${ALPHABET}]{${cfg.roomCodeLength}}$`);
    this.codeGen =
      opts.codeGen ??
      (() => Array.from({ length: cfg.roomCodeLength }, () => ALPHABET[randomInt(ALPHABET.length)]).join(""));
  }

  /** Serialize room state for crash recovery on the SAME designated game instance. */
  exportState() {
    return [...this.rooms.values()].map((r) => ({
      ...r, members: [...r.members.values()],
      sim: r.sim?.exportState() ?? null,
    }));
  }

  restoreState(data: ReturnType<MatchManager["exportState"]>): number {
    if (this.rooms.size) throw new Error("Cannot restore over active rooms");
    for (const saved of data) {
      if (!saved || !saved.code || !Array.isArray(saved.members)) continue;
      const room: Room = {
        ...saved,
        members: new Map(saved.members.map((m) => [m.id, m])),
        sim: saved.sim ? GameSimulation.restore(this.cfg, saved.sim) : null,
      };
      this.rooms.set(room.code, room);
      for (const id of room.members.keys()) this.playerRoom.set(id, room.code);
    }
    return this.rooms.size;
  }

  // ---------- lobby ----------

  createRoom(playerId: string, rawName: unknown): ({ ok: true; code: string; lobby: LobbyView }) | Fail {
    if (this.playerRoom.has(playerId)) return { ok: false, error: "ALREADY_IN_ROOM" };
    if (this.rooms.size >= this.maxRooms) return { ok: false, error: "SERVER_BUSY" };
    let code = "";
    for (let i = 0; i < 50; i++) {
      const c = this.codeGen();
      if (!this.rooms.has(c)) {
        code = c;
        break;
      }
    }
    if (!code) return { ok: false, error: "SERVER_BUSY" };
    const room: Room = {
      code,
      hostId: playerId,
      status: "lobby",
      members: new Map(),
      sim: null,
      result: null,
      createdAt: this.now(),
      matchId: null,
      startedAt: null,
      finishedAt: null,
    };
    room.members.set(playerId, { id: playerId, name: parseName(rawName) || "Player 1" });
    this.rooms.set(code, room);
    this.playerRoom.set(playerId, code);
    const lobby = this.lobbyView(room);
    this.sink(code, "lobby", lobby);
    return { ok: true, code, lobby };
  }

  joinRoom(playerId: string, rawCode: unknown, rawName: unknown): ({ ok: true; code: string; lobby: LobbyView }) | Fail {
    if (typeof rawCode !== "string") return { ok: false, error: "INVALID_CODE" };
    const code = rawCode.trim().toUpperCase();
    if (!this.codeRe.test(code)) return { ok: false, error: "INVALID_CODE" };
    if (this.playerRoom.has(playerId)) return { ok: false, error: "ALREADY_IN_ROOM" };
    const room = this.rooms.get(code);
    if (!room) return { ok: false, error: "ROOM_NOT_FOUND" };
    if (room.status !== "lobby") return { ok: false, error: "MATCH_STARTED" };
    if (room.members.size >= this.cfg.maxPlayers) return { ok: false, error: "ROOM_FULL" };
    room.members.set(playerId, { id: playerId, name: parseName(rawName) || `Player ${room.members.size + 1}` });
    this.playerRoom.set(playerId, code);
    const lobby = this.lobbyView(room);
    this.sink(code, "lobby", lobby);
    return { ok: true, code, lobby };
  }

  startMatch(playerId: string): ({ ok: true; code: string }) | Fail {
    const room = this.roomOf(playerId);
    if (!room) return { ok: false, error: "NOT_IN_ROOM" };
    if (room.hostId !== playerId) return { ok: false, error: "NOT_HOST" };
    if (room.status !== "lobby") return { ok: false, error: "BAD_STATE" };
    if (room.members.size < this.cfg.minPlayers) return { ok: false, error: "NOT_ENOUGH_PLAYERS" };
    room.sim = new GameSimulation(this.cfg, [...room.members.values()]);
    room.matchId = randomUUID();
    room.startedAt = this.now();
    room.status = "playing";
    this.sink(room.code, "matchStart", { code: room.code, snapshot: room.sim.snapshot() });
    this.sink(room.code, "lobby", this.lobbyView(room));
    return { ok: true, code: room.code };
  }

  /** Disconnect or explicit leave. Safe to call for unknown players. */
  leave(playerId: string): boolean {
    const room = this.roomOf(playerId);
    if (!room) return false;
    this.playerRoom.delete(playerId);
    room.members.delete(playerId);

    if (room.members.size === 0) {
      this.rooms.delete(room.code); // no one left: discard all temporary match state
      return true;
    }
    if (room.hostId === playerId) room.hostId = room.members.keys().next().value as string;

    if (room.status === "playing" && room.sim) {
      room.sim.removePlayer(playerId);
      this.flush(room);
    }
    this.sink(room.code, "lobby", this.lobbyView(room));
    return true;
  }

  // ---------- gameplay ----------

  handleInput(playerId: string, raw: unknown): ({ ok: true }) | Fail {
    const room = this.roomOf(playerId);
    if (!room) return { ok: false, error: "NOT_IN_ROOM" };
    if (room.status !== "playing" || !room.sim) return { ok: false, error: "BAD_STATE" };
    const input = parseInput(raw);
    if (!input) return { ok: false, error: "BAD_PAYLOAD" };
    // setInput rejects eliminated/disconnected players
    return room.sim.setInput(playerId, input) ? { ok: true } : { ok: false, error: "BAD_STATE" };
  }

  tickAll(dtMs: number): void {
    for (const room of this.rooms.values()) {
      if (room.status !== "playing" || !room.sim) continue;
      room.sim.tick(dtMs);
      this.flush(room);
    }
  }

  /** Removes finished rooms past their TTL. Returns the closed room codes. */
  sweep(): string[] {
    const closed: string[] = [];
    for (const room of [...this.rooms.values()]) {
      if (room.status === "finished" && room.finishedAt !== null && this.now() - room.finishedAt >= this.cfg.finishedRoomTtlMs) {
        this.sink(room.code, "roomClosed", { code: room.code });
        for (const id of room.members.keys()) this.playerRoom.delete(id);
        this.rooms.delete(room.code);
        closed.push(room.code);
      }
    }
    return closed;
  }

  // ---------- queries ----------

  roomOf(playerId: string): Room | undefined {
    const code = this.playerRoom.get(playerId);
    return code ? this.rooms.get(code) : undefined;
  }

  /** Test/debug accessor for a room's live simulation. */
  getSim(code: string): GameSimulation | null {
    return this.rooms.get(code)?.sim ?? null;
  }

  getResult(code: string): MatchResult | null {
    return this.rooms.get(code)?.result ?? null;
  }

  getStatus(code: string): RoomStatus | null {
    return this.rooms.get(code)?.status ?? null;
  }

  stats() {
    let playing = 0;
    for (const r of this.rooms.values()) if (r.status === "playing") playing++;
    return { rooms: this.rooms.size, players: this.playerRoom.size, playing };
  }

  lobbyView(room: Room): LobbyView {
    return {
      code: room.code,
      hostId: room.hostId,
      status: room.status,
      min: this.cfg.minPlayers,
      max: this.cfg.maxPlayers,
      players: [...room.members.values()].map((m) => ({ id: m.id, name: m.name, isHost: m.id === room.hostId })),
    };
  }

  // ---------- internals ----------

  private flush(room: Room): void {
    const sim = room.sim;
    if (!sim) return;
    const events = sim.drainEvents();
    if (events.length) this.sink(room.code, "events", events);
    this.sink(room.code, "state", sim.snapshot());
    if (sim.finished && room.status === "playing") {
      room.status = "finished";
      room.result = sim.result;
      room.finishedAt = this.now();
      room.sim = null; // drop live match state; result is retained until the room closes
      this.sink(room.code, "matchEnd", { result: room.result });
      this.sink(room.code, "persistResult", { matchId: room.matchId, roomCode: room.code, startedAt: room.startedAt, endedAt: room.finishedAt, result: room.result });
      this.sink(room.code, "lobby", this.lobbyView(room));
    }
  }
}
