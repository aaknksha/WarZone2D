
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { Server } from "socket.io";
import { makeConfig } from "../../shared/config.ts";
import type { GameConfig } from "../../shared/config.ts";
import { MatchManager } from "./matches/matchManager.ts";
import { registerSocket } from "./network/handlers.ts";
import { buildHealth } from "./network/health.ts";
import { log } from "./utils/logger.ts";
import { redisCommand } from "./storage/redisCheckpoint.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

const int = (v: string | undefined) =>
  v && /^\d+$/.test(v) ? Number(v) : undefined;

const overrides: Partial<GameConfig> = {};

const cooldown = int(process.env["FIRE_COOLDOWN_MS"]);
const duration = int(process.env["MATCH_DURATION_MS"]);

if (cooldown !== undefined) overrides.fireCooldownMs = cooldown;
if (duration !== undefined) overrides.matchDurationMs = duration;

const flag = (v: string | undefined) =>
  v === undefined
    ? undefined
    : !["0", "false", "off", "no"].includes(v.toLowerCase());

const respawn = flag(process.env["RESPAWN"]);
if (respawn !== undefined) overrides.respawnEnabled = respawn;

const countdown = int(process.env["COUNTDOWN_MS"]);
if (countdown !== undefined) overrides.countdownMs = countdown;

const rMin = int(process.env["RESPAWN_MIN_MS"]);
const rMax = int(process.env["RESPAWN_MAX_MS"]);
const protection = int(process.env["SPAWN_PROTECTION_MS"]);

if (rMin !== undefined) overrides.respawnMinMs = rMin;
if (rMax !== undefined) overrides.respawnMaxMs = rMax;
if (protection !== undefined) overrides.spawnProtectionMs = protection;

const cfg = makeConfig(overrides);
const port = int(process.env["PORT"]) ?? 3000;
const startedAt = Date.now();

async function persistResult(payload: unknown): Promise<void> {
  const url = process.env["RESULT_API_URL"];
  const secret = process.env["INTERNAL_API_SECRET"];
  if (!url || !secret) return;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-internal-secret": secret },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) return;
      throw new Error(`API HTTP ${response.status}: ${await response.text()}`);
    } catch (err) {
      log.error("match persistence failed", { attempt: attempt + 1, err: String(err) });
      if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
}

const mgr = new MatchManager(cfg, (room, event, payload) => {
  if (event === "persistResult") {
    // Do not expose internal persistence messages to clients.
    void persistResult(payload);
    return;
  }
  io.to(room).emit(event, payload);

  if (event === "roomClosed") {
    io.in(room).socketsLeave(room);
  }
});

const app = express();
app.disable("x-powered-by");

app.get("/health", (_req, res) => {
  res.json(buildHealth(mgr, startedAt));
});

const dist =
  process.env["CLIENT_DIST"] ??
  path.resolve(here, "../../client/dist");

if (fs.existsSync(dist)) {
  app.use(express.static(dist));
} else {
  log.warn("client build not found; serving API only", { dist });
}

const httpServer = createServer(app);

const io = new Server(httpServer, {
  maxHttpBufferSize: 4096,
  pingInterval: 10_000,
  pingTimeout: 10_000,
  serveClient: false,
});

