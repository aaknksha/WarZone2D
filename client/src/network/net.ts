import { io } from "socket.io-client";
import type { Socket } from "socket.io-client";
import type { GameConfig } from "../../../shared/config.ts";
import type { ErrorCode, Hello, LobbyView, MatchResult, PlayerInput, SimEvent, Snapshot } from "../../../shared/protocol.ts";
import { Emitter } from "./emitter.ts";

export type NetError = ErrorCode | "OFFLINE";
export type Res<T = object> = ({ ok: true } & T) | { ok: false; error: NetError };
export type ConnStatus = "connecting" | "online" | "offline";

export interface NetEvents {
  status: ConnStatus;
  lobby: LobbyView;
  matchStart: { code: string; snapshot: Snapshot };
  state: Snapshot;
  events: SimEvent[];
  matchEnd: { result: MatchResult };
  roomClosed: { code: string };
  shutdown: undefined;
}

export class Net extends Emitter<NetEvents> {
  id = "";
  config: GameConfig | null = null;
  status: ConnStatus = "connecting";
  private socket: Socket;

  constructor() {
    super();
    // Session token is scoped to this browser tab; it survives refresh/reconnect.
    // A second tab receives its own identity, so two players can test locally.
    const storageKey = "warzone2d:sessionToken";
    const readToken = () => { try { return sessionStorage.getItem(storageKey) ?? ""; } catch { return ""; } };
    this.socket = io({ autoConnect: false, auth: (cb) => cb({ sessionToken: readToken() }), reconnection: true, reconnectionDelay: 500, reconnectionDelayMax: 3000 });
    const setStatus = (s: ConnStatus) => {
      this.status = s;
      this.emit("status", s);
    };
    this.socket.on("connect", () => setStatus("online"));
    this.socket.on("disconnect", () => setStatus("offline"));
    this.socket.on("connect_error", () => setStatus("offline"));
    this.socket.io.on("reconnect_attempt", () => setStatus("connecting"));
    this.socket.on("hello", (h: Hello) => {
      this.id = h.id;
      try { sessionStorage.setItem(storageKey, h.id); } catch { /* storage unavailable */ }
      this.config = h.config;
    });
    this.socket.on("lobby", (l: LobbyView) => this.emit("lobby", l));
    this.socket.on("matchStart", (m: { code: string; snapshot: Snapshot }) => this.emit("matchStart", m));
    this.socket.on("state", (s: Snapshot) => this.emit("state", s));
    this.socket.on("events", (e: SimEvent[]) => this.emit("events", e));
    this.socket.on("matchEnd", (m: { result: MatchResult }) => this.emit("matchEnd", m));
    this.socket.on("roomClosed", (m: { code: string }) => this.emit("roomClosed", m));
    this.socket.on("server:shutdown", () => this.emit("shutdown", undefined));
    // Let main.ts attach matchStart/lobby listeners before the server replies.
    // Authentication UI calls connect after a successful login/session restore.
  }

  connect(): void { if (!this.socket.connected) this.socket.connect(); }
  disconnect(): void { this.socket.disconnect(); }
  resetIdentity(): void {
    try { sessionStorage.removeItem("warzone2d:sessionToken"); } catch { /* ignore */ }
    this.id = "";
  }
  private request<T extends object>(event: string, payload?: unknown): Promise<Res<T>> {
    return new Promise((resolve) => {
      if (!this.socket.connected) return resolve({ ok: false, error: "OFFLINE" });
      this.socket.timeout(5000).emit(event, payload, (err: unknown, res: Res<T>) =>
        resolve(err || !res ? { ok: false, error: "OFFLINE" } : res),
      );
    });
  }

  create(name: string) {
    return this.request<{ code: string; lobby: LobbyView; you: string }>("room:create", { name });
  }
  join(code: string, name: string) {
    return this.request<{ code: string; lobby: LobbyView; you: string }>("room:join", { code, name });
  }
  start() {
    return this.request<{ code: string }>("room:start");
  }
  leave() {
    return this.request("room:leave");
  }
  sendInput(input: PlayerInput): void {
    if (this.socket.connected) this.socket.volatile.emit("input", input);
  }
}
