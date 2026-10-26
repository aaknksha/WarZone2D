// Wire contract shared by server and client. Types only (erased at runtime).
import type { GameConfig } from "./config.ts";

export interface PlayerInput {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  fire: boolean;
  angle: number;
}

export type ErrorCode =
  | "ALREADY_IN_ROOM"
  | "INVALID_CODE"
  | "ROOM_NOT_FOUND"
  | "ROOM_FULL"
  | "MATCH_STARTED"
  | "NOT_IN_ROOM"
  | "NOT_HOST"
  | "NOT_ENOUGH_PLAYERS"
  | "BAD_STATE"
  | "BAD_PAYLOAD"
  | "SERVER_BUSY"
  | "RATE_LIMITED";

export type RoomStatus = "lobby" | "playing" | "finished";

export interface LobbyView {
  code: string;
  hostId: string;
  status: RoomStatus;
  min: number;
  max: number;
  players: { id: string; name: string; isHost: boolean }[];
}

export type SimEvent =
  | { type: "shot"; owner: string; x: number; y: number; angle: number }
  | { type: "hit"; owner: string; target: string; x: number; y: number; health: number }
  | { type: "wall"; x: number; y: number }
  | { type: "kill"; killer: string | null; victim: string; reason: "killed" | "disconnect"; streak: number }
  | { type: "respawn"; player: string; x: number; y: number }
  | { type: "go" }
  | { type: "end"; reason: MatchEndReason };

export type MatchEndReason = "last_standing" | "time_up" | "opponents_left";

export interface PlayerStanding {
  id: string;
  name: string;
  score: number;
  deaths: number;
  bestStreak: number;
  shots: number;
  hits: number;
  alive: boolean;
  disconnected: boolean;
}

export interface MatchResult {
  reason: MatchEndReason;
  winnerId: string | null; // null on a draw
  winnerIds: string[];
  draw: boolean;
  standings: PlayerStanding[];
}

export interface PlayerSnapshot {
  id: string;
  name: string;
  x: number;
  y: number;
  angle: number;
  health: number;
  score: number;
  deaths: number;
  streak: number;
  alive: boolean;
  /** ms until this (dead) player respawns; 0 when alive or not respawning. */
  respawnInMs: number;
  invulnerable: boolean;
  disconnected: boolean;
}

export interface ProjectileSnapshot {
  id: number;
  x: number;
  y: number;
  angle: number;
  owner: string;
}

export interface Snapshot {
  t: number;
  remainingMs: number;
  /** >0 while the pre-match countdown is running (players frozen, clock stopped). */
  countdownMs: number;
  players: PlayerSnapshot[];
  projectiles: ProjectileSnapshot[];
}

export interface Hello {
  id: string;
  config: GameConfig;
}

export type Ack<T = object> = ({ ok: true } & T) | { ok: false; error: ErrorCode };
