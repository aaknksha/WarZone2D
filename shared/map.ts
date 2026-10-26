export interface Rect { x: number; y: number; w: number; h: number }

export const ARENA = { width: 1600, height: 1200 };

// Solid cover. Shared by client rendering and server collision.
export const WALLS: Rect[] = [
  { x: 760, y: 540, w: 80, h: 120 },   // centre monolith
  { x: 300, y: 250, w: 160, h: 40 },   // sandbag lines
  { x: 1140, y: 250, w: 160, h: 40 },
  { x: 300, y: 910, w: 160, h: 40 },
  { x: 1140, y: 910, w: 160, h: 40 },
  { x: 520, y: 420, w: 40, h: 160 },   // bunker walls
  { x: 1040, y: 620, w: 40, h: 160 },
  { x: 200, y: 560, w: 40, h: 80 },    // flank barriers
  { x: 1360, y: 560, w: 40, h: 80 },
  { x: 700, y: 200, w: 60, h: 60 },    // crates
  { x: 840, y: 940, w: 60, h: 60 },
];

export const SPAWNS = [
  { x: 120, y: 120 },
  { x: 1480, y: 1080 },
  { x: 1480, y: 120 },
  { x: 120, y: 1080 },
];
