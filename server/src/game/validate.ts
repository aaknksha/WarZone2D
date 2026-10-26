import type { PlayerInput } from "./simulation.ts";

const FLAGS = ["up", "down", "left", "right", "fire"] as const;

/** Strict validation of untrusted client input. Returns null for anything malformed. */
export function parseInput(raw: unknown): PlayerInput | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const out = { up: false, down: false, left: false, right: false, fire: false, angle: 0 };
  for (const k of FLAGS) {
    const v = o[k];
    if (v === undefined) continue;
    if (typeof v !== "boolean") return null;
    out[k] = v;
  }
  const a = o["angle"];
  if (typeof a !== "number" || !Number.isFinite(a) || Math.abs(a) > 1000) return null;
  out.angle = Math.atan2(Math.sin(a), Math.cos(a));
  return out;
}

/** Sanitises a display name; returns "" if unusable so the caller can pick a default. */
export function parseName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, 16);
}
