// Single source of truth for BRD rules. Used by server (authoritative) and client (prediction/HUD).
export interface GameConfig {
  minPlayers: number;
  maxPlayers: number;
  startHealth: number;
  hitDamage: number;
  matchDurationMs: number;
  tickRate: number;
  playerRadius: number;
  playerSpeed: number; // px / second
  projectileSpeed: number; // px / second
  projectileRadius: number;
  projectileLifetimeMs: number;
  fireCooldownMs: number; // configurable per BRD
  roomCodeLength: number;
  finishedRoomTtlMs: number;
  /** Respawn after elimination (replaces the BRD early-finish rule). false = exact BRD behaviour. */
  respawnEnabled: boolean;
  respawnMinMs: number;
  respawnMaxMs: number;
  spawnProtectionMs: number;
  /** Frozen "3-2-1" period before the match clock starts. */
  countdownMs: number;
}

export const DEFAULT_CONFIG: GameConfig = {
  minPlayers: 2,
  maxPlayers: 4,
  startHealth: 100,
  hitDamage: 20,
  matchDurationMs: 180_000,
  tickRate: 30,
  playerRadius: 14,
  playerSpeed: 180,
  projectileSpeed: 520,
  projectileRadius: 4,
  projectileLifetimeMs: 1200,
  fireCooldownMs: 350,
  roomCodeLength: 5,
  finishedRoomTtlMs: 60_000,
  respawnEnabled: true,
  respawnMinMs: 3000,
  respawnMaxMs: 5000,
  spawnProtectionMs: 2000,
  countdownMs: 3000,
};

export function makeConfig(overrides: Partial<GameConfig> = {}): GameConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}
