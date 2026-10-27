/**
 * What an AI review reads — gathered by the server BEFORE the model call, through the app's own API as the caller
 * (internalApi: the same routes, scope rules and $ redaction the screens use), so a review never sees more than the
 * person could open. Plus the cached bars of the trade's day (candle archive only: never a provider call) and the
 * day's state machine computed here, deterministically (shown as facts next to the review, never left to the model).
 *
 * Trade: the trade, its fills (ET times, role), the chart around the fills (1-min bars, 5-min past 120 bars), the
 *        trader's edge map (verdicts with 80% intervals), behaviour patterns (60 days), rules and this trade's
 *        violations, the playbook setup when tagged, market context (cached brief + catalysts), the trader's history in
 *        this ticker and this setup.
 * Day:   the day report (summary, equity: peak / giveback, timeline, leaks), the state machine (after-loss / after-win
 *        entries, trades after the peak, trade number in the day), the edge map, rules and the day's violations,
 *        behaviour patterns and the market brief.
 * Week / month (nightly batch only): the period's totals with every trading day, the same totals of the period
 *        before, the stored AI day reviews of the period (grade, headline, the next-day focus), behaviour patterns,
 *        the edge map, rules and the period's violations.
 */
import { readArchivedDays } from "../../candleArchive/service";
import type { Bar } from "../../candleArchive/codec";
import { apiGet, type ApiResult } from "../internalApi";
import { zipBucket } from "../toolData";
import { compactSetup, compactTrade, marketContext, shapeBehavior, shapeStats, shiftDays, type ToolContext } from "../tools";
import { dayReviewsBetween, type PeriodKind } from "./store";

export class ReviewInputError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

