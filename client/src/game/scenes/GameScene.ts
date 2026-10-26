import Phaser from "phaser";
import type { GameConfig } from "../../../../shared/config.ts";
import { moveCircle } from "../../../../shared/collision.ts";
import { ARENA, WALLS } from "../../../../shared/map.ts";
import type { PlayerInput, SimEvent, Snapshot } from "../../../../shared/protocol.ts";
import type { Net } from "../../network/net.ts";
import { buildArena } from "../arena.ts";
import { PlayerView } from "../entities/PlayerView.ts";
import { audio } from "../systems/audio.ts";
import { Effects } from "../systems/effects.ts";

export interface GameInit {
  net: Net;
  you: string;
  config: GameConfig;
  snapshot: Snapshot;
}

interface BulletView {
  img: Phaser.GameObjects.Image;
  vx: number;
  vy: number;
}

const SEND_INTERVAL_MS = 33;

/** The live match. Renders authoritative server state; predicts only the local player's own movement. */
export class GameScene extends Phaser.Scene {
  private data0!: GameInit;
  private views = new Map<string, PlayerView>();
  private bullets = new Map<number, BulletView>();
  private slots = new Map<string, number>();
  private trails!: Phaser.GameObjects.Graphics;
  private fx!: Effects;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private cleanups: (() => void)[] = [];
  private lastSent: PlayerInput | null = null;
  private lastSentAt = 0;
  private followId = "";
  private localMoving = false;
  private countdown = 0;

  constructor() {
    super("Game");
  }

  init(data: GameInit): void {
    this.data0 = data;
    this.views = new Map();
    this.bullets = new Map();
    this.slots = new Map();
    this.cleanups = [];
    this.lastSent = null;
    this.lastSentAt = 0;
    this.followId = "";
    this.localMoving = false;
    this.countdown = 0;
  }

