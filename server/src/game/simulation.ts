import type { GameConfig } from "../../../shared/config.ts";
import { ARENA, WALLS, SPAWNS } from "../../../shared/map.ts";
import {
  expandRect,
  moveCircle,
  segmentCircleEntry,
  segmentRectEntry,
} from "../../../shared/collision.ts";
import type {
  MatchEndReason,
  MatchResult,
  PlayerInput,
  PlayerStanding,
  SimEvent,
  Snapshot,
} from "../../../shared/protocol.ts";

export type { PlayerInput, SimEvent, PlayerStanding, MatchResult, Snapshot, MatchEndReason };

export interface SimPlayer {
  id: string;
  name: string;
  x: number;
  y: number;
  angle: number;
  health: number;
  score: number; // kills (1 point per elimination)
  deaths: number;
  streak: number; // kills since last death
  bestStreak: number;
  shots: number;
  hits: number;
  alive: boolean;
  disconnected: boolean;
  respawnAt: number | null; // sim time at which a dead player returns
  invulnUntil: number; // sim time until which spawn protection lasts
  lastFireAt: number;
  input: PlayerInput;
}

export interface Projectile {
  id: number;
  owner: string;
  x: number;
  y: number;
  angle: number;
  ageMs: number;
}

const IDLE: PlayerInput = { up: false, down: false, left: false, right: false, fire: false, angle: 0 };
const r1 = (n: number) => Math.round(n * 10) / 10;
const centreAngle = (x: number, y: number) => Math.atan2(ARENA.height / 2 - y, ARENA.width / 2 - x);

export class GameSimulation {
  readonly config: GameConfig;
  readonly players = new Map<string, SimPlayer>();
  projectiles: Projectile[] = [];
  /** Match clock. Starts counting only after the pre-match countdown. */
  elapsedMs = 0;
  countdownMs: number;
  result: MatchResult | null = null;
  private events: SimEvent[] = [];
  private nextProjectileId = 1;
  private rng: () => number;

  constructor(config: GameConfig, roster: { id: string; name: string }[], rng: () => number = Math.random) {
    this.config = config;
    this.rng = rng;
    this.countdownMs = config.countdownMs;
    roster.forEach((p, i) => {
      const s = SPAWNS[i % SPAWNS.length]!;
      this.players.set(p.id, {
        id: p.id,
        name: p.name,
        x: s.x,
        y: s.y,
        angle: centreAngle(s.x, s.y),
        health: config.startHealth,
        score: 0,
        deaths: 0,
        streak: 0,
        bestStreak: 0,
        shots: 0,
        hits: 0,
        alive: true,
        disconnected: false,
        respawnAt: null,
        invulnUntil: 0,
        lastFireAt: -Infinity,
        input: { ...IDLE },
      });
    });
  }

  get finished(): boolean {
    return this.result !== null;
  }

  /** Accepts already-validated input. Returns false if the action must be rejected. */
  setInput(id: string, input: PlayerInput): boolean {
    const p = this.players.get(id);
    if (!p || !p.alive || p.disconnected || this.finished) return false;
    p.input = input;
    p.angle = input.angle;
    return true;
  }

  tick(dtMs: number): void {
    if (this.finished) return;
    const cfg = this.config;

    // Pre-match countdown: everything frozen, match clock not running.
    if (this.countdownMs > 0) {
      this.countdownMs = Math.max(0, this.countdownMs - dtMs);
      if (this.countdownMs === 0) this.events.push({ type: "go" });
      return;
    }

    const dt = dtMs / 1000;
    this.elapsedMs += dtMs;

    for (const p of this.players.values()) {
      if (!p.alive && p.respawnAt !== null && !p.disconnected && this.elapsedMs >= p.respawnAt) this.respawn(p);
    }

    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const mx = (p.input.right ? 1 : 0) - (p.input.left ? 1 : 0);
      const my = (p.input.down ? 1 : 0) - (p.input.up ? 1 : 0);
      if (mx !== 0 || my !== 0) {
        const len = Math.hypot(mx, my);
        const step = cfg.playerSpeed * dt;
        const np = moveCircle(p, (mx / len) * step, (my / len) * step, cfg.playerRadius, WALLS, ARENA);
        p.x = np.x;
        p.y = np.y;
      }
      if (p.input.fire && this.elapsedMs - p.lastFireAt >= cfg.fireCooldownMs) {
        p.lastFireAt = this.elapsedMs;
        p.shots++;
        this.projectiles.push({ id: this.nextProjectileId++, owner: p.id, x: p.x, y: p.y, angle: p.angle, ageMs: 0 });
        this.events.push({ type: "shot", owner: p.id, x: r1(p.x), y: r1(p.y), angle: p.angle });
      }
    }

