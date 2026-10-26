import Phaser from "phaser";
import { WALLS } from "../../../shared/map.ts";
import type { Rect } from "../../../shared/map.ts";

// All art is drawn in code: no external assets, so nothing can be missing or broken.

type Ctx = CanvasRenderingContext2D;
const rect = (c: Ctx, x: number, y: number, w: number, h: number, col: string) => {
  c.fillStyle = col;
  c.fillRect(x, y, w, h);
};
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function canvas(scene: Phaser.Scene, key: string, w: number, h: number) {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const tex = scene.textures.createCanvas(key, w, h);
  if (!tex) throw new Error(`could not create texture ${key}`);
  return tex;
}

function ground(scene: Phaser.Scene) {
  const t = canvas(scene, "ground", 64, 64);
  const c = t.context;
  const r = rng(11);
  rect(c, 0, 0, 64, 64, "#3f6b2f");
  for (let y = 0; y < 64; y += 2)
    for (let x = 0; x < 64; x += 2) {
      const v = r();
      if (v > 0.95) rect(c, x, y, 2, 2, "#2f5222");
      else if (v > 0.8) rect(c, x, y, 2, 2, "#487a37");
      else if (v > 0.55) rect(c, x, y, 2, 2, "#3a6129");
    }
  for (let i = 0; i < 26; i++) {
    const x = Math.floor(r() * 62);
    const y = Math.floor(r() * 60);
    rect(c, x, y, 1, 3, "#5d9144");
    rect(c, x + 1, y + 1, 1, 2, "#4f8038");
  }
  for (let i = 0; i < 4; i++) rect(c, Math.floor(r() * 62), Math.floor(r() * 62), 2, 2, i % 2 ? "#e8e19a" : "#d9d9d9");
  t.refresh();
}

function dirt(scene: Phaser.Scene) {
  const t = canvas(scene, "dirt", 64, 64);
  const c = t.context;
  const r = rng(5);
  rect(c, 0, 0, 64, 64, "#7a5c3a");
  for (let y = 0; y < 64; y += 2)
    for (let x = 0; x < 64; x += 2) {
      const v = r();
      if (v > 0.9) rect(c, x, y, 2, 2, "#9c8a6e");
      else if (v > 0.65) rect(c, x, y, 2, 2, "#876745");
      else if (v > 0.35) rect(c, x, y, 2, 2, "#6d5233");
    }
  t.refresh();
}

function hazard(scene: Phaser.Scene) {
  const t = canvas(scene, "hazard", 16, 16);
  const c = t.context;
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) rect(c, x, y, 1, 1, (x + y) % 16 < 8 ? "#c9a227" : "#1d1f22");
  t.refresh();
}

function concrete(c: Ctx, w: number, h: number, seed: number) {
  const r = rng(seed);
  rect(c, 0, 0, w, h, "#7a7f85");
  for (let y = 0; y < h; y += 4)
    for (let x = 0; x < w; x += 4) {
      const v = r();
      if (v > 0.7) rect(c, x, y, 4, 4, "#868b91");
      else if (v < 0.25) rect(c, x, y, 4, 4, "#70757b");
    }
  rect(c, 0, 0, w, 2, "#a3a8ad");
  rect(c, 0, 0, 2, h, "#959aa0");
  rect(c, 0, h - 2, w, 2, "#565a5f");
  rect(c, w - 2, 0, 2, h, "#60646a");
  const cracks = Math.max(2, Math.floor((w * h) / 900));
  for (let i = 0; i < cracks; i++) {
    let x = 3 + Math.floor(r() * Math.max(1, w - 6));
    const y0 = 3 + Math.floor(r() * Math.max(1, h - 6));
    for (let k = 0; k < 6 && y0 + k < h - 2; k++) {
      rect(c, x, y0 + k, 1, 1, "#3f4246");
      if (r() > 0.5 && x < w - 3) x += 1;
    }
  }
  c.strokeStyle = "#3b3e42";
  c.lineWidth = 1;
  c.strokeRect(0.5, 0.5, w - 1, h - 1);
}

function sandbags(c: Ctx, w: number, h: number) {
  rect(c, 0, 0, w, h, "#5a4a2b");
  const rows = Math.max(1, Math.floor(h / 10));
  for (let row = 0; row < rows; row++) {
    const off = row % 2 ? 9 : 0;
    for (let x = -off; x < w; x += 18) {
      const bx = Math.max(0, x);
      const bw = Math.min(w, x + 18) - bx;
      if (bw <= 2) continue;
      const by = row * 10;
      rect(c, bx, by, bw, 10, "#5a4a2b");
      rect(c, bx + 1, by + 1, bw - 2, 8, "#b59a5e");
      rect(c, bx + 1, by + 1, bw - 2, 2, "#cfb577");
      rect(c, bx + 1, by + 7, bw - 2, 2, "#8d7646");
      rect(c, bx + Math.floor(bw / 2), by + 3, 1, 3, "#8d7646");
    }
  }
}

