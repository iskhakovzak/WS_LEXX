/**
 * «Once per promotion» for the medal reveal. A promotion = a history row that moves a trader UP the ladder
 * (Джун → Трейдер → Сеньор); a first assignment, a lateral move or a demotion is not one. The newest promotion is
 * revealed once: its id is remembered per user in localStorage the moment the reveal opens, so a reload, another tab
 * or a later visit never shows it again. Old promotions (before this feature shipped) are not replayed.
 */
import { medalStageOf, type MedalStage } from "./stage-medal";

export type PromotionRow = { id: number; fromStage: string | null; toStage: string; createdAt: string };

const ORDER: Readonly<Record<MedalStage, number>> = { junior: 0, trader: 1, senior: 2 };
export const REVEAL_STORAGE_KEY = "ws_lexx_medal_seen";
/** A promotion older than this is history, not news. */
export const REVEAL_MAX_AGE_DAYS = 30;

export function isPromotion(r: PromotionRow): boolean {
  const from = medalStageOf(r.fromStage);
  const to = medalStageOf(r.toStage);
  return !!from && !!to && ORDER[to] > ORDER[from];
}

/** The newest upward move (highest id), or null. */
export function latestPromotion<T extends PromotionRow>(history: readonly T[]): T | null {
  let best: T | null = null;
  for (const r of history) if (isPromotion(r) && (!best || r.id > best.id)) best = r;
  return best;
}

/** Reveal it? Not seen yet (id above the remembered one) and recent enough. */
export function shouldReveal(r: PromotionRow | null, seenId: number | null, now: number = Date.now()): boolean {
  if (!r) return false;
  if (seenId != null && r.id <= seenId) return false;
  const at = Date.parse(r.createdAt);
  return Number.isFinite(at) && now - at <= REVEAL_MAX_AGE_DAYS * 86_400_000;
}

type Seen = Record<string, number>;

function readAll(): Seen {
  try {
    const raw = globalThis.localStorage?.getItem(REVEAL_STORAGE_KEY);
    const v: unknown = raw ? JSON.parse(raw) : null;
    return v && typeof v === "object" ? (v as Seen) : {};
  } catch {
    return {};
  }
}

export function readSeen(user: string): number | null {
  const v = readAll()[user];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function markSeen(user: string, id: number): void {
  try {
    const all = readAll();
    all[user] = Math.max(id, all[user] ?? 0);
    globalThis.localStorage?.setItem(REVEAL_STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* private mode / storage full: the reveal may show again next time, nothing breaks */
  }
}
