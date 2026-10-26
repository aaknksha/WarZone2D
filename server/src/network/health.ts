import type { MatchManager } from "../matches/matchManager.ts";

export function buildHealth(mgr: MatchManager, startedAt: number, now: number = Date.now()) {
  return { status: "ok", uptimeSec: Math.round((now - startedAt) / 1000), ...mgr.stats() };
}
