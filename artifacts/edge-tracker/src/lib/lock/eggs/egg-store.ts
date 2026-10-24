/**
 * Lock-screen easter eggs: records and preferences, kept on this browser per person (localStorage, never the API — the
 * server answers 423 to data requests while the screen is locked). Every read and write survives blocked storage.
 *
 * Key: `ws_lexx_lock_eggs:<name>` (the signed-in person's name; «anon» without one).
 */
import { DIFFICULTIES, type Difficulty } from "./pong";
import { BREATH_PATTERNS, type BreathPattern } from "./breath";

export const EGGS_KEY_PREFIX = "ws_lexx_lock_eggs:";

export type EggStats = {
  pong: { bestRally: number; winStreak: number; bestStreak: number; wins: number; losses: number };
  candle: { best: number };
  breath: { sessions: number };
  prefs: { sound: boolean; difficulty: Difficulty; breath: BreathPattern };
};

export const DEFAULT_STATS: EggStats = {
  pong: { bestRally: 0, winStreak: 0, bestStreak: 0, wins: 0, losses: 0 },
  candle: { best: 0 },
  breath: { sessions: 0 },
  prefs: { sound: false, difficulty: "normal", breath: "box" },
};

type KV = Pick<Storage, "getItem" | "setItem">;

const storageOrNull = (): KV | null => {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
};

export function eggsKey(name: string | null | undefined): string {
  return `${EGGS_KEY_PREFIX}${name?.trim() || "anon"}`;
}

const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(Math.min(v, 1e6)) : 0);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** Defensive parse: anything missing or malformed falls back to the default. */
export function parseEggStats(raw: string | null): EggStats {
  let j: Record<string, unknown> = {};
  try { j = obj(raw ? JSON.parse(raw) : null); } catch { /* corrupt → defaults */ }
  const p = obj(j.pong);
  const c = obj(j.candle);
  const b = obj(j.breath);
  const pr = obj(j.prefs);
  return {
    pong: { bestRally: count(p.bestRally), winStreak: count(p.winStreak), bestStreak: count(p.bestStreak), wins: count(p.wins), losses: count(p.losses) },
    candle: { best: count(c.best) },
    breath: { sessions: count(b.sessions) },
    prefs: {
      sound: pr.sound === true,
      difficulty: DIFFICULTIES.includes(pr.difficulty as Difficulty) ? (pr.difficulty as Difficulty) : DEFAULT_STATS.prefs.difficulty,
      breath: BREATH_PATTERNS.includes(pr.breath as BreathPattern) ? (pr.breath as BreathPattern) : DEFAULT_STATS.prefs.breath,
    },
  };
}

export function loadEggStats(name: string | null | undefined, storage: KV | null = storageOrNull()): EggStats {
  try { return parseEggStats(storage?.getItem(eggsKey(name)) ?? null); } catch { return parseEggStats(null); }
}

export function saveEggStats(name: string | null | undefined, stats: EggStats, storage: KV | null = storageOrNull()): void {
  try { storage?.setItem(eggsKey(name), JSON.stringify(stats)); } catch { /* storage full / blocked: records are a nicety */ }
}

/** A finished Pong match: the win streak grows or resets, the best rally only grows. */
export function recordPongMatch(s: EggStats, won: boolean, bestRally: number): EggStats {
  const winStreak = won ? s.pong.winStreak + 1 : 0;
  return {
    ...s,
    pong: {
      bestRally: Math.max(s.pong.bestRally, count(bestRally)),
      winStreak,
      bestStreak: Math.max(s.pong.bestStreak, winStreak),
      wins: s.pong.wins + (won ? 1 : 0),
      losses: s.pong.losses + (won ? 0 : 1),
    },
  };
}

/** A rally longer than the record counts even if the match is abandoned. */
export function recordRally(s: EggStats, rally: number): EggStats {
  return rally > s.pong.bestRally ? { ...s, pong: { ...s.pong, bestRally: count(rally) } } : s;
}

export function recordCandleStreak(s: EggStats, streak: number): EggStats {
  return streak > s.candle.best ? { ...s, candle: { best: count(streak) } } : s;
}
