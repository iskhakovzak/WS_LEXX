/**
 * Prefill of the personal plan («Мой план», GET /api/game-plan/my/prefill) — the evening feeds the morning (Волна 1):
 *
 *   focus  item 1.5 — the trader's own «Фокус на завтра» for this date: the journal pick written into that day's
 *          journal_days.plan (the close-day form's last step), else the `tomorrow` summary of the last closed day before
 *          it (eod_days.summary, ≤ 7 calendar days back). The plan editor puts it into the empty focus field.
 *   rule   item 1.9 — the most expensive behaviour pattern of the last two weeks (the daily engine's window,
 *          daily.focusWindowDays trading days before `date`), offered as the suggested «своё правило» of the day's
 *          contract: one tap accepts it. Unlike the morning focus it needs no repeats on several days (the money says
 *          it), and it is the engine's pick even when a curator / the trader replaced the focus line. Mistakes the
 *          trader disputed («это не ошибка») in the window are skipped; costs under daily.focusMinCostUsd are noise.
 *
 * Read-only over the daily engine (lib/daily) and the journal / EOD tables; the rule is cached per trader and date for
 * a few minutes (the window only moves when a day closes — routes/eod drops it on close), the focus is read fresh.
 */
import { pool } from "@workspace/db";
import { addDays } from "./tradingDate";
import { logger } from "./logger";
import { focusSettings, focusWindow, isMistakeId } from "./daily/engine";
import { mistakeCosts } from "./daily/service";
import type { MistakeCost, MistakeId } from "./daily/types";

export type SuggestedRule = {
  mistake: MistakeId;
  /** Σ net cost in $ over the window (≤ 0). */
  costNet: number;
  count: number;
  days: number;
  window: { from: string; to: string };
};

export type PlanPrefill = {
  date: string;
  /** The own «Фокус на завтра» for this date (full text, ≤ 2000 chars) and where it came from. */
  focus: { text: string; source: "journal" | "eod"; from: string } | null;
  rule: SuggestedRule | null;
};

const FOCUS_MAX = 2000;
const EOD_LOOKBACK_DAYS = 7;
const TTL_MS = 5 * 60_000;

/**
 * The suggested rule out of the window's mistake costs (pure): the costliest priced mistake at or above the noise floor,
 * not disputed; ties → more occurrences, then the id (stable). Null when nothing costs enough.
 */
export function pickSuggestedRule(
  costs: readonly MistakeCost[],
  window: { from: string; to: string },
  opts: { minCost: number; disputed?: ReadonlySet<MistakeId> },
): SuggestedRule | null {
  let best: MistakeCost | null = null;
  for (const c of costs) {
    if (c.costNet == null || !(c.costNet < 0) || -c.costNet < opts.minCost) continue;
    if (!isMistakeId(c.id) || opts.disputed?.has(c.id)) continue;
    const better = !best
      || c.costNet < (best.costNet ?? 0)
      || (c.costNet === best.costNet && (c.count > best.count || (c.count === best.count && c.id < best.id)));
    if (better) best = c;
  }
  if (!best || best.costNet == null) return null;
  return { mistake: best.id, costNet: Math.round(best.costNet * 100) / 100, count: best.count, days: best.days, window };
}

/** The first non-empty text of the candidates, trimmed and capped (pure). */
export function focusTextOf(...texts: (string | null | undefined)[]): string | null {
  for (const t of texts) {
    const v = String(t ?? "").trim();
    if (v) return v.length > FOCUS_MAX ? v.slice(0, FOCUS_MAX) : v;
  }
  return null;
}

async function journalFocus(trader: string, date: string): Promise<string | null> {
  const { rows } = await pool
    .query<{ plan: string | null }>(`SELECT plan FROM journal_days WHERE trader = $1 AND day = $2::date`, [trader, date])
    .catch(() => ({ rows: [] as { plan: string | null }[] }));
  return focusTextOf(rows[0]?.plan);
}

async function eodFocus(trader: string, date: string): Promise<{ text: string; from: string } | null> {
  const { rows } = await pool
    .query<{ date: string; tomorrow: string | null }>(
      `SELECT date, summary->>'tomorrow' AS tomorrow FROM eod_days
        WHERE trader = $1 AND date < $2 AND date >= $3 AND closed_at IS NOT NULL
          AND COALESCE(summary->>'tomorrow', '') <> ''
        ORDER BY date DESC LIMIT 1`,
      [trader, date, addDays(date, -EOD_LOOKBACK_DAYS)],
    )
    .catch(() => ({ rows: [] as { date: string; tomorrow: string | null }[] }));
  const text = focusTextOf(rows[0]?.tomorrow);
  return text && rows[0] ? { text, from: rows[0].date } : null;
}

async function disputedIn(trader: string, from: string, to: string): Promise<Set<MistakeId>> {
  const { rows } = await pool
    .query<{ m: string | null }>(
      `SELECT disputed_mistake AS m FROM daily_reviews WHERE trader = $1 AND date >= $2 AND date <= $3 AND disputed`,
      [trader, from, to],
    )
    .catch(() => ({ rows: [] as { m: string | null }[] }));
  return new Set(rows.map((r) => r.m).filter((m): m is string => !!m));
}

async function suggestedRule(trader: string, date: string): Promise<SuggestedRule | null> {
  const window = focusWindow(date);
  try {
    const [costs, disputed] = await Promise.all([mistakeCosts(trader, window.from, window.to), disputedIn(trader, window.from, window.to)]);
    return pickSuggestedRule(costs, window, { minCost: focusSettings().minCost, disputed });
  } catch (err) {
    logger.warn({ err, trader, date }, "plan prefill: suggested rule failed");
    return null;
  }
}

const ruleCache = new Map<string, { at: number; value: SuggestedRule | null }>();

/** For tests. */
export function _resetPlanPrefill(): void { ruleCache.clear(); }

/** The suggested rule is the heavy part (the engine reads the window's trades): cached per trader and date. */
async function cachedRule(trader: string, date: string): Promise<SuggestedRule | null> {
  const key = `${trader}|${date}`;
  const hit = ruleCache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = await suggestedRule(trader, date);
  if (ruleCache.size > 500) ruleCache.clear();
  ruleCache.set(key, { at: Date.now(), value });
  return value;
}

/** Prefill of `trader`'s personal plan for `date` (focus from the evening, read fresh + the suggested own rule). */
export async function planPrefill(trader: string, date: string): Promise<PlanPrefill> {
  const [journal, eod, rule] = await Promise.all([journalFocus(trader, date), eodFocus(trader, date), cachedRule(trader, date)]);
  const focus = journal ? { text: journal, source: "journal" as const, from: date } : eod ? { text: eod.text, source: "eod" as const, from: eod.from } : null;
  return { date, focus, rule };
}

/** A day was closed: the next plan read suggests from the fresh window. */
export function forgetPlanPrefill(trader: string): void {
  for (const k of ruleCache.keys()) if (k.startsWith(`${trader}|`)) ruleCache.delete(k);
}