const ET = new Intl.DateTimeFormat("en-GB", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const etTime = (d: Date) => ET.format(d);
const etMinute = (d: Date) => etTime(d).slice(0, 5);

const okOr = <T>(r: ApiResult, shape: (d: any) => T): T | { unavailable: string } => (r.ok ? shape(r.data) : { unavailable: r.code });

// ─── chart ──────────────────────────────────────────────────────────────────

type BarRow = [string, number, number, number, number, number];

function aggregate(bars: Bar[], sec: number): Bar[] {
  const out: Bar[] = [];
  for (const b of bars) {
    const t = Math.floor(b.t / sec) * sec;
    const last = out[out.length - 1];
    if (last && last.t === t) { last.h = Math.max(last.h, b.h); last.l = Math.min(last.l, b.l); last.c = b.c; last.v += b.v; }
    else out.push({ ...b, t });
  }
  return out;
}

/** Bars around the fills (20 min before the first, 20 after the last) from the archive; null when the day is not archived. */
export async function chartAround(ticker: string, day: string, fills: Date[]): Promise<unknown> {
  if (!fills.length) return null;
  const got = await readArchivedDays(ticker, [day]).catch(() => new Map());
  const a = got.get(day);
  if (!a?.bars?.length) return null;
  const from = Math.min(...fills.map((d) => d.getTime() / 1000)) - 20 * 60;
  const to = Math.max(...fills.map((d) => d.getTime() / 1000)) + 20 * 60;
  let bars = (a.bars as Bar[]).filter((b) => b.t >= from && b.t <= to);
  let tf = a.tf as string;
  if (bars.length > 120) { bars = aggregate(bars, 300); tf = "5m"; }
  if (bars.length > 120) bars = bars.slice(0, 120);
  const day0 = (a.bars as Bar[]);
  let pv = 0, vol = 0;
  for (const b of day0) { if (b.t > from) break; pv += ((b.h + b.l + b.c) / 3) * b.v; vol += b.v; }
  const rows: BarRow[] = bars.map((b) => [etMinute(new Date(b.t * 1000)), b.o, b.h, b.l, b.c, b.v]);
  return {
    tf, columns: ["timeET", "open", "high", "low", "close", "volume"], bars: rows, prevClose: a.prevClose ?? null,
    dayHigh: Math.max(...day0.map((b) => b.h)), dayLow: Math.min(...day0.map((b) => b.l)),
    vwapBeforeWindow: vol > 0 ? Math.round((pv / vol) * 10_000) / 10_000 : null,
  };
}

// ─── trade ──────────────────────────────────────────────────────────────────

export type TradeInput = { trader: string; tradeId: number; day: string; data: Record<string, unknown> };

type Exec = { id: number; kind: string; price: string; qty: string | null; executedAt: string | null; role?: string | null; roleLabel?: string | null; note?: string | null };

export async function gatherTrade(ctx: ToolContext, tradeId: number): Promise<TradeInput> {
  const t = await apiGet(ctx.api, `/trades/${tradeId}`);
  if (!t.ok) throw new ReviewInputError(t.status === 403 ? 403 : 404, t.status === 403 ? "OWN_TRADES_ONLY" : "TRADE_NOT_FOUND");
  const trade = t.data as Record<string, unknown>;
  if (trade.pnl === null && trade.netPnl === null && trade.trader !== ctx.actor.name && !ctx.actor.staff) throw new ReviewInputError(403, "OWN_TRADES_ONLY");
  const trader = String(trade.trader ?? ctx.actor.name);
  const day = String(trade.date ?? ctx.today).slice(0, 10);
  const ticker = String(trade.ticker ?? "");
  const setup = typeof trade.setup === "string" && trade.setup.trim() ? trade.setup : null;

  const [ex, edge, behavior, rules, viol, playbook, tickerHist, setupHist, market] = await Promise.all([
    apiGet(ctx.api, `/trades/${tradeId}/executions`),
    apiGet(ctx.api, "/edge/map", { trader }),
    apiGet(ctx.api, "/behavior", { trader, from: shiftDays(day, -60), to: day }),
    apiGet(ctx.api, "/rules", { trader }),
    apiGet(ctx.api, "/rule-violations", { trader, tradeId }),
    trade.playbookId ? apiGet(ctx.api, "/playbook") : Promise.resolve(null),
    ticker ? apiGet(ctx.api, "/stats/aggregate", { scope: "trader", trader, ticker, to: day }) : Promise.resolve(null),
    setup ? apiGet(ctx.api, "/stats/aggregate", { scope: "trader", trader, setup, to: day }) : Promise.resolve(null),
    marketContext(ctx, ticker || undefined, day).catch(() => null),
  ]);

  const execs = (ex.ok ? ((ex.data as { executions?: Exec[] }).executions ?? []) : []);
  const fills = execs.map((e, i) => ({
    n: i + 1, kind: e.kind, role: e.roleLabel ?? e.role ?? null, price: Number(e.price), qty: e.qty != null ? Number(e.qty) : null,
    timeET: e.executedAt ? etTime(new Date(e.executedAt)) : null, note: e.note ?? null,
  }));
  const fillTimes = execs.map((e) => (e.executedAt ? new Date(e.executedAt) : null)).filter((d): d is Date => !!d && !Number.isNaN(d.getTime()));
  const structure = ex.ok ? (ex.data as { structure?: { stats?: { summary?: unknown } } | null }).structure?.stats?.summary ?? null : null;
  const chart = ticker ? await chartAround(ticker, day, fillTimes) : null;
  const pb = playbook?.ok && Array.isArray(playbook.data) ? (playbook.data as Record<string, unknown>[]).find((x) => Number(x.id) === Number(trade.playbookId)) : null;

  return {
    trader, tradeId, day,
    data: {
      trade: compactTrade(trade, true),
      fills, structure,
      chart: chart ?? { unavailable: "no cached bars for this day" },
      edgeMap: okOr(edge, (d) => d),
      behavior: okOr(behavior, shapeBehavior),
      rules: okOr(rules, (d) => (Array.isArray(d) ? d.slice(0, 20).map((r: any) => ({ id: r.id, kind: r.kind, name: r.name ?? r.title, threshold: r.threshold ?? r.params ?? null, enabled: r.enabled })) : d)),
      violations: okOr(viol, (d) => (Array.isArray(d) ? d.slice(0, 10).map((v: any) => ({ rule: v.ruleName ?? v.rule ?? v.kind, detail: v.detail ?? v.message ?? null, at: v.occurredAt ?? null })) : d)),
      playbookSetup: pb ? compactSetup(pb, true) : null,
      history: {
        ticker: tickerHist ? okOr(tickerHist, (d) => (shapeStats(d) as { total?: unknown }).total) : null,
        setup: setupHist ? okOr(setupHist, (d) => (shapeStats(d) as { total?: unknown }).total) : null,
      },
      market,
    },
  };
}

// ─── day ────────────────────────────────────────────────────────────────────

type TimelineRow = { id: number; index: number; ticker?: string; net?: number | null; result?: string; gapMin?: number | null; overlap?: boolean; afterLoss?: boolean; cumAfter?: number | null; time?: string | null; entryTime?: string | null };

export type DayFacts = {
  trades: number; net: number | null;
  afterLoss: { n: number; net: number }; afterWin: { n: number; net: number };
  afterPeak: { n: number; net: number; giveback: number; peak: number | null; peakTime: string | null };
  firstThree: { n: number; net: number }; rest: { n: number; net: number };
  overlaps: number; quickReentries: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** The day's state machine from the day report (deterministic; shown in the UI as facts). Exported for tests. */
export function dayFacts(report: { summary?: { net?: number | null }; equity?: { peak?: { value?: number; time?: string | null; tradeId?: number | null }; giveback?: number; points?: { tradeId: number | null }[] }; timeline?: TimelineRow[] }): DayFacts {
  const tl = report.timeline ?? [];
  const sum = (rows: TimelineRow[]) => ({ n: rows.length, net: r2(rows.reduce((s, r) => s + (Number(r.net) || 0), 0)) });
  const afterWin = tl.filter((r, i) => i > 0 && !r.afterLoss && (Number(tl[i - 1]!.net) || 0) > 0);
  const peakId = report.equity?.peak?.tradeId ?? null;
  const pts = report.equity?.points ?? [];
  const peakIdx = peakId == null ? -1 : pts.findIndex((p) => p.tradeId === peakId);
  const afterIds = new Set(peakIdx >= 0 ? pts.slice(peakIdx + 1).map((p) => p.tradeId).filter((x): x is number => x != null) : []);
  const afterPeak = tl.filter((r) => afterIds.has(r.id));
  return {
    trades: tl.length,
    net: report.summary?.net ?? null,
    afterLoss: sum(tl.filter((r) => r.afterLoss)),
    afterWin: sum(afterWin),
    afterPeak: { ...sum(afterPeak), giveback: r2(report.equity?.giveback ?? 0), peak: report.equity?.peak?.value ?? null, peakTime: report.equity?.peak?.time ?? null },
    firstThree: sum(tl.slice(0, 3)),
    rest: sum(tl.slice(3)),
    overlaps: tl.filter((r) => r.overlap).length,
    quickReentries: tl.filter((r) => r.gapMin != null && r.gapMin < 2).length,
  };
}

export type DayInput = { trader: string; day: string; facts: DayFacts; data: Record<string, unknown> };

/** What gathering reads with: the API caller, the language and today (no request — the nightly batch has none). */
export type ReadContext = Pick<ToolContext, "api" | "lang" | "today">;

export async function gatherDay(ctx: ReadContext, trader: string, day: string): Promise<DayInput> {
  const rep = await apiGet(ctx.api, "/day-report", { trader, date: day });
  if (!rep.ok) throw new ReviewInputError(rep.status === 403 ? 403 : 400, rep.status === 403 ? "PERSONAL_DATA_FORBIDDEN" : "BAD_REQUEST");
  const report = rep.data as Record<string, any>;
  if (!Array.isArray(report.timeline) || !report.timeline.length) throw new ReviewInputError(404, "NOT_FOUND");
  const facts = dayFacts(report);
  const [edge, behavior, rules, viol, market] = await Promise.all([
    apiGet(ctx.api, "/edge/map", { trader }),
    apiGet(ctx.api, "/behavior", { trader, from: shiftDays(day, -60), to: day }),
    apiGet(ctx.api, "/rules", { trader }),
    apiGet(ctx.api, "/rule-violations", { trader, from: day, to: day }),
    marketContext(ctx, undefined, day).catch(() => null),
  ]);
  return {
    trader, day, facts,
    data: {
      dayState: facts,
      summary: report.summary, comparison: report.comparison,
      equity: report.equity ? { peak: report.equity.peak, trough: report.equity.trough, maxDrawdown: report.equity.maxDrawdown, final: report.equity.final, giveback: report.equity.giveback } : null,
      timeline: (report.timeline as TimelineRow[]).slice(0, 60),
      leaks: report.leaks, plan: report.plan, dailyLossLimit: report.dailyLossLimit ?? null,
      edgeMap: okOr(edge, (d) => d),
      behavior: okOr(behavior, shapeBehavior),
      rules: okOr(rules, (d) => (Array.isArray(d) ? d.slice(0, 20).map((r: any) => ({ id: r.id, kind: r.kind, name: r.name ?? r.title, threshold: r.threshold ?? r.params ?? null, enabled: r.enabled })) : d)),
      violations: okOr(viol, (d) => (Array.isArray(d) ? d.slice(0, 20).map((v: any) => ({ rule: v.ruleName ?? v.rule ?? v.kind, tradeId: v.tradeId ?? null, detail: v.detail ?? v.message ?? null })) : d)),
      market,
    },
  };
}

// ─── week / month ───────────────────────────────────────────────────────────

export type PeriodInput = { trader: string; kind: PeriodKind; from: string; to: string; data: Record<string, unknown> };

/** The period's first and last day (NY dates): week = Monday..Friday from `start`, month = the calendar month of `start`. */
export function periodBounds(kind: PeriodKind, start: string): { from: string; to: string } {
  if (kind === "week") return { from: start, to: shiftDays(start, 4) };
  const [y, m] = start.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: start, to: `${start.slice(0, 7)}-${String(last).padStart(2, "0")}` };
}

/** The period before (same kind): the previous week / month. */
function previousBounds(kind: PeriodKind, from: string): { from: string; to: string } {
  if (kind === "week") return periodBounds("week", shiftDays(from, -7));
  const [y, m] = from.split("-").map(Number) as [number, number];
  return periodBounds("month", new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10));
}