// A stable, high-entropy session identifier survives Socket.IO reconnects.
// This protects against short network outages on the SAME game process.
// Multi-VM failover still requires room ownership and state replication.
const pendingDisconnects = new Map<string, ReturnType<typeof setTimeout>>();
const activeSockets = new Map<string, string>();
const GRACE_MS = 30_000;
io.on("connection", (socket) => {
  if (!recoveryReady || draining) { socket.disconnect(true); return; }
  const supplied = socket.handshake.auth?.sessionToken;
  const playerId = typeof supplied === "string" && /^[0-9a-f-]{36}$/.test(supplied)
    ? supplied : randomUUID();
  const prior = pendingDisconnects.get(playerId);
  if (prior) clearTimeout(prior);
  pendingDisconnects.delete(playerId);
  const oldSocket = activeSockets.get(playerId);
  if (oldSocket && oldSocket !== socket.id) io.sockets.sockets.get(oldSocket)?.disconnect(true);
  activeSockets.set(playerId, socket.id);
  // registerSocket sends hello first; the client must know its player ID and
  // game configuration before receiving a resumed match snapshot.
  registerSocket(socket, mgr, cfg, log, Date.now, playerId, () => {
    // Ignore a superseded connection's disconnect event.
    if (activeSockets.get(playerId) !== socket.id) return;
    activeSockets.delete(playerId);
    const timer = setTimeout(() => {
      pendingDisconnects.delete(playerId);
      if (!activeSockets.has(playerId)) mgr.leave(playerId);
    }, GRACE_MS);
    timer.unref();
    pendingDisconnects.set(playerId, timer);
  });
  const room = mgr.roomOf(playerId);
  if (room) {
    socket.join(room.code);
    if (room.status === "playing" && room.sim) {
      socket.emit("matchStart", { code: room.code, snapshot: room.sim.snapshot() });
      log.info("player resumed match", { code: room.code, id: playerId });
    } else if (room.status === "finished" && room.result) {
      socket.emit("matchEnd", { result: room.result });
    } else {
      socket.emit("lobby", mgr.lobbyView(room));
      log.info("player resumed lobby", { code: room.code, id: playerId });
    }
  }
});

// Phase 3B: single-owner crash-recovery checkpoints. NOT a multi-writer game cluster.
// A stable CHECKPOINT_KEY must be unique per authoritative game-server instance.
const redisUrl = process.env["REDIS_URL"];
const checkpointKey = process.env["CHECKPOINT_KEY"] ?? "warzone:game:local:v1";
let checkpointBusy = false;
let recoveryReady = !redisUrl;
let draining = false;
async function saveCheckpoint() {
  if (!redisUrl || checkpointBusy || !recoveryReady || draining) return;
  checkpointBusy = true;
  try {
    await redisCommand(redisUrl, "SET", checkpointKey, JSON.stringify({
      version: 1, savedAt: Date.now(), rooms: mgr.exportState(),
    }), "EX", "3600");
  } catch (err) {
    log.error("redis checkpoint failed", { err: String(err) });
  } finally { checkpointBusy = false; }
}
async function recoverCheckpoint() {
  if (!redisUrl) return;
  try {
    const raw = await redisCommand(redisUrl, "GET", checkpointKey);
    if (raw) {
      const state = JSON.parse(raw);
      if (state.version === 1 && Date.now() - state.savedAt < 3600_000) {
        const count = mgr.restoreState(state.rooms);
        log.info("redis checkpoint restored", { rooms: count, ageMs: Date.now() - state.savedAt });
      }
    }
  } catch (err) {
    log.error("redis recovery failed", { err: String(err) });
  } finally { recoveryReady = true; }
}
const checkpointTimer = setInterval(() => void saveCheckpoint(), 2000);
checkpointTimer.unref();

let last = performance.now();

const loop = setInterval(() => {
  const t = performance.now();
  const dt = Math.min(t - last, 100);
  last = t;
  mgr.tickAll(dt);
}, 1000 / cfg.tickRate);

const sweeper = setInterval(() => {
  for (const code of mgr.sweep()) {
    log.info("room closed (ttl)", { code });
  }
}, 5000);

void recoverCheckpoint().then(() => {
  httpServer.listen(port, () => {
    log.info("server listening", { port, tickRate: cfg.tickRate, dist, checkpointEnabled: Boolean(redisUrl) });
  });
});

function shutdown(signal: string) {
  log.info("shutting down", { signal });

  draining = true;
  clearInterval(loop);
  clearInterval(sweeper);
  clearInterval(checkpointTimer);
  // Preserve the latest checkpoint before terminating on planned shutdown.
  if (redisUrl) void redisCommand(redisUrl, "SET", checkpointKey, JSON.stringify({
    version: 1, savedAt: Date.now(), rooms: mgr.exportState(),
  }), "EX", "3600").catch((err) => log.error("shutdown checkpoint failed", { err: String(err) }));

  io.emit("server:shutdown");
  io.close(() => process.exit(0));

  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
