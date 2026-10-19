/**
 * Daily loop service — DB-backed entry points over the pure engine (lib/daily/engine.ts). Used by routes/daily.ts, the
 * curator queue (lib/daily/costQueue.ts, curatorFocus.ts) and the Telegram bot (lib/daily/telegram*).
 *
 *   focusFor(trader, date)    the focus FOR a day: stored on the first request (table daily_focus); a curator override
 *                             (source "curator") wins, then the trader's own journal pick (source "own"); mistakes the
 *                             trader disputed in the window are skipped
 *   isDayClosed(trader, date) evening card reviewed OR the journal day closed (eod_days.closed_at)
 *   eveningFor(trader, date)  the evening card; once the day is finished its verdict snapshot is stored in
 *                             daily_reviews.verdict (the contract's disciplineDelta feeds next-day discipline)
 *   dailyMe(trader)           phase (lib/curatorLogic tradingPhase), focus, last finished day, tier progress, intraday
 *   markReviewed / setFocusOverride / mistakeCosts / costQueue / checkIntradayContracts
 *
 * Tables: migration 0202_daily_loop.sql. Money is net; dates are New York trading days.
 */
import { pool } from "@workspace/db";
import { addDays, isWeekend, nyDate, nyMinutes } from "../tradingDate";
import { closeDateSql } from "../tradeMath";
import { tradingPhase } from "../curatorLogic";
import { syncCron } from "../propreports/scheduler";
import { loadBehaviorRows, rowToBehaviorTrade } from "../../routes/behavior";
import {
  NORM_HISTORY_DAYS, analyzeWindow, contractOf, dayTotals, focusOf, focusWindow, pathProgressOf, pickFocus, tierProgressOf, tradeMistakes, tradeToReview, verdictOf,
  type WindowAnalysis,
} from "./engine";
import { dayPath, windowDays } from "./detectors";
import { dayFinished, planContractOf, scaleVerdict } from "./discipline";
import { cardRewards, forgetRewards, rewardsFor } from "./rewards";
import { behaviorTradesOf, deskTradersOn, inputFor, loadDailyContext, type DailyContext } from "./load";
import { buildCostQueue } from "./costQueue";
import { settingsChangedAt } from "../settings/store";
import { untaggedTrades } from "../playbookToday/untagged";
import type { Lang } from "../../i18n";
import type { CostQueueItem, DailyFocus, DailyMe, EveningCard, MistakeCost, MistakeId, TierProgress } from "./types";

type FocusRow = {
  trader: string; date: string; mistake: string | null; cost_net: number | string | null; count: number; days: number;
  window_from: string; window_to: string; source: DailyFocus["source"]; set_by: string | null; updated_at: Date | string;
};
type ReviewRow = { reviewed_at: Date | null; note: string | null; disputed: boolean; disputed_mistake: string | null };

const numOrNull = (v: unknown): number | null => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

function rowToFocus(r: FocusRow): DailyFocus {
  const window = { from: r.window_from, to: r.window_to };
  if (!r.mistake) return focusOf(r.trader, r.date, window, null);
  const days = Number(r.days ?? 0);
  const f = focusOf(r.trader, r.date, window, { id: r.mistake, count: Number(r.count ?? 0), days, costNet: numOrNull(r.cost_net), examples: [] }, r.source);
  // A curator focus with no hits in the window: the line is the mistake's name, not «0 times in 0 days».
  if (!days) f.text = { key: `mistake.${r.mistake}` };
  return f;
}

async function storedFocus(trader: string, date: string): Promise<FocusRow | null> {
  const { rows } = await pool.query<FocusRow>(
    `SELECT trader, date, mistake, cost_net, count, days, window_from, window_to, source, set_by, updated_at FROM daily_focus WHERE trader = $1 AND date = $2`,
    [trader, date],
  );
  return rows[0] ?? null;
}

