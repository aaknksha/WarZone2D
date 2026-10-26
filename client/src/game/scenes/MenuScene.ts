import Phaser from "phaser";
import { ARENA } from "../../../../shared/map.ts";
import { buildArena } from "../arena.ts";
import { Effects } from "../systems/effects.ts";

/**
 * Backdrop for the menu: the real battlefield with a slowly drifting camera and ambient tracer fire.
 * Purely decorative (no fake players); the actual game is the Game scene.
 */
export class MenuScene extends Phaser.Scene {
  private fx!: Effects;
  private t = 0;
  private nextAmbient = 0;

  constructor() {
    super("Menu");
  }

  create(): void {
    this.t = 0;
    this.nextAmbient = 400;
    buildArena(this);
    this.fx = new Effects(this);
    this.cameras.main.setZoom(1.4).setRoundPixels(true);
  }

  update(_time: number, delta: number): void {
    this.t += delta;
    const cam = this.cameras.main;
    const cx = ARENA.width / 2 + Math.sin(this.t / 9000) * 420;
    const cy = ARENA.height / 2 + Math.cos(this.t / 7000) * 280;
    cam.centerOn(cx, cy);
    if (this.t > this.nextAmbient) {
      this.nextAmbient = this.t + 500 + Math.random() * 900;
      const v = cam.worldView;
      const x = v.x + Math.random() * v.width;
      const y = v.y + Math.random() * v.height;
      const a = Math.random() * Math.PI * 2;
      this.fx.muzzle(x, y, a);
      const b = this.add.image(x, y, "bullet").setRotation(a).setDepth(12);
      this.tweens.add({
        targets: b,
        x: x + Math.cos(a) * 240,
        y: y + Math.sin(a) * 240,
        alpha: 0,
        duration: 380,
        onComplete: () => b.destroy(),
      });
    }
  }
}