  create(): void {
    const { net, snapshot } = this.data0;
    buildArena(this);
    this.fx = new Effects(this);
    this.trails = this.add.graphics().setDepth(11);

    const cam = this.cameras.main;
    cam.setBounds(0, 0, ARENA.width, ARENA.height).setRoundPixels(true).setBackgroundColor("#0b0f0c");
    const fit = () => cam.setZoom(Phaser.Math.Clamp(Math.min(this.scale.width / 800, this.scale.height / 560), 1, 2.5));
    fit();
    this.scale.on("resize", fit);
    this.cleanups.push(() => this.scale.off("resize", fit));

    const kb = this.input.keyboard!;
    this.keys = kb.addKeys("W,A,S,D,UP,DOWN,LEFT,RIGHT,SPACE", false) as Record<string, Phaser.Input.Keyboard.Key>;
    this.input.mouse?.disableContextMenu();
    this.input.setDefaultCursor("crosshair");

    snapshot.players.forEach((p, i) => this.slots.set(p.id, i));
    this.onState(snapshot);

    this.cleanups.push(net.on("state", (s) => this.onState(s)));
    this.cleanups.push(net.on("events", (e) => this.onEvents(e)));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.cleanups.forEach((fn) => fn());
      this.input.setDefaultCursor("default");
    });
  }

  private me(): PlayerView | undefined {
    return this.views.get(this.data0.you);
  }

  private onState(s: Snapshot): void {
    const { you } = this.data0;
    this.countdown = s.countdownMs;
    for (const p of s.players) {
      let v = this.views.get(p.id);
      if (!v) {
        v = new PlayerView(this, p, this.slots.get(p.id) ?? this.views.size, p.id === you);
        this.views.set(p.id, v);
        if (v.isLocal) this.cameras.main.startFollow(v.sprite, true, 0.15, 0.15);
      }
      const revived = v.applyServer(p, this.localMoving);
      if (revived && v.isLocal) {
        this.followId = "";
        this.cameras.main.startFollow(v.sprite, true, 0.15, 0.15);
      }
    }
    const seen = new Set<number>();
    for (const pr of s.projectiles) {
      seen.add(pr.id);
      const speed = this.data0.config.projectileSpeed;
      let b = this.bullets.get(pr.id);
      if (!b) {
        b = { img: this.add.image(pr.x, pr.y, "bullet").setDepth(12).setRotation(pr.angle), vx: Math.cos(pr.angle) * speed, vy: Math.sin(pr.angle) * speed };
        this.bullets.set(pr.id, b);
      }
      b.img.setPosition(pr.x, pr.y);
    }
    for (const [id, b] of this.bullets) {
      if (!seen.has(id)) {
        b.img.destroy();
        this.bullets.delete(id);
      }
    }
  }

  private onEvents(events: SimEvent[]): void {
    const me = this.me();
    const vol = (x: number, y: number) => (me ? Phaser.Math.Clamp(1 - Math.hypot(x - me.x, y - me.y) / 900, 0.12, 1) : 1);
    for (const e of events) {
      if (e.type === "shot") {
        this.fx.muzzle(e.x, e.y, e.angle);
        audio.shoot(vol(e.x, e.y));
      } else if (e.type === "hit") {
        this.fx.impact(e.x, e.y);
        this.fx.floatText(e.x, e.y, "-20");
        audio.hit(vol(e.x, e.y));
        if (e.target === this.data0.you) this.cameras.main.shake(110, 0.004);
      } else if (e.type === "wall") {
        this.fx.wall(e.x, e.y);
      } else if (e.type === "respawn") {
        this.fx.spawn(e.x, e.y);
      } else if (e.type === "kill") {
        const v = this.views.get(e.victim);
        if (v) {
          this.fx.eliminate(v.x, v.y);
          audio.kill(vol(v.x, v.y));
          if (v.alive) v.setDead();
        }
        if (e.victim === this.data0.you) this.cameras.main.shake(260, 0.01);
      }
    }
  }

  update(time: number, delta: number): void {
    const cfg = this.data0.config;
    const me = this.me();

    if (me && me.alive && this.countdown > 0) {
      this.localMoving = false; // frozen until FIGHT
    } else if (me && me.alive) {
      const pointer = this.input.activePointer;
      const wp = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      const angle = Math.atan2(wp.y - me.y, wp.x - me.x);
      const k = this.keys;
      const input: PlayerInput = {
        up: !!(k["W"]?.isDown || k["UP"]?.isDown),
        down: !!(k["S"]?.isDown || k["DOWN"]?.isDown),
        left: !!(k["A"]?.isDown || k["LEFT"]?.isDown),
        right: !!(k["D"]?.isDown || k["RIGHT"]?.isDown),
        fire: pointer.leftButtonDown() || !!k["SPACE"]?.isDown,
        angle,
      };
      // Local prediction mirrors the server's movement so controls feel instant.
      const mx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      const my = (input.down ? 1 : 0) - (input.up ? 1 : 0);
      this.localMoving = mx !== 0 || my !== 0;
      if (this.localMoving) {
        const len = Math.hypot(mx, my);
        const step = (cfg.playerSpeed * delta) / 1000;
        const np = moveCircle(me, (mx / len) * step, (my / len) * step, cfg.playerRadius, WALLS, ARENA);
        me.x = np.x;
        me.y = np.y;
      }
      me.setAim(angle);
      this.maybeSend(input, time);
    } else {
      this.localMoving = false;
      if (!me?.respawning) this.spectate(); // while a respawn is pending the camera stays where you fell
    }

    for (const v of this.views.values()) v.update(delta);

    const dt = delta / 1000;
    this.trails.clear();
    for (const b of this.bullets.values()) {
      b.img.x += b.vx * dt;
      b.img.y += b.vy * dt;
      const len = Math.hypot(b.vx, b.vy) || 1;
      const tx = (b.vx / len) * 22;
      const ty = (b.vy / len) * 22;
      this.trails.lineStyle(2, 0xffb020, 0.2).lineBetween(b.img.x - tx, b.img.y - ty, b.img.x, b.img.y);
      this.trails.lineStyle(1, 0xfff2a8, 0.6).lineBetween(b.img.x - tx / 2, b.img.y - ty / 2, b.img.x, b.img.y);
    }
  }

  private maybeSend(input: PlayerInput, now: number): void {
    const last = this.lastSent;
    const flagsChanged =
      !last ||
      last.up !== input.up ||
      last.down !== input.down ||
      last.left !== input.left ||
      last.right !== input.right ||
      last.fire !== input.fire;
    const aimChanged = !last || Math.abs(Phaser.Math.Angle.Wrap(last.angle - input.angle)) > 0.03;
    const due = now - this.lastSentAt >= SEND_INTERVAL_MS;
    if ((flagsChanged && due) || (aimChanged && due)) {
      this.data0.net.sendInput(input);
      this.lastSent = input;
      this.lastSentAt = now;
    }
  }

  /** Once eliminated, the camera follows a surviving player. */
  private spectate(): void {
    const target = [...this.views.values()].find((v) => v.alive && !v.isLocal);
    if (target && this.followId !== target.id) {
      this.followId = target.id;
      this.cameras.main.startFollow(target.sprite, true, 0.1, 0.1);
    }
  }
}
