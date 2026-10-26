import type { GameConfig } from "../../../shared/config.ts";
import type { Ack } from "../../../shared/protocol.ts";
import type { MatchManager } from "../matches/matchManager.ts";
import type { Logger } from "../utils/logger.ts";
import { TokenBucket } from "../utils/rateLimiter.ts";

/** The slice of a Socket.IO socket we depend on (lets us test without a network). */
export interface SocketLike {
  id: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, cb: (...args: any[]) => void): unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  emit(event: string, ...args: any[]): unknown;
  join(room: string): unknown;
  leave(room: string): unknown;
  disconnect?(close?: boolean): unknown;
}

type AckFn = (res: Ack<Record<string, unknown>>) => void;
const MAX_STRIKES = 300;

export function registerSocket(
  socket: SocketLike,
  mgr: MatchManager,
  cfg: GameConfig,
  log: Logger,
  now: () => number = Date.now,
  playerId: string = socket.id,
  onDisconnect?: () => void,
  authenticatedName?: string,
): void {
  const lobbyBucket = new TokenBucket(10, 4, now); // lobby actions: bursts of 10, then 4/s
  const inputBucket = new TokenBucket(90, 60, now); // gameplay input: 60/s sustained
  let strikes = 0;

  const strike = (why: string) => {
    strikes++;
    if (strikes === MAX_STRIKES) {
      log.warn("disconnecting abusive client", { id: playerId, why });
      socket.disconnect?.(true);
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handle = (event: string, bucket: TokenBucket, fn: (payload: Record<string, unknown>, ack: AckFn) => void) => {
    socket.on(event, (...args: any[]) => {
      try {
        const last = args[args.length - 1];
        const ack: AckFn = typeof last === "function" ? last : () => {};
        const first = args[0];
        const payload: Record<string, unknown> =
          first && typeof first === "object" && !Array.isArray(first) ? (first as Record<string, unknown>) : {};
        if (!bucket.take()) {
          strike(`rate:${event}`);
          ack({ ok: false, error: "RATE_LIMITED" });
          return;
        }
        fn(payload, ack);
      } catch (err) {
        // A bad client must never crash the process or other matches.
        log.error("handler error", { event, id: playerId, err: String(err) });
      }
    });
  };

  socket.emit("hello", { id: playerId, config: cfg });

  handle("room:create", lobbyBucket, (p, ack) => {
    const res = mgr.createRoom(playerId, authenticatedName ?? p["name"]);
    if (res.ok) {
      socket.join(res.code);
      log.info("room created", { code: res.code, host: playerId });
      ack({ ok: true, code: res.code, lobby: res.lobby, you: playerId });
    } else ack(res);
  });

  handle("room:join", lobbyBucket, (p, ack) => {
    const res = mgr.joinRoom(playerId, p["code"], authenticatedName ?? p["name"]);
    if (res.ok) {
      socket.join(res.code);
      log.info("player joined", { code: res.code, id: playerId });
      ack({ ok: true, code: res.code, lobby: res.lobby, you: playerId });
    } else ack(res);
  });

  handle("room:start", lobbyBucket, (_p, ack) => {
    const res = mgr.startMatch(playerId);
    if (res.ok) log.info("match started", { code: res.code });
    ack(res);
  });

  handle("room:leave", lobbyBucket, (_p, ack) => {
    const code = mgr.roomOf(playerId)?.code;
    mgr.leave(playerId);
    if (code) socket.leave(code);
    ack({ ok: true });
  });

  socket.on("input", (...args: unknown[]) => {
    try {
      if (!inputBucket.take()) return strike("rate:input");
      const res = mgr.handleInput(playerId, args[0]);
      if (!res.ok && res.error === "BAD_PAYLOAD") strike("bad-input");
    } catch (err) {
      log.error("input handler error", { id: playerId, err: String(err) });
    }
  });

  socket.on("disconnect", () => {
    if (onDisconnect) onDisconnect();
    else mgr.leave(playerId);
  });
}