function crate(c: Ctx, w: number, h: number) {
  rect(c, 0, 0, w, h, "#8a5a2b");
  for (let x = 6; x < w; x += 12) rect(c, x, 0, 1, h, "#6b4220");
  rect(c, 0, 0, w, 4, "#6b4220");
  rect(c, 0, h - 4, w, 4, "#6b4220");
  rect(c, 0, 0, 4, h, "#6b4220");
  rect(c, w - 4, 0, 4, h, "#6b4220");
  for (let i = 4; i < Math.min(w, h) - 6; i++) {
    rect(c, i, i, 3, 3, "#a87439");
    rect(c, w - 3 - i, i, 3, 3, "#a87439");
  }
  for (const [x, y] of [[1, 1], [w - 3, 1], [1, h - 3], [w - 3, h - 3]] as const) rect(c, x, y, 2, 2, "#d3c07c");
  c.strokeStyle = "#3b2410";
  c.strokeRect(0.5, 0.5, w - 1, h - 1);
}

function walls(scene: Phaser.Scene) {
  WALLS.forEach((w: Rect, i: number) => {
    const t = canvas(scene, `wall${i}`, w.w, w.h);
    if (w.h <= 40 && w.w > 100) sandbags(t.context, w.w, w.h);
    else if (w.w === w.h) crate(t.context, w.w, w.h);
    else concrete(t.context, w.w, w.h, 100 + i);
    t.refresh();
  });
}

const PALETTES = [
  { body: "#2f6fd0", dark: "#1f4a96", helmet: "#4a86e6", light: "#8db8ff" },
  { body: "#c93c2e", dark: "#8d2a20", helmet: "#e0584a", light: "#ff9d92" },
  { body: "#c9a21f", dark: "#8d7414", helmet: "#e3bd36", light: "#fff08a" },
  { body: "#8a44c9", dark: "#5f2f8d", helmet: "#a45ce0", light: "#d9a8ff" },
];

/** 32x32 top-down soldier facing +x. Four walk frames: stride, passing, stride (swapped), passing. */
function soldiers(scene: Phaser.Scene) {
  const footA = [18, 13, 8, 13];
  const footB = [8, 13, 18, 13];
  PALETTES.forEach((p, slot) => {
    const t = canvas(scene, `pl${slot}`, 128, 32);
    const c = t.context;
    for (let f = 0; f < 4; f++) {
      const ox = f * 32;
      t.add(f, 0, ox, 0, 32, 32);
      rect(c, ox + 8, 9, 16, 15, "rgba(0,0,0,0.28)"); // ground shadow
      rect(c, ox + footA[f]!, 8, 5, 4, "#26282b"); // boots
      rect(c, ox + footB[f]!, 20, 5, 4, "#26282b");
      rect(c, ox + 11, 10, 7, 12, p.body); // shoulders / torso
      rect(c, ox + 12, 9, 5, 14, p.body);
      rect(c, ox + 11, 10, 1, 12, p.dark);
      rect(c, ox + 12, 20, 5, 3, p.dark);
      rect(c, ox + 18, 11, 6, 3, p.body); // arms
      rect(c, ox + 18, 18, 6, 3, p.body);
      rect(c, ox + 17, 14, 4, 5, "#4a3a2a"); // rifle stock
      rect(c, ox + 20, 15, 11, 3, "#222426"); // rifle body
      rect(c, ox + 29, 15, 3, 3, "#0f1011"); // muzzle
      rect(c, ox + 22, 14, 2, 2, "#d9b38c"); // hands
      rect(c, ox + 22, 18, 2, 2, "#d9b38c");
      rect(c, ox + 10, 12, 9, 8, p.helmet); // helmet
      rect(c, ox + 11, 11, 7, 10, p.helmet);
      rect(c, ox + 12, 12, 4, 2, p.light);
      rect(c, ox + 10, 17, 9, 1, p.dark);
    }
    t.refresh();
  });
}

function small(scene: Phaser.Scene) {
  let t = canvas(scene, "bullet", 10, 4);
  rect(t.context, 0, 1, 6, 2, "#ffb020");
  rect(t.context, 4, 0, 6, 4, "#fff2a8");
  rect(t.context, 7, 1, 3, 2, "#ffffff");
  t.refresh();

  t = canvas(scene, "spark", 4, 4);
  rect(t.context, 0, 0, 4, 4, "#ffffff");
  t.refresh();

  t = canvas(scene, "flash", 20, 20);
  const c = t.context;
  rect(c, 8, 0, 4, 20, "#fff2a8");
  rect(c, 0, 8, 20, 4, "#fff2a8");
  rect(c, 5, 5, 10, 10, "#ffb020");
  rect(c, 7, 7, 6, 6, "#ffffff");
  t.refresh();

  t = canvas(scene, "splat", 24, 24);
  const r = rng(77);
  for (let i = 0; i < 28; i++)
    rect(t.context, 4 + Math.floor(r() * 16), 4 + Math.floor(r() * 16), 2 + Math.floor(r() * 3), 2 + Math.floor(r() * 3), i % 3 ? "#7a0c0c" : "#a01414");
  t.refresh();
}

export function generateTextures(scene: Phaser.Scene): void {
  ground(scene);
  dirt(scene);
  hazard(scene);
  walls(scene);
  soldiers(scene);
  small(scene);
  for (let slot = 0; slot < PALETTES.length; slot++) {
    if (!scene.anims.exists(`walk${slot}`))
      scene.anims.create({
        key: `walk${slot}`,
        frames: [0, 1, 2, 3].map((frame) => ({ key: `pl${slot}`, frame })),
        frameRate: 9,
        repeat: -1,
      });
  }
}
