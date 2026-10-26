import Phaser from "phaser";
import type { PlayerSnapshot } from "../../../../shared/protocol.ts";
import { SLOT_COLORS } from "../palette.ts";

const shortestAngle = (from: number, to: number) => Phaser.Math.Angle.Wrap(to - from);

/** Visual for one player: soldier sprite, name, health bar, and a ring marking the local player. */
export class PlayerView {
  readonly id: string;
  readonly slot: number;
  readonly isLocal: boolean;
  x: number;
  y: number;
  angle: number;
  health = 100;
  alive = true;
  /** true while dead but a respawn is scheduled (camera stays put instead of spectating). */
  respawning = false;
  private invulnerable = false;
  private blink = 0;
  readonly sprite: Phaser.GameObjects.Sprite;
  private label: Phaser.GameObjects.Text;
  private bar: Phaser.GameObjects.Graphics;
  private ring?: Phaser.GameObjects.Graphics;
  private marker?: Phaser.GameObjects.Graphics;
  private tx: number;
  private ty: number;
  private tAngle: number;
  private walking = false;
  private px: number;
  private py: number;

  constructor(scene: Phaser.Scene, p: PlayerSnapshot, slot: number, isLocal: boolean) {
    this.id = p.id;
    this.slot = slot;
    this.isLocal = isLocal;
    this.x = this.tx = this.px = p.x;
    this.y = this.ty = this.py = p.y;
    this.angle = this.tAngle = p.angle;
    this.sprite = scene.add.sprite(p.x, p.y, `pl${slot}`, 1).setDepth(10);
    this.label = scene.add
      .text(p.x, p.y - 30, p.name, { fontFamily: "monospace", fontSize: "10px", color: "#ffffff", stroke: "#000000", strokeThickness: 3 })
      .setOrigin(0.5)
      .setDepth(20);
    this.bar = scene.add.graphics().setDepth(20);
    if (isLocal) {
      this.ring = scene.add.graphics().setDepth(9);
      this.ring.lineStyle(2, 0x66fff2, 0.7).strokeCircle(0, 0, 19);
      this.marker = scene.add.graphics().setDepth(21);
      this.marker.fillStyle(0x66fff2, 1).fillTriangle(-5, 0, 5, 0, 0, 6);
      scene.tweens.add({ targets: this.ring, alpha: 0.35, yoyo: true, repeat: -1, duration: 700 });
    }
    this.health = p.health;
    this.drawBar();
    if (!p.alive) this.setDead();
    this.syncVisual();
  }

  /** Authoritative state arrives here. Remote players ease toward it; the local player only corrects when it drifts. */
  applyServer(p: PlayerSnapshot, localMoving: boolean): boolean {
    let revived = false;
    if (p.health !== this.health) {
      this.health = p.health;
      this.drawBar();
    }
    if (!p.alive && this.alive) this.setDead();
    if (p.alive && !this.alive) {
      this.revive(p);
      revived = true;
    }
    this.respawning = !p.alive && p.respawnInMs > 0;
    this.invulnerable = p.invulnerable;
    this.tx = p.x;
    this.ty = p.y;
    if (this.isLocal) {
      const err = Math.hypot(p.x - this.x, p.y - this.y);
      if (!p.alive || err > 120) {
        this.x = p.x;
        this.y = p.y;
      } else if (localMoving) {
        if (err > 40) {
          this.x += (p.x - this.x) * 0.2;
          this.y += (p.y - this.y) * 0.2;
        }
      } else if (err > 0.5) {
        this.x += (p.x - this.x) * 0.35;
        this.y += (p.y - this.y) * 0.35;
      }
    } else {
      this.tAngle = p.angle;
    }
    return revived;
  }

  private revive(p: PlayerSnapshot): void {
    this.alive = true;
    this.x = this.tx = this.px = p.x;
    this.y = this.ty = this.py = p.y;
    this.angle = this.tAngle = p.angle;
    this.health = p.health;
    this.walking = false;
    this.sprite.clearTint().setAlpha(1).setDepth(10).setFrame(1);
    this.label.setAlpha(1);
    this.bar.setVisible(true);
    this.ring?.setVisible(true);
    this.marker?.setVisible(true);
    this.drawBar();
  }

  setAim(angle: number): void {
    this.angle = angle;
  }

  setDead(): void {
    this.alive = false;
    this.sprite.anims.stop();
    this.sprite.setFrame(1).setTint(0x555555).setAlpha(0.55).setDepth(8);
    this.label.setAlpha(0.4);
    this.bar.setVisible(false);
    this.ring?.setVisible(false);
    this.marker?.setVisible(false);
  }

  update(dtMs: number): void {
    if (!this.isLocal && this.alive) {
      const k = 1 - Math.exp(-(dtMs / 1000) * 18);
      this.x += (this.tx - this.x) * k;
      this.y += (this.ty - this.y) * k;
      this.angle += shortestAngle(this.angle, this.tAngle) * k;
    }
    const moved = Math.hypot(this.x - this.px, this.y - this.py) > 0.15;
    this.px = this.x;
    this.py = this.y;
    this.blink += dtMs;
    if (this.alive) this.sprite.setAlpha(this.invulnerable ? 0.45 + 0.4 * Math.abs(Math.sin(this.blink / 90)) : 1);
    if (this.alive) {
      if (moved && !this.walking) {
        this.walking = true;
        this.sprite.anims.play(`walk${this.slot}`, true);
      } else if (!moved && this.walking) {
        this.walking = false;
        this.sprite.anims.stop();
        this.sprite.setFrame(1);
      }
    }
    this.syncVisual();
  }

  private syncVisual(): void {
    this.sprite.setPosition(this.x, this.y).setRotation(this.angle);
    this.label.setPosition(this.x, this.y - 32);
    this.bar.setPosition(this.x, this.y - 26);
    this.ring?.setPosition(this.x, this.y);
    this.marker?.setPosition(this.x, this.y - 44);
  }

  private drawBar(): void {
    const w = 28;
    const pct = Phaser.Math.Clamp(this.health / 100, 0, 1);
    this.bar.clear();
    this.bar.fillStyle(0x000000, 0.7).fillRect(-w / 2 - 1, -1, w + 2, 6);
    const col = pct > 0.6 ? 0x5bff6a : pct > 0.3 ? 0xffc83a : 0xff4a3a;
    this.bar.fillStyle(col, 1).fillRect(-w / 2, 0, Math.round(w * pct), 4);
    this.bar.fillStyle(SLOT_COLORS[this.slot] ?? 0xffffff, 1).fillRect(-w / 2, 5, w, 1);
  }

  destroy(): void {
    this.sprite.destroy();
    this.label.destroy();
    this.bar.destroy();
    this.ring?.destroy();
    this.marker?.destroy();
  }
}