const MAX_PERIOD_DAYS = 25;

export async function gatherPeriod(ctx: ReadContext, trader: string, kind: PeriodKind, start: string): Promise<PeriodInput> {
  const { from, to } = periodBounds(kind, start);
  const prev = previousBounds(kind, from);
  const [stats, previous, behavior, edge, rules, viol, reviews] = await Promise.all([
    apiGet(ctx.api, "/stats/aggregate", { scope: "trader", trader, from, to }),
    apiGet(ctx.api, "/stats/aggregate", { scope: "trader", trader, from: prev.from, to: prev.to }),
    apiGet(ctx.api, "/behavior", { trader, from, to }),
    apiGet(ctx.api, "/edge/map", { trader }),
    apiGet(ctx.api, "/rules", { trader }),
    apiGet(ctx.api, "/rule-violations", { trader, from, to }),
    dayReviewsBetween(trader, from, to, ctx.lang).catch(() => []),
  ]);
  if (!stats.ok) throw new ReviewInputError(stats.status === 403 ? 403 : 400, stats.status === 403 ? "PERSONAL_DATA_FORBIDDEN" : "BAD_REQUEST");
  const raw = (stats.data ?? {}) as { days?: unknown[] };
  const days = Array.isArray(raw.days) ? raw.days : [];
  if (!days.length) throw new ReviewInputError(404, "NOT_FOUND");
  const shaped = shapeStats(raw) as Record<string, unknown>;
  const fields = (raw as { fields?: string[] }).fields;
  const everyDay = days.slice(-MAX_PERIOD_DAYS).map((r: any) => ({ key: r?.key, ...(zipBucket(fields, r?.b) as object) }));
  return {
    trader, kind, from, to,
    data: {
      period: { kind, from, to, tradingDays: days.length },
      stats: { ...shaped, lastDays: undefined, days: everyDay },
      previous: okOr(previous, (d) => ({ from: prev.from, to: prev.to, total: (shapeStats(d) as { total?: unknown }).total, tradingDays: Array.isArray(d?.days) ? d.days.length : 0 })),
      dayReviews: reviews,
      behavior: okOr(behavior, shapeBehavior),
      edgeMap: okOr(edge, (d) => d),
      rules: okOr(rules, (d) => (Array.isArray(d) ? d.slice(0, 20).map((r: any) => ({ id: r.id, kind: r.kind, name: r.name ?? r.title, threshold: r.threshold ?? r.params ?? null, enabled: r.enabled })) : d)),
      violations: okOr(viol, (d) => (Array.isArray(d) ? d.slice(0, 30).map((v: any) => ({ rule: v.ruleName ?? v.rule ?? v.kind, day: v.date ?? v.day ?? null, detail: v.detail ?? v.message ?? null })) : d)),
    },
  };
}