/** overwrite: "all" (curator / reset), "auto" (refresh an engine row, never a curator's), "none" (first write wins). */
async function saveFocus(f: DailyFocus, days: number, setBy: string | null, overwrite: "all" | "auto" | "none"): Promise<void> {
  await pool.query(
    `INSERT INTO daily_focus (trader, date, mistake, cost_net, count, days, window_from, window_to, source, set_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (trader, date) DO ${overwrite !== "none" ? `UPDATE SET mistake = EXCLUDED.mistake, cost_net = EXCLUDED.cost_net, count = EXCLUDED.count,
       days = EXCLUDED.days, window_from = EXCLUDED.window_from, window_to = EXCLUDED.window_to, source = EXCLUDED.source, set_by = EXCLUDED.set_by, updated_at = now()${overwrite === "auto" ? " WHERE daily_focus.source <> 'curator'" : ""}` : "NOTHING"}`,
    [f.trader, f.date, f.mistake, f.costNet, f.count, days, f.window.from, f.window.to, f.source, setBy],
  );
}

/** Mistakes the trader disputed («not a mistake») on days of [from, to]. */
async function disputedIn(trader: string, from: string, to: string): Promise<Set<MistakeId>> {
  const { rows } = await pool.query<{ m: string | null }>(
    `SELECT DISTINCT disputed_mistake AS m FROM daily_reviews WHERE trader = $1 AND disputed AND date >= $2 AND date <= $3`,
    [trader, from, to],
  );
  return new Set(rows.map((r) => r.m).filter((m): m is string => !!m));
}

async function reviewOf(trader: string, date: string): Promise<ReviewRow | null> {
  const { rows } = await pool.query<ReviewRow>(
    `SELECT reviewed_at, note, disputed, disputed_mistake FROM daily_reviews WHERE trader = $1 AND date = $2`,
    [trader, date],
  );
  return rows[0] ?? null;
}

/**
 * The trader closed `date`: the dashboard evening card was marked reviewed (daily_reviews.reviewed_at) OR the journal
 * «Закрыть день» form closed it (eod_days.closed_at, read-only here — routes/eod.ts owns the table). Used for
 * `evening.reviewed` and by lib/quests (the «review yesterday» quest). Never throws: a failed read is «not closed».
 */