    this.stepProjectiles(dtMs);

    // Timer expiry only matters if nothing else finished the match this tick.
    if (!this.finished && this.elapsedMs >= cfg.matchDurationMs) this.finish("time_up", null);
  }

  private stepProjectiles(dtMs: number): void {
    const cfg = this.config;
    const step = (cfg.projectileSpeed * dtMs) / 1000;
    const solid = WALLS.map((w) => expandRect(w, cfg.projectileRadius));
    const reach = cfg.playerRadius + cfg.projectileRadius;
    const survivors: Projectile[] = [];

    for (const pr of this.projectiles) {
      if (this.finished) break;
      pr.ageMs += dtMs;
      if (pr.ageMs > cfg.projectileLifetimeMs) continue;

      const x0 = pr.x;
      const y0 = pr.y;
      const x1 = x0 + Math.cos(pr.angle) * step;
      const y1 = y0 + Math.sin(pr.angle) * step;
      let blocked = false;

      // Walls shorten the segment so a target hiding behind cover cannot be hit through it.
      let tWall = 1;
      for (const w of solid) {
        const t = segmentRectEntry(x0, y0, x1, y1, w);
        if (t !== null && t < tWall) {
          tWall = t;
          blocked = true;
        }
      }
      if (x1 < 0 || x1 > ARENA.width || y1 < 0 || y1 > ARENA.height) {
        blocked = true;
        tWall = Math.min(tWall, 0.999);
      }
      const ex = x0 + (x1 - x0) * tWall;
      const ey = y0 + (y1 - y0) * tWall;

      let victim: SimPlayer | null = null;
      let tHit = Infinity;
      for (const p of this.players.values()) {
        if (!p.alive || p.id === pr.owner) continue;
        if (this.elapsedMs < p.invulnUntil) continue; // spawn protection: shots pass through
        const t = segmentCircleEntry(x0, y0, ex, ey, p.x, p.y, reach);
        if (t !== null && t < tHit) {
          tHit = t;
          victim = p;
        }
      }

      if (victim) {
        this.applyHit(pr, victim);
        continue; // projectile consumed: a single projectile can never damage twice
      }
      if (blocked) {
        this.events.push({ type: "wall", x: r1(ex), y: r1(ey) });
        continue;
      }
      pr.x = ex;
      pr.y = ey;
      survivors.push(pr);
    }
    this.projectiles = this.finished ? [] : survivors;
  }

  private applyHit(pr: Projectile, victim: SimPlayer): void {
    const owner = this.players.get(pr.owner);
    victim.health = Math.max(0, victim.health - this.config.hitDamage);
    if (owner) owner.hits++;
    this.events.push({ type: "hit", owner: pr.owner, target: victim.id, x: r1(victim.x), y: r1(victim.y), health: victim.health });
    if (victim.health === 0) this.eliminate(victim, pr.owner, "killed");
  }

  private eliminate(victim: SimPlayer, killerId: string | null, reason: "killed" | "disconnect"): void {
    if (!victim.alive) return; // guards against duplicate points
    victim.alive = false;
    victim.health = 0;
    victim.deaths++;
    victim.streak = 0;
    victim.input = { ...IDLE };
    const killer = killerId && killerId !== victim.id ? this.players.get(killerId) : undefined;
    if (killer) {
      killer.score++;
      killer.streak++;
      killer.bestStreak = Math.max(killer.bestStreak, killer.streak);
    }
    if (this.config.respawnEnabled && !victim.disconnected) victim.respawnAt = this.elapsedMs + this.respawnDelay();
    this.events.push({ type: "kill", killer: killer ? killer.id : null, victim: victim.id, reason, streak: killer ? killer.streak : 0 });
    this.checkEarlyFinish();
  }

  private respawnDelay(): number {
    const lo = Math.min(this.config.respawnMinMs, this.config.respawnMaxMs);
    const hi = Math.max(this.config.respawnMinMs, this.config.respawnMaxMs);
    return lo + this.rng() * (hi - lo);
  }

  /** Spawn point whose nearest living opponent is farthest away, so respawns are not instantly lethal. */
  private safestSpawn(forId: string): { x: number; y: number } {
    const others = [...this.players.values()].filter((p) => p.alive && p.id !== forId);
    if (others.length === 0) return SPAWNS[Math.floor(this.rng() * SPAWNS.length)]!;
    let best = SPAWNS[0]!;
    let bestScore = -1;
    for (const s of SPAWNS) {
      const nearest = Math.min(...others.map((o) => Math.hypot(o.x - s.x, o.y - s.y)));
      if (nearest > bestScore) {
        bestScore = nearest;
        best = s;
      }
    }
    return best;
  }

  private respawn(p: SimPlayer): void {
    const s = this.safestSpawn(p.id);
    p.x = s.x;
    p.y = s.y;
    p.angle = centreAngle(s.x, s.y);
    p.health = this.config.startHealth;
    p.alive = true;
    p.respawnAt = null;
    p.invulnUntil = this.elapsedMs + this.config.spawnProtectionMs;
    p.input = { ...IDLE };
    this.events.push({ type: "respawn", player: p.id, x: r1(p.x), y: r1(p.y) });
  }

  private checkEarlyFinish(): void {
    if (this.finished) return;
    if (this.config.respawnEnabled) {
      // With respawn, kills never end the match; only opponents leaving can.
      const connected = [...this.players.values()].filter((p) => !p.disconnected);
      if (connected.length <= 1) this.finish("opponents_left", connected[0]?.id ?? null);
      return;
    }
    const alive = [...this.players.values()].filter((p) => p.alive);
    if (alive.length <= 1) this.finish("last_standing", alive[0]?.id ?? null);
  }

  /** Idempotent: the first condition to fire decides the result, so results can never contradict. */
  private finish(reason: MatchEndReason, forcedWinner: string | null): void {
    if (this.result) return;
    const standings: PlayerStanding[] = [...this.players.values()]
      .map((p) => ({
        id: p.id,
        name: p.name,
        score: p.score,
        deaths: p.deaths,
        bestStreak: p.bestStreak,
        shots: p.shots,
        hits: p.hits,
        alive: p.alive,
        disconnected: p.disconnected,
      }))
      .sort((a, b) => b.score - a.score || a.deaths - b.deaths);

    let winnerIds: string[];
    if (forcedWinner) {
      winnerIds = [forcedWinner];
    } else {
      const top = Math.max(...standings.map((s) => s.score));
      winnerIds = standings.filter((s) => s.score === top).map((s) => s.id);
    }
    const draw = winnerIds.length !== 1;
    this.result = { reason, winnerId: draw ? null : winnerIds[0]!, winnerIds, draw, standings };
    this.events.push({ type: "end", reason });
  }

  /** A disconnect removes the player for good (no respawn, no point awarded to anyone). */
  removePlayer(id: string): void {
    const p = this.players.get(id);
    if (!p || p.disconnected) return;
    p.disconnected = true;
    p.respawnAt = null;
    this.projectiles = this.projectiles.filter((pr) => pr.owner !== id);
    if (this.finished) return;
    this.eliminate(p, null, "disconnect"); // no-op if already dead
    this.checkEarlyFinish();
  }

  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  /** Full authoritative checkpoint, including internal timers and projectiles. */
  exportState() {
    return {
      elapsedMs: this.elapsedMs, countdownMs: this.countdownMs,
      players: [...this.players.values()], projectiles: this.projectiles,
      nextProjectileId: this.nextProjectileId, result: this.result,
    };
  }

  static restore(config: GameConfig, state: ReturnType<GameSimulation["exportState"]>): GameSimulation {
    const sim = new GameSimulation(config, []);
    sim.elapsedMs = state.elapsedMs;
    sim.countdownMs = state.countdownMs;
    sim.projectiles = state.projectiles ?? [];
    sim.nextProjectileId = state.nextProjectileId ?? 1;
    sim.result = state.result ?? null;
    for (const p of state.players) {
      // Do not replay held keys or firing after a process restart.
      sim.players.set(p.id, { ...p, input: { ...IDLE } });
    }
    return sim;
  }

  snapshot(): Snapshot {
    return {
      t: Math.round(this.elapsedMs),
      remainingMs: Math.max(0, Math.round(this.config.matchDurationMs - this.elapsedMs)),
      countdownMs: Math.round(this.countdownMs),
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        x: r1(p.x),
        y: r1(p.y),
        angle: Math.round(p.angle * 100) / 100,
        health: p.health,
        score: p.score,
        deaths: p.deaths,
        streak: p.streak,
        alive: p.alive,
        respawnInMs: p.respawnAt === null ? 0 : Math.max(0, Math.round(p.respawnAt - this.elapsedMs)),
        invulnerable: p.alive && this.elapsedMs < p.invulnUntil,
        disconnected: p.disconnected,
      })),
      projectiles: this.projectiles.map((pr) => ({ id: pr.id, x: r1(pr.x), y: r1(pr.y), angle: pr.angle, owner: pr.owner })),
    };
  }
}
