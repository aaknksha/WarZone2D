import type { Rect } from "./map.ts";

export interface Vec { x: number; y: number }
export interface Bounds { width: number; height: number }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function clampToArena(p: Vec, r: number, arena: Bounds): void {
  p.x = clamp(p.x, r, arena.width - r);
  p.y = clamp(p.y, r, arena.height - r);
}

/** Push a circle out of a rect. Returns true if a correction was applied. */
export function pushOutOfRect(p: Vec, r: number, rect: Rect): boolean {
  const cx = clamp(p.x, rect.x, rect.x + rect.w);
  const cy = clamp(p.y, rect.y, rect.y + rect.h);
  const dx = p.x - cx;
  const dy = p.y - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return false;
  if (d2 > 0) {
    const d = Math.sqrt(d2);
    const push = r - d;
    p.x += (dx / d) * push;
    p.y += (dy / d) * push;
    return true;
  }
  // centre is inside the rect: exit along the shallowest axis
  const left = p.x - rect.x;
  const right = rect.x + rect.w - p.x;
  const top = p.y - rect.y;
  const bottom = rect.y + rect.h - p.y;
  const m = Math.min(left, right, top, bottom);
  if (m === left) p.x = rect.x - r;
  else if (m === right) p.x = rect.x + rect.w + r;
  else if (m === top) p.y = rect.y - r;
  else p.y = rect.y + rect.h + r;
  return true;
}

/** Move a circle by (dx,dy), sliding along walls and staying inside the arena. */
export function moveCircle(p: Vec, dx: number, dy: number, r: number, walls: Rect[], arena: Bounds): Vec {
  const out = { x: p.x + dx, y: p.y + dy };
  clampToArena(out, r, arena);
  for (let i = 0; i < 3; i++) {
    let moved = false;
    for (const w of walls) if (pushOutOfRect(out, r, w)) moved = true;
    clampToArena(out, r, arena);
    if (!moved) break;
  }
  return out;
}

/** Entry parameter t in [0,1] where the segment first touches the rect, or null. */
export function segmentRectEntry(x0: number, y0: number, x1: number, y1: number, rect: Rect): number | null {
  let tmin = 0;
  let tmax = 1;
  const axes: [number, number, number, number][] = [
    [x0, x1 - x0, rect.x, rect.x + rect.w],
    [y0, y1 - y0, rect.y, rect.y + rect.h],
  ];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return null;
    } else {
      let t1 = (lo - o) / d;
      let t2 = (hi - o) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}

/** Parameter t of closest approach if the segment passes within r of the circle, else null. */
export function segmentCircleEntry(x0: number, y0: number, x1: number, y1: number, cx: number, cy: number, r: number): number | null {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : clamp(((cx - x0) * dx + (cy - y0) * dy) / len2, 0, 1);
  const px = x0 + dx * t;
  const py = y0 + dy * t;
  const ex = cx - px;
  const ey = cy - py;
  return ex * ex + ey * ey <= r * r ? t : null;
}

export function expandRect(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by };
}