export async function isDayClosed(trader: string, date: string): Promise<boolean> {
  const { rows } = await pool
    .query<{ closed: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM daily_reviews WHERE trader = $1 AND date = $2 AND reviewed_at IS NOT NULL)
           OR EXISTS (SELECT 1 FROM eod_days WHERE trader = $1 AND date = $2 AND closed_at IS NOT NULL) AS closed`,
      [trader, date],
    )
    .catch(() => ({ rows: [] as { closed: boolean }[] }));
  return !!rows[0]?.closed;
}

/** Computes the auto focus for `date` from an already loaded context (does not store). */
async function computeFocus(trader: string, date: string, ctx: DailyContext): Promise<{ focus: DailyFocus; days: number; analysis: WindowAnalysis }> {
  const w = focusWindow(date);
  const analysis = analyzeWindow(inputFor(ctx, w.from, w.to));
  const pick = pickFocus(analysis.costs, await disputedIn(trader, w.from, w.to));
  return { focus: focusOf(trader, date, w, pick), days: pick?.days ?? 0, analysis };
}

/** Focus for `date`, using `ctx` when it already covers the window (eveningFor shares one load). */
async function focusWith(trader: string, date: string, ctx?: DailyContext): Promise<DailyFocus> {
  const stored = await storedFocus(trader, date);
  // An engine row is final once it was computed after its window closed — unless an admin changed the daily-focus
  // settings after that and the day has not passed yet (then it is re-computed); a curator's row always wins.
  if (stored && (stored.source === "curator" || (dayFinished(stored.window_to, new Date(stored.updated_at)) && !settingsNewer(stored)))) return rowToFocus(stored);
  const w = focusWindow(date);
  const c = ctx && ctx.loadedFrom <= w.from && ctx.loadedTo >= w.to ? ctx : await loadDailyContext(trader, w.from, w.to);
  const { focus, days } = await computeFocus(trader, date, c);
  // A window that is not over yet (a focus asked for days ahead) is answered but not frozen.
  if (!dayFinished(w.to)) return focus;
  await saveFocus(focus, days, null, "auto");
  const again = await storedFocus(trader, date);
  return again ? rowToFocus(again) : focus;
}

/** The daily-focus settings changed after this engine row was computed, and its day is today or later. */
function settingsNewer(r: FocusRow): boolean {
  const changed = settingsChangedAt("daily.");
  return !!changed && r.date >= nyDate() && new Date(changed).getTime() > new Date(r.updated_at).getTime();
}

/** Costs of every mistake kind for one trader over [from, to] (NY dates, inclusive), costliest first. */
export async function mistakeCosts(trader: string, from: string, to: string): Promise<MistakeCost[]> {
  const ctx = await loadDailyContext(trader, from, to);
  return analyzeWindow(inputFor(ctx, from, to)).costs;
}

/**
 * Every trade of [from, to] with the mistakes it took part in (costliest mistake first) — all hits of the window, not
 * only each mistake's top examples (the simulator tags the trader's replayable losses with them).
 */
export async function mistakesByTrade(trader: string, from: string, to: string): Promise<Map<number, MistakeId[]>> {
  const ctx = await loadDailyContext(trader, from, to);
  return tradeMistakes(analyzeWindow(inputFor(ctx, from, to)));
}

/**
 * The trader's own pick for `date`: the journal «Фокус на завтра» (written into that day's journal_days.plan) — its
 * first meaningful line, bullets stripped, ≤ 200 chars. Null when empty or the journal table is absent.
 */
export async function ownFocusText(trader: string, date: string): Promise<string | null> {
  const { rows } = await pool
    .query<{ plan: string | null }>(`SELECT plan FROM journal_days WHERE trader = $1 AND day = $2::date`, [trader, date])
    .catch(() => ({ rows: [] as { plan: string | null }[] }));
  return ownFocusLine(rows[0]?.plan ?? null);
}

/** First meaningful line of a journal focus text, without list bullets and template headers (pure; exported for tests). */
export function ownFocusLine(plan: string | null | undefined): string | null {
  for (const raw of String(plan ?? "").split(/\r?\n/)) {
    const line = raw.replace(/^\s*(?:[•\-*–—]|\d+[.)])\s*/, "").trim();
    // Template headers («Фокус-лист:», «Ключевые уровни:») carry no pick of their own.
    if (line && !line.endsWith(":")) return line.length > 200 ? `${line.slice(0, 199)}…` : line;
  }
  return null;
}

/** The focus as shown to the trader when they picked their own: precedence curator > own journal pick > auto. */
export function withOwnFocus(f: DailyFocus, own: string | null): DailyFocus {
  if (!own || f.source === "curator") return f;
  return { ...f, mistake: null, costNet: null, count: 0, source: "own", ownText: own, text: { key: "focus.own", params: { text: own } } };
}

/** Any closed trade in [from, to]? (the «nothing repeats» line must not praise a trader who did not trade). */
async function tradedIn(trader: string, from: string, to: string): Promise<boolean> {
  const { rows } = await pool
    .query(
      `SELECT 1 FROM trades t WHERE t.deleted_at IS NULL AND t.trader = $1 AND ${closeDateSql("t")} >= $2 AND ${closeDateSql("t")} <= $3 LIMIT 1`,
      [trader, from, to],
    )
    .catch(() => ({ rows: [{}] }));
  return rows.length > 0;
}

/**
 * The focus for `date` as the trader sees it (dashboard, plan, playbook, Telegram): computed and stored on first
 * request; a curator override wins, then the trader's own journal pick (source «own»), then the engine. With no trades
 * in the window the «nothing repeats» line becomes «the focus appears after the first trades» (`focus.noTrades`).
 * The evening verdict keeps judging the engine / curator mistake (focusWith).
 */
export async function focusFor(trader: string, date: string): Promise<DailyFocus | null> {
  const [f, own] = await Promise.all([focusWith(trader, date), ownFocusText(trader, date)]);
  if (f.source === "none" && !own && !(await tradedIn(trader, f.window.from, f.window.to))) {
    return { ...f, text: { key: "focus.noTrades", params: f.text.params } };
  }
  return withOwnFocus(f, own);
}

/** Curator override (`mistake`) or back to the engine's pick (`null`). Returns the focus now in force. */
export async function setFocusOverride(trader: string, date: string, mistake: MistakeId | null, by: string): Promise<DailyFocus> {
  const w = focusWindow(date);
  const ctx = await loadDailyContext(trader, w.from, w.to);
  const { focus, days, analysis } = await computeFocus(trader, date, ctx);
  if (mistake == null) {
    await saveFocus(focus, days, null, "all");
    return focus;
  }
  const cost = analysis.costs.find((c) => c.id === mistake) ?? { id: mistake, count: 0, days: 0, costNet: null, examples: [] };
  await saveFocus(focusOf(trader, date, w, cost, "curator"), cost.days, by, "all");
  return rowToFocus({ trader, date, mistake, cost_net: cost.costNet, count: cost.count, days: cost.days, window_from: w.from, window_to: w.to, source: "curator", set_by: by, updated_at: new Date() });
}

/** The evening card for a finished trading day (focus verdict, trade to review, desk same ticker, contract). */
export async function eveningFor(trader: string, date: string): Promise<EveningCard | null> {
  const w = focusWindow(date);
  const ctx = await loadDailyContext(trader, w.from, date);
  const [focus, review, tags, closed] = await Promise.all([
    focusWith(trader, date, ctx), reviewOf(trader, date), untaggedTrades(trader, date, date).catch(() => null), isDayClosed(trader, date),
  ]);
  const a = analyzeWindow(inputFor(ctx, date, date));
  const disputed = !!review?.disputed && (!review.disputed_mistake || review.disputed_mistake === focus.mistake);
  const verdict = focus.mistake ? verdictOf(a, date, focus.mistake, disputed) : null;
  const raw = contractOf(a, date, ctx.plans?.get(date));
  // The day's actual points on the progressive scale (streak bonus / penalty) — lib/daily/discipline.ts.
  const scaled = raw
    ? await scaleVerdict(trader, raw, ctx.trades, { tradesFrom: addDays(ctx.loadedFrom, -NORM_HISTORY_DAYS), loadTrades: behaviorTradesOf(trader) }).catch(() => null)
    : null;
  const contract = scaled?.contract ?? raw;
  const review1 = tradeToReview(a, date, focus.mistake);
  const totals = dayTotals(a, date);
  const day = a.tradesByDay.get(date) ?? [];
  const ticker = review1?.ticker ?? mostTraded(day.map((t) => t.ticker));
  const others = ticker ? await deskTradersOn(ticker, date, trader).catch(() => 0) : 0;
  const card: EveningCard = {
    trader, date, trades: totals.trades, netPnl: totals.netPnl, focus: verdict, tradeToReview: review1,
    deskSameTicker: ticker && others > 0 ? { ticker, traders: others } : null,
    contract, reviewed: !!review?.reviewed_at || closed, reviewNote: review?.note ?? null, ...(tags ? { untagged: tags.untagged } : {}),
  };
  if (dayFinished(date)) {
    if (await saveVerdict(card).catch(() => false)) forgetRewards(trader);
    card.rewards = await cardRewards(trader, date, scaled?.streak ?? null).catch(() => null);
  }
  return card;
}

function mostTraded(tickers: readonly string[]): string | null {
  const n = new Map<string, number>();
  for (const t of tickers) if (t) n.set(t, (n.get(t) ?? 0) + 1);
  let best: string | null = null;
  for (const [t, c] of n) if (best == null || c > (n.get(best) ?? 0)) best = t;
  return best;
}

/** Stores the finished day's snapshot; true when it changed. */
async function saveVerdict(card: EveningCard): Promise<boolean> {
  const snapshot = JSON.stringify({ trades: card.trades, netPnl: card.netPnl, focus: card.focus, contract: card.contract, tradeToReview: card.tradeToReview });
  const res = await pool.query(
    `INSERT INTO daily_reviews (trader, date, verdict, verdict_at) VALUES ($1, $2, $3::jsonb, now())
     ON CONFLICT (trader, date) DO UPDATE SET verdict = EXCLUDED.verdict, verdict_at = now(), updated_at = now()
      WHERE daily_reviews.verdict IS DISTINCT FROM EXCLUDED.verdict`,
    [card.trader, card.date, snapshot],
  );
  return (res.rowCount ?? 0) > 0;
}

/** Full-day market holidays («Market closed…» in holiday_calendar — the rule of lib/daily/telegramJobs marketClosed)
 *  within two weeks of `today`; one read per NY day. */
let closedCache: { today: string; days: Set<string> } | null = null;
async function closedDaysAround(today: string): Promise<Set<string>> {
  if (closedCache?.today === today) return closedCache.days;
  const { rows } = await pool
    .query<{ d: string }>(
      `SELECT date::text AS d FROM holiday_calendar
        WHERE type = 'holiday' AND description ILIKE 'market closed%' AND date::text >= $1 AND date::text <= $2`,
      [addDays(today, -14), addDays(today, 14)],
    )
    .catch(() => ({ rows: [] as { d: string }[] }));
  const days = new Set(rows.map((r) => String(r.d).slice(0, 10)));
  closedCache = { today, days };
  return days;
}

/** The next / previous day the market is open (weekends and full-day holidays skipped). */
function openDay(date: string, step: 1 | -1, closed: ReadonlySet<string>): string {
  let d = date;
  for (let i = 0; i < 30; i++) {
    d = addDays(d, step);
    if (!isWeekend(d) && !closed.has(d)) return d;
  }
  return d;
}

/**
 * The ladder line («До Джуна: 6 из 13»): the academy path readiness — the one ladder scorecard (owner decision 2,
 * TRIAGE cross-area note 4). /scaling stays the risk-size tiers and is only the fallback when the path cannot be read.
 */
async function tierProgress(trader: string, today: string, lang: Lang): Promise<TierProgress | null> {
  try {
    const { readinessFor } = await import("../../routes/academy-path");
    return pathProgressOf(await readinessFor(trader, today, lang));
  } catch {
    try {
      const { evaluateTraderNow } = await import("../../routes/scaling");
      return tierProgressOf(await evaluateTraderNow(trader, today));
    } catch {
      return null;
    }
  }
}

/**
 * The days DailyMe answers for at NY `today` / `minutes`: the phase, the focus day and the evening card's day. A full-day
 * market holiday reads like a weekend: the focus is for the next open day, the card is the last open day's (not an empty
 * holiday card).
 */
export function dailyDates(today: string, minutes: number, closed: ReadonlySet<string>): { phase: DailyMe["phase"]; focusDate: string; eveningDate: string } {
  const phase: DailyMe["phase"] = closed.has(today) ? "weekend" : tradingPhase(today, minutes);
  return {
    phase,
    focusDate: phase === "weekend" ? openDay(today, 1, closed) : today,
    eveningDate: phase === "afterclose" ? today : openDay(today, -1, closed),
  };
}

/** Everything the dashboard / bot shows for a trader right now. */
export async function dailyMe(trader: string, lang: Lang = "ru"): Promise<DailyMe | null> {
  const now = new Date();
  const today = nyDate(now);
  const { phase, focusDate, eveningDate } = dailyDates(today, nyMinutes(now), await closedDaysAround(today));
  // The rewards evaluation (lib/quests, cached per trader) starts alongside the cards instead of after them; the evening
  // card's rewards line awaits the same run. When the card stores a changed snapshot it drops the cache, and the run
  // that started before is then neither reused nor cached (lib/quests/cache generations) — the answer stays the same.
  const warm = rewardsFor(trader, now).catch(() => null);
  const [focus, evening, progress] = await Promise.all([
    focusFor(trader, focusDate),
    eveningFor(trader, eveningDate),
    tierProgress(trader, today, lang),
    warm,
  ]);
  const rewards = await rewardsFor(trader, now);
  return { today, phase, focus, evening, progress, intraday: syncCron() != null, discipline: rewards?.discipline ?? null, badges: rewards?.badges ?? [] };
}

/** Marks the day reviewed (optional one-line note); `dispute` = «the focus hit was not a mistake». */
export async function markReviewed(trader: string, date: string, opts: { note?: string | null; dispute?: boolean } = {}): Promise<void> {
  let disputedMistake: string | null = null;
  if (opts.dispute) disputedMistake = (await storedFocus(trader, date))?.mistake ?? (await focusWith(trader, date))?.mistake ?? null;
  const hasNote = opts.note !== undefined;
  const note = typeof opts.note === "string" ? opts.note.trim().slice(0, 500) || null : null;
  await pool.query(
    `INSERT INTO daily_reviews (trader, date, reviewed_at, note, disputed, disputed_mistake)
     VALUES ($1, $2, now(), $3, $4, $5)
     ON CONFLICT (trader, date) DO UPDATE SET
       reviewed_at = COALESCE(daily_reviews.reviewed_at, now()),
       note = CASE WHEN $6 THEN EXCLUDED.note ELSE daily_reviews.note END,
       disputed = daily_reviews.disputed OR EXCLUDED.disputed,
       disputed_mistake = COALESCE(EXCLUDED.disputed_mistake, daily_reviews.disputed_mistake),
       updated_at = now()`,
    [trader, date, note, disputedMistake != null, disputedMistake, hasNote],
  );
  forgetRewards(trader); // the review run may have reached its badge
}

/** Desk-wide cost ranking for the curator queue (traders the viewer may see). Owned by lib/daily/costQueue.ts. */
export async function costQueue(traders: readonly string[], date: string): Promise<CostQueueItem[]> {
  return buildCostQueue(traders, date, { eveningFor });
}

/**
 * Intraday own-contract check for DAILY Telegram alerts (after each scheduled PropReports sync): traders whose plan for
 * `date` sets a daily stop / max trades and who reached it — max_loss: worst cumulative realised net ≤ −limit
 * (actual = that net, ≤ 0); max_trades: trades of the day (open ones included) ≥ limit.
 */
export async function checkIntradayContracts(date: string): Promise<{ trader: string; kind: "max_loss" | "max_trades"; limit: number; actual: number }[]> {
  const { rows: plans } = await pool
    .query<{ trader: string; doc: unknown }>(
      `SELECT trader, doc FROM trader_plans WHERE date = $1 AND deleted_at IS NULL AND (doc ? 'maxLossUsd' OR doc ? 'maxTrades')`,
      [date],
    )
    .catch(() => ({ rows: [] as { trader: string; doc: unknown }[] }));
  const contracts = new Map(plans.map((p) => [String(p.trader), planContractOf(p.doc)]));
  const traders = [...contracts].filter(([, c]) => (c.maxLossUsd ?? 0) > 0 || c.maxTrades != null).map(([t]) => t);
  if (!traders.length) return [];
  const rows = await loadBehaviorRows(null, date, date, undefined, traders);
  const byTrader = new Map<string, ReturnType<typeof rowToBehaviorTrade>[]>();
  for (const r of rows) {
    const k = String(r.trader);
    (byTrader.get(k) ?? byTrader.set(k, []).get(k)!).push(rowToBehaviorTrade(r));
  }
  const out: { trader: string; kind: "max_loss" | "max_trades"; limit: number; actual: number }[] = [];
  for (const trader of traders) {
    const c = contracts.get(trader)!;
    const all = byTrader.get(trader) ?? [];
    if (c.maxLossUsd != null && c.maxLossUsd > 0) {
      const trough = dayPath(windowDays(all, date, date).get(date) ?? []).trough;
      if (trough <= -c.maxLossUsd) out.push({ trader, kind: "max_loss", limit: c.maxLossUsd, actual: trough });
    }
    if (c.maxTrades != null && c.maxTrades >= 0 && all.length >= c.maxTrades && all.length > 0) {
      out.push({ trader, kind: "max_trades", limit: c.maxTrades, actual: all.length });
    }
  }
  return out;
}
