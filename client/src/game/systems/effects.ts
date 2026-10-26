import Phaser from "phaser";

/** Muzzle flashes, impacts, dust, blood, explosions and floating damage numbers. */
export class Effects {
  private scene: Phaser.Scene;
  private sparks: Phaser.GameObjects.Particles.ParticleEmitter;
  private blood: Phaser.GameObjects.Particles.ParticleEmitter;
  private dustFx: Phaser.GameObjects.Particles.ParticleEmitter;
  private blast: Phaser.GameObjects.Particles.ParticleEmitter;
  private splats: Phaser.GameObjects.Image[] = [];

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    const base = { emitting: false, alpha: { start: 1, end: 0 } };
    this.sparks = scene.add
      .particles(0, 0, "spark", { ...base, speed: { min: 60, max: 200 }, lifespan: { min: 150, max: 320 }, scale: { start: 1.1, end: 0 }, tint: [0xffee88, 0xffaa22] })
      .setDepth(15);
    this.blood = scene.add
      .particles(0, 0, "spark", { ...base, speed: { min: 30, max: 130 }, lifespan: { min: 250, max: 500 }, scale: { start: 1.3, end: 0 }, tint: [0xaa0000, 0xdd1111] })
      .setDepth(15);
    this.dustFx = scene.add
      .particles(0, 0, "spark", { ...base, speed: { min: 20, max: 90 }, lifespan: { min: 200, max: 450 }, scale: { start: 1.6, end: 0 }, tint: [0x9c8a6e, 0x6b5a40] })
      .setDepth(15);
    this.blast = scene.add
      .particles(0, 0, "spark", { ...base, speed: { min: 40, max: 260 }, lifespan: { min: 300, max: 700 }, scale: { start: 2.4, end: 0 }, tint: [0xffcc33, 0xff6a00, 0x666666] })
      .setDepth(16);
  }

  muzzle(x: number, y: number, angle: number): void {
    const f = this.scene.add
      .image(x + Math.cos(angle) * 24, y + Math.sin(angle) * 24, "flash")
      .setRotation(angle)
      .setDepth(16)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.scene.tweens.add({ targets: f, alpha: 0, scale: 1.7, duration: 70, onComplete: () => f.destroy() });
  }

  impact(x: number, y: number): void {
    this.sparks.explode(6, x, y);
    this.blood.explode(10, x, y);
  }

  wall(x: number, y: number): void {
    this.sparks.explode(4, x, y);
    this.dustFx.explode(5, x, y);
  }

  eliminate(x: number, y: number): void {
    this.blast.explode(26, x, y);
    this.blood.explode(18, x, y);
    const s = this.scene.add.image(x, y, "splat").setDepth(3).setRotation(Math.random() * 6.28).setScale(1.4);
    this.splats.push(s);
    if (this.splats.length > 12) this.splats.shift()?.destroy();
  }

  spawn(x: number, y: number): void {
    const ring = this.scene.add.circle(x, y, 10).setStrokeStyle(3, 0x66fff2, 1).setDepth(16);
    this.scene.tweens.add({ targets: ring, scale: 4.5, alpha: 0, duration: 520, onComplete: () => ring.destroy() });
    this.sparks.explode(12, x, y);
  }

  floatText(x: number, y: number, text: string, color = "#ff5a4a"): void {
    const t = this.scene.add
      .text(x, y - 18, text, { fontFamily: "monospace", fontSize: "12px", color, stroke: "#000", strokeThickness: 3 })
      .setOrigin(0.5)
      .setDepth(25);
    this.scene.tweens.add({ targets: t, y: y - 44, alpha: 0, duration: 700, onComplete: () => t.destroy() });
  }
}
