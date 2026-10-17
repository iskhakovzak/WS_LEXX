// «Спроси журнал» — client-side filters and aggregation over the loaded trade book (pure, no React, no fetch).
// Money is net by default (net = pnl − |fees| via @/lib/trade-math); win rate = W/(W+L); PF null instead of ∞.

import { closeDate, computeKpis, feesOf, maxDrawdown, netPnl, num, resultOf, type TradeLike } from "@/lib/trade-math";
import type { TradeResult } from "@/lib/trade-result";
import {
  afterPhrase, describeFilter, describeSubject, filterOf, fmtClock, fmtDuration, METRIC_WORD, targetTitle, weekdayOf, weekdayPhrase,
  type AskDim, type AskFilter, type AskMetric, type AskQuery,
} from "./parse";

export interface AskTrade extends TradeLike {
  id: number;
  ticker: string;
  date: string;
  side?: string | null;
  trader?: string | null;
  setup?: string | null;
  holdTime?: string | null;
  qty?: number | string | null;
  contextSnapshot?: unknown;
}

// ── Per-trade derived fields ──────────────────────────────────────────────────

function snap(t: AskTrade): Record<string, unknown> | null {
  const s = t.contextSnapshot;
  return s && typeof s === "object" ? (s as Record<string, unknown>) : null;
}

const CLOCK_RE = /T(\d{2}):(\d{2})/;

/** ET entry time in minutes since midnight (PropReports `openedAt` is an ET wall-clock timestamp). */
export function entryMinutes(t: AskTrade): number | null {
  const opened = snap(t)?.openedAt;
  if (typeof opened !== "string") return null;
  const m = CLOCK_RE.exec(opened);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** «2h 29m», «17s», «1m», «1d 2h» → seconds. */
export function parseHoldTime(s: string | null | undefined): number | null {
  if (!s) return null;
  const rx = /(\d+(?:\.\d+)?)\s*(d|h|m|s|д|ч|м|с)/gi;
  let total = 0, any = false, m: RegExpExecArray | null;
  while ((m = rx.exec(s))) {
    any = true;
    const n = Number(m[1]);
    const u = m[2].toLowerCase();
    total += n * (u === "d" || u === "д" ? 86400 : u === "h" || u === "ч" ? 3600 : u === "m" || u === "м" ? 60 : 1);
  }
  return any ? total : null;
}

/** Hold in seconds: openedAt→closedAt when both exist, else the `holdTime` text. */
export function holdSeconds(t: AskTrade): number | null {
  const s = snap(t);
  const o = s?.openedAt, c = s?.closedAt;
  if (typeof o === "string" && typeof c === "string") {
    const d = (Date.parse(`${c}Z`) - Date.parse(`${o}Z`)) / 1000;
    if (Number.isFinite(d) && d >= 0) return d;
  }
  return parseHoldTime(t.holdTime);
}

export function qtyOf(t: AskTrade): number | null {
  const q = num(t.qty) ?? num(snap(t)?.qty);
  return q == null ? null : Math.abs(q);
}

const dayOf = (t: AskTrade) => closeDate(t) ?? t.date;

// ── Book index (chronology, «после убытка») ───────────────────────────────────

export interface TradeMeta {
  min: number | null;
  hold: number | null;
  qty: number | null;
  day: string;
  wd: number;
  /** Results of the same trader's earlier trades that day, most recent first. */
  prev: TradeResult[];
  /** Chronological rank in the whole book. */
  rank: number;
}

export type BookIndex = Map<number, TradeMeta>;

export function chronoKey(t: AskTrade): string {
  const m = entryMinutes(t);
  return `${t.date}|${m == null ? "9999" : String(m).padStart(4, "0")}|${String(t.id).padStart(9, "0")}`;
}

export function indexBook(trades: AskTrade[]): BookIndex {
  const sorted = [...trades].sort((a, b) => chronoKey(a).localeCompare(chronoKey(b)));
  const idx: BookIndex = new Map();
  const lastByTraderDay = new Map<string, TradeResult[]>();
  sorted.forEach((t, rank) => {
    const day = dayOf(t);
    const k = `${t.trader ?? ""}|${t.date}`;
    const prev = lastByTraderDay.get(k) ?? [];
    idx.set(t.id, { min: entryMinutes(t), hold: holdSeconds(t), qty: qtyOf(t), day, wd: weekdayOf(day), prev: prev.slice(0, 10), rank });
    lastByTraderDay.set(k, [resultOf(t), ...prev]);
  });
  return idx;
}

function metaOf(idx: BookIndex, t: AskTrade): TradeMeta {
  return idx.get(t.id) ?? { min: entryMinutes(t), hold: holdSeconds(t), qty: qtyOf(t), day: dayOf(t), wd: weekdayOf(dayOf(t)), prev: [], rank: t.id };
}

// ── Filters ───────────────────────────────────────────────────────────────────

export interface FilterOutcome {
  kept: AskTrade[];
  /** Trades dropped because a filter needs a field they do not have. */
  noTime: number;
  noHold: number;
  noPrice: number;
  noQty: number;
}

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").trim();

export function applyFilter(trades: AskTrade[], f: AskFilter, idx: BookIndex): FilterOutcome {
  let noTime = 0, noHold = 0, noPrice = 0, noQty = 0;
  const tickers = f.tickers.length ? new Set(f.tickers) : null;
  const setups = f.setups.length ? f.setups.map(norm) : null;
  const wds = f.weekdays ? new Set(f.weekdays) : null;
  let kept = trades.filter((t) => {
    if (f.trader && t.trader !== f.trader) return false;
    if (tickers && !tickers.has((t.ticker ?? "").toUpperCase())) return false;
    if (setups) {
      const s = norm(t.setup ?? "");
      if (!s || !setups.some((x) => s === x || s.includes(x))) return false;
    }
    if (f.side && f.side !== t.side) return false;
    if (f.outcome) {
      const r = resultOf(t);
      if ((f.outcome === "breakeven" ? "be" : f.outcome) !== r) return false;
    }
    const m = metaOf(idx, t);
    if (f.date && (m.day < f.date.from || m.day > f.date.to)) return false;
    if (wds && !wds.has(m.wd)) return false;
    if (f.time) {
      if (m.min == null) { noTime++; return false; }
      if (f.time.fromMin != null && m.min < f.time.fromMin) return false;
      if (f.time.toMin != null && m.min >= f.time.toMin) return false;
    }
    if (f.price) {
      const p = num(t.entry);
      if (p == null) { noPrice++; return false; }
      if (f.price.min != null && p < f.price.min) return false;
      if (f.price.max != null && p > f.price.max) return false;
    }
    if (f.holdSec) {
      if (m.hold == null) { noHold++; return false; }
      if (f.holdSec.min != null && m.hold <= f.holdSec.min) return false;
      if (f.holdSec.max != null && m.hold >= f.holdSec.max) return false;
    }
    if (f.qty) {
      if (m.qty == null) { noQty++; return false; }
      if (f.qty.min != null && m.qty < f.qty.min) return false;
      if (f.qty.max != null && m.qty >= f.qty.max) return false;
    }
    if (f.after) {
      const p = m.prev.slice(0, f.after.n);
      if (p.length < f.after.n || !p.every((r) => r === f.after!.kind)) return false;
    }
    return true;
  });
  if (f.lastN) {
    kept = [...kept].sort((a, b) => metaOf(idx, a).rank - metaOf(idx, b).rank).slice(-f.lastN);
  }
  return { kept, noTime, noHold, noPrice, noQty };
}

/** Filters the trades page cannot apply from its own URL params (⇒ the link carries ids). */
export function needsIds(f: AskFilter): boolean {
  return Boolean(f.time || f.price || f.holdSec || f.qty || f.after || f.lastN || f.weekdays || f.tickers.length > 1 || f.setups.length > 1);
}

// ── Aggregation ───────────────────────────────────────────────────────────────

export interface Agg {
  key: string;
  label: string;
  n: number;
  wins: number;
  losses: number;
  winRate: number | null;
  net: number | null;
  gross: number | null;
  fees: number;
  avgNet: number | null;
  /** Σ net⁺ / |Σ net⁻|; null when there are no losing $ (never ∞). */
  pf: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  avgHold: number | null;
  /** Follow-up question that narrows the query to this row. */
  ask?: string;
  /** Trades of the row (kept for drill-down). */
  ids?: number[];
}

export function aggOf(trades: AskTrade[], key = "all", label = "Все", idx?: BookIndex): Agg {
  const k = computeKpis(trades);
  let pos = 0, neg = 0, nPos = 0, nNeg = 0, holdSum = 0, holdN = 0;
  for (const t of trades) {
    const n = netPnl(t);
    if (n != null) {
      if (n > 0) { pos += n; nPos++; } else if (n < 0) { neg += n; nNeg++; }
    }
    const h = idx ? metaOf(idx, t).hold : holdSeconds(t);
    if (h != null) { holdSum += h; holdN++; }
  }
  return {
    key, label,
    n: trades.length,
    wins: k.wins, losses: k.losses,
    winRate: k.winRate,
    net: k.netPnl,
    gross: k.grossPnl,
    fees: trades.reduce((s, t) => s + feesOf(t), 0),
    avgNet: k.netPnl != null && k.pnlCount ? k.netPnl / k.pnlCount : null,
    pf: neg < 0 ? pos / Math.abs(neg) : null,
    avgWin: nPos ? pos / nPos : null,
    avgLoss: nNeg ? neg / nNeg : null,
    avgHold: holdN ? holdSum / holdN : null,
    ids: trades.map((t) => t.id),
  };
}

export function metricValue(r: Agg, metric: AskMetric): number | null {
  switch (metric) {
    case "winRate": return r.winRate;
    case "n": return r.n;
    case "fees": return r.fees;
    case "avg": return r.avgNet;
    case "pf": return r.pf;
    default: return r.net;
  }
}

export function fmtMetric(v: number | null | undefined, metric: AskMetric): string {
  if (v == null) return "—";
  switch (metric) {
    case "winRate": return fmtPct(v);
    case "n": return String(v);
    case "fees": return fmtMoney(v, false);
    case "pf": return v.toFixed(2);
    default: return fmtMoney(v);
  }
}

const WD = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MON_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const MON_PREP = ["январе", "феврале", "марте", "апреле", "мае", "июне", "июле", "августе", "сентябре", "октябре", "ноябре", "декабре"];

function mondayOf(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  const wd = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - wd);
  return d.toISOString().slice(0, 10);
}
function plusDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** dd.MM (tables). */
export const dm = (date: string) => `${date.slice(8, 10)}.${date.slice(5, 7)}`;
/** dd.MM.yyyy. */
export const dmy = (date: string) => `${dm(date)}.${date.slice(0, 4)}`;

export const SLOTS: Array<{ key: string; from: number; to: number; label: string; ask: string }> = [
  { key: "0", from: 0, to: 570, label: "Премаркет (до 9:30)", ask: "в премаркете" },
  { key: "1", from: 570, to: 600, label: "Открытие 9:30–10:00", ask: "на открытии" },
  { key: "2", from: 600, to: 660, label: "Утро 10:00–11:00", ask: "с 10:00 до 11:00" },
  { key: "3", from: 660, to: 840, label: "Обед 11:00–14:00", ask: "в обед" },
  { key: "4", from: 840, to: 900, label: "После обеда 14:00–15:00", ask: "с 14:00 до 15:00" },
  { key: "5", from: 900, to: 960, label: "Power hour 15:00–16:00", ask: "power hour" },
  { key: "6", from: 960, to: 1440, label: "Постмаркет (после 16:00)", ask: "в постмаркете" },
];
export const HOLD_BUCKETS: Array<{ key: string; max: number; label: string; ask: string }> = [
  { key: "0", max: 60, label: "< 1 мин", ask: "короче 1 минуты" },
  { key: "1", max: 300, label: "1–5 мин", ask: "от 1 до 5 минут" },
  { key: "2", max: 900, label: "5–15 мин", ask: "от 5 до 15 минут" },
  { key: "3", max: 3600, label: "15–60 мин", ask: "от 15 до 60 минут" },
  { key: "4", max: Infinity, label: "> 1 ч", ask: "дольше 1 часа" },
];
export const SIZE_BUCKETS: Array<{ key: string; max: number; label: string; ask: string }> = [
  { key: "0", max: 50, label: "< 50 акций", ask: "размер меньше 50 акций" },
  { key: "1", max: 100, label: "50–99 акций", ask: "размер от 50 до 100 акций" },
  { key: "2", max: 200, label: "100–199 акций", ask: "размер от 100 до 200 акций" },
  { key: "3", max: 500, label: "200–499 акций", ask: "размер от 200 до 500 акций" },
  { key: "4", max: Infinity, label: "500+ акций", ask: "размер больше 500 акций" },
];

/** Group key + label + follow-up phrase (sortable key: chronological dims sort by key). */
export function groupKey(t: AskTrade, dim: AskDim, idx: BookIndex): { key: string; label: string; ask: string } | null {
  const m = metaOf(idx, t);
  switch (dim) {
    case "ticker": { const k = (t.ticker ?? "—").toUpperCase(); return { key: k, label: k, ask: k }; }
    case "day": return m.day ? { key: m.day, label: `${WD[m.wd]}, ${dmy(m.day)}`, ask: m.day } : null;
    case "hour": {
      if (m.min == null) return null;
      const h = Math.floor(m.min / 60);
      return { key: String(h).padStart(2, "0"), label: `${fmtClock(h * 60)}–${fmtClock((h + 1) * 60)}`, ask: `с ${fmtClock(h * 60)} до ${fmtClock((h + 1) * 60)}` };
    }
    case "weekday": return { key: String(m.wd), label: WD[m.wd], ask: weekdayPhrase([m.wd]) };
    case "month": {
      const mo = Number(m.day.slice(5, 7));
      return { key: m.day.slice(0, 7), label: `${MON_SHORT[mo - 1]} ${m.day.slice(0, 4)}`, ask: `в ${MON_PREP[mo - 1]} ${m.day.slice(0, 4)}` };
    }
    case "week": { const mon = mondayOf(m.day); return { key: mon, label: `нед. ${dm(mon)}–${dm(plusDays(mon, 4))}`, ask: `с ${mon} по ${plusDays(mon, 4)}` }; }
    case "side": { const s = t.side === "Long" ? "Long" : t.side === "Short" ? "Short" : null; return s ? { key: s, label: s === "Long" ? "лонг" : "шорт", ask: s === "Long" ? "лонги" : "шорты" } : null; }
    case "trade": return { key: String(t.id), label: `${t.ticker} ${dm(t.date)}`, ask: t.ticker };
    case "setup": { const s = (t.setup ?? "").trim(); return s ? { key: s.toLowerCase(), label: s, ask: `сетап ${s}` } : { key: "—", label: "без сетапа", ask: "" }; }
    case "trader": return t.trader ? { key: t.trader, label: t.trader, ask: t.trader } : null;
    case "slot": {
      if (m.min == null) return null;
      const s = SLOTS.find((x) => m.min! >= x.from && m.min! < x.to) ?? SLOTS[SLOTS.length - 1];
      return { key: s.key, label: s.label, ask: s.ask };
    }
    case "holdBucket": {
      if (m.hold == null) return null;
      const b = HOLD_BUCKETS.find((x) => m.hold! < x.max)!;
      return { key: b.key, label: b.label, ask: b.ask };
    }
    case "sizeBucket": {
      if (m.qty == null) return null;
      const b = SIZE_BUCKETS.find((x) => m.qty! < x.max)!;
      return { key: b.key, label: b.label, ask: b.ask };
    }
  }
}

export function groupTrades(trades: AskTrade[], dim: AskDim, idx: BookIndex): Agg[] {
  const buckets = new Map<string, { label: string; ask: string; items: AskTrade[] }>();
  for (const t of trades) {
    const g = groupKey(t, dim, idx);
    if (!g) continue;
    const b = buckets.get(g.key) ?? { label: g.label, ask: g.ask, items: [] };
    b.items.push(t);
    buckets.set(g.key, b);
  }
  return [...buckets.entries()].map(([key, b]) => ({ ...aggOf(b.items, key, b.label, idx), ask: b.ask }));
}

const CHRONO: ReadonlySet<AskDim> = new Set(["day", "hour", "weekday", "month", "week", "slot", "holdBucket", "sizeBucket"]);

// ── Formatting ────────────────────────────────────────────────────────────────

const usd = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** «+$12.30», «−$41.20», «$0.00». */
export function fmtMoney(n: number | null | undefined, signed = true): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = usd.format(Math.abs(n));
  if (!signed) return `$${abs}`;
  return n > 0 ? `+$${abs}` : n < 0 ? `−$${abs}` : `$${abs}`;
}

export function fmtPct(x: number | null | undefined): string {
  return x == null || !Number.isFinite(x) ? "—" : `${Math.round(x * 100)}%`;
}

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export const tradesWord = (n: number) => `${n} ${plural(n, "сделка", "сделки", "сделок")}`;

// ── Canonical text (follow-up questions round-trip through the parser) ────────

function minutesText(sec: number): string {
  if (sec % 3600 === 0) return `${sec / 3600} ${plural(sec / 3600, "часа", "часов", "часов")}`;
  if (sec % 60 === 0) return `${sec / 60} минут`;
  return `${sec} секунд`;
}

/** A question text that parses back to the same filter. */
export function canonicalText(f: AskFilter, opts: { allTraders?: boolean } = {}): string {
  const p: string[] = [];
  if (f.side) p.push(f.side === "Long" ? "лонги" : "шорты");
  if (f.outcome) p.push(f.outcome === "win" ? "прибыльные" : f.outcome === "loss" ? "убыточные" : "безубыточные");
  if (f.tickers.length) p.push(f.tickers.join(" "));
  for (const s of f.setups) p.push(`сетап ${s}`);
  if (f.date) p.push(f.date.from === f.date.to ? f.date.from : f.date.from <= "2000-01-01" ? `по ${Number(f.date.to.slice(8, 10))} ${["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"][Number(f.date.to.slice(5, 7)) - 1]} ${f.date.to.slice(0, 4)}` : `с ${f.date.from} по ${f.date.to}`);
  if (f.weekdays) p.push(weekdayPhrase(f.weekdays));
  if (f.time) {
    const { fromMin: a, toMin: b } = f.time;
    if (a != null && b != null) p.push(`с ${fmtClock(a)} до ${fmtClock(b)}`);
    else if (a != null) p.push(`после ${fmtClock(a)}`);
    else if (b != null) p.push(`до ${fmtClock(b)}`);
  }
  if (f.price) {
    const { min, max } = f.price;
    if (min != null && max != null) p.push(`цена от ${min} до ${max}$`);
    else if (min != null) p.push(`дороже ${min}$`);
    else if (max != null) p.push(`дешевле ${max}$`);
  }
  if (f.holdSec) {
    const { min, max } = f.holdSec;
    if (min != null) p.push(`дольше ${minutesText(min)}`);
    if (max != null) p.push(`короче ${minutesText(max)}`);
  }
  if (f.qty) {
    const { min, max } = f.qty;
    if (min != null && max != null) p.push(`размер от ${min} до ${max} акций`);
    else if (min != null) p.push(`размер от ${min} акций`);
    else if (max != null) p.push(`размер меньше ${max} акций`);
  }
  if (f.after) p.push(afterPhrase(f.after));
  if (f.lastN) p.push(`последние ${f.lastN} сделок`);
  if (f.trader) p.push(f.trader);
  else if (opts.allTraders) p.push("весь деск");
  return p.join(" ");
}

// ── Answer ────────────────────────────────────────────────────────────────────

export interface AskStat { label: string; value: string; tone?: number | null; hint?: string }

export interface AskLinkParams {
  trader?: string;
  ticker?: string;
  setup?: string;
  date?: string;
  from?: string;
  to?: string;
  side?: "Long" | "Short";
  outcome?: "win" | "loss" | "breakeven";
  ids?: number[];
}

export type AskChart =
  | { type: "equity"; title: string; points: Array<{ i: number; v: number; label: string }> }
  | { type: "bars"; title: string; metric: AskMetric; rows: Array<{ key: string; label: string; value: number; highlight?: boolean; ask?: string }> }
  | { type: "hist"; title: string; bins: Array<{ label: string; value: number; tone: "up" | "down" | "neutral" }> };

export interface AskGroups {
  dim: AskDim | "insight";
  title: string;
  rows: Agg[];
  highlight?: string[];
  metric: AskMetric;
}

export type AskAnswerKind = "summary" | "groups" | "compare" | "top" | "streak" | "insight" | "empty";

export interface AskAnswer {
  kind: AskAnswerKind;
  subject: string;
  /** One or two short sentences: the conclusion. */
  headline: string;
  big: { label: string; value: string; tone: number | null; sub?: string };
  stats: AskStat[];
  chart: AskChart | null;
  groups: AskGroups | null;
  /** All trades the answer is about (virtualised list). */
  trades: AskTrade[];
  tradesTitle: string;
  /** Sort the list by net instead of time (best/worst trade). */
  tradesByPnl?: boolean;
  link: AskLinkParams;
  linkLabel: string;
  notes: string[];
  /** Trades matched by the filter / trades in scope. */
  matched: number;
  total: number;
  empty: boolean;
}

export interface AnswerMeta {
  truncated?: boolean;
  /** Max ids carried into the trades link when client-only filters were applied. */
  maxLinkIds?: number;
  /** Book size in scope (for «N из M»). */
  total?: number;
}

const DIM_TITLE: Record<AskDim, string> = {
  ticker: "По тикерам", day: "По дням", hour: "По часам входа (ET)", weekday: "По дням недели", month: "По месяцам",
  week: "По неделям", side: "Лонг / шорт", trade: "Сделки", setup: "По сетапам", slot: "По времени дня (ET)",
  holdBucket: "По удержанию", sizeBucket: "По размеру позиции", trader: "По трейдерам",
};

export const MAX_LINK_IDS = 400;

function baseLink(f: AskFilter, kept: AskTrade[], maxIds: number): { link: AskLinkParams; note?: string } {
  const link: AskLinkParams = {};
  if (f.trader) link.trader = f.trader;
  if (f.tickers.length === 1) link.ticker = f.tickers[0];
  if (f.setups.length === 1) link.setup = f.setups[0];
  if (f.side) link.side = f.side;
  if (f.outcome) link.outcome = f.outcome;
  if (f.date) {
    if (f.date.from === f.date.to) link.date = f.date.from;
    else { link.from = f.date.from; link.to = f.date.to; }
  }
  if (needsIds(f) && kept.length) {
    if (kept.length <= maxIds) link.ids = kept.map((t) => t.id);
    else return { link, note: `В «Сделках» откроются тикер, сторона, результат и период; время, дни недели, удержание и размер не переносятся (больше ${maxIds} сделок).` };
  }
  return { link };
}

function sortChrono(trades: AskTrade[], idx: BookIndex, desc = true): AskTrade[] {
  const s = [...trades].sort((a, b) => metaOf(idx, a).rank - metaOf(idx, b).rank);
  return desc ? s.reverse() : s;
}

function equityChart(trades: AskTrade[], idx: BookIndex, title = "Кривая нетто"): AskChart | null {
  const s = sortChrono(trades, idx, false).filter((t) => netPnl(t) != null);
  if (s.length < 2) return null;
  let cum = 0;
  const pts = s.map((t, i) => { cum += netPnl(t)!; return { i: i + 1, v: Math.round(cum * 100) / 100, label: `${t.ticker} · ${dm(t.date)}` }; });
  // Downsample to ≤ 300 points (keep the last one).
  if (pts.length > 300) {
    const step = Math.ceil(pts.length / 300);
    return { type: "equity", title, points: pts.filter((_, i) => i % step === 0 || i === pts.length - 1) };
  }
  return { type: "equity", title, points: pts };
}

function netHist(trades: AskTrade[]): AskChart | null {
  const vals = trades.map((t) => netPnl(t)).filter((v): v is number => v != null);
  if (vals.length < 3) return null;
  const lo = Math.min(...vals), hi = Math.max(...vals);
  if (lo === hi) return null;
  const bins = 12;
  const w = (hi - lo) / bins;
  const counts = new Array(bins).fill(0);
  for (const v of vals) counts[Math.min(bins - 1, Math.floor((v - lo) / w))]++;
  return {
    type: "hist",
    title: "Распределение нетто по сделкам",
    bins: counts.map((c, i) => {
      const a = lo + i * w, b = a + w;
      return { label: `${fmtMoney(a)} … ${fmtMoney(b)}`, value: c, tone: b <= 0 ? "down" : a >= 0 ? "up" : "neutral" };
    }),
  };
}

function barsFrom(rows: Agg[], metric: AskMetric, title: string, highlight: string[] = []): AskChart | null {
  const r = rows.filter((x) => metricValue(x, metric) != null).slice(0, 16);
  if (!r.length) return null;
  return { type: "bars", title, metric, rows: r.map((x) => ({ key: x.key, label: x.label, value: metricValue(x, metric)!, highlight: highlight.includes(x.key), ask: x.ask })) };
}

function bucketHist(trades: AskTrade[], dim: AskDim, idx: BookIndex, title: string): AskChart | null {
  const rows = groupTrades(trades, dim, idx).sort((a, b) => a.key.localeCompare(b.key));
  if (rows.length < 2) return null;
  return { type: "hist", title, bins: rows.map((r) => ({ label: r.label, value: r.n, tone: (r.net ?? 0) > 0 ? "up" : (r.net ?? 0) < 0 ? "down" : "neutral" })) };
}

function statsOf(a: Agg): AskStat[] {
  const s: AskStat[] = [
    { label: "Сделок", value: String(a.n) },
    { label: "Нетто", value: fmtMoney(a.net), tone: a.net, hint: "нетто = брутто − комиссии" },
    { label: "Винрейт", value: fmtPct(a.winRate), hint: `W/(W+L): ${a.wins}W / ${a.losses}L` },
    { label: "Комиссии", value: fmtMoney(a.fees, false) },
    { label: "Среднее нетто", value: fmtMoney(a.avgNet), tone: a.avgNet },
    { label: "PF ($)", value: a.pf == null ? "—" : a.pf.toFixed(2), hint: "Σ плюсов / |Σ минусов|" },
    { label: "Ср. плюс / минус", value: a.avgWin != null || a.avgLoss != null ? `${fmtMoney(a.avgWin)} / ${fmtMoney(a.avgLoss)}` : "—" },
    { label: "Ср. удержание", value: a.avgHold == null ? "—" : fmtDuration(a.avgHold) },
  ];
  return s.filter((x) => x.value !== "—" && x.value !== "— / —");
}

/** One extra sentence worth saying about a set of trades (fees eating the edge, payoff). */
function takeaway(a: Agg): string | null {
  if (a.n < 3) return null;
  if (a.gross != null && a.gross > 0 && a.fees / a.gross >= 0.5) return `Комиссии съели ${fmtPct(a.fees / a.gross)} брутто.`;
  if (a.gross != null && a.gross > 0 && (a.net ?? 0) < 0) return `В плюсе до комиссий (${fmtMoney(a.gross)}), в минусе после.`;
  if (a.avgWin != null && a.avgLoss != null && a.winRate != null) {
    const payoff = a.avgWin / Math.abs(a.avgLoss);
    if (a.winRate >= 0.5 && payoff < 0.8) return `Выигрываете чаще, но средний минус (${fmtMoney(a.avgLoss)}) больше среднего плюса (${fmtMoney(a.avgWin)}).`;
    if (a.winRate < 0.5 && payoff > 1.3) return `Винрейт ниже 50%, но средний плюс в ${payoff.toFixed(1)} раза больше минуса.`;
  }
  return null;
}

function statLine(a: Agg): string {
  return `${tradesWord(a.n)}, нетто ${fmtMoney(a.net)}, винрейт ${fmtPct(a.winRate)}`;
}

/** Smallest group size worth ranking (no «100% винрейт» from one trade). */
function minGroupN(total: number, metric: AskMetric, dim: AskDim | "insight"): number {
  if (dim === "trade") return 1;
  if (metric === "net" || metric === "n" || metric === "fees") return dim === "insight" ? Math.max(5, Math.ceil(total * 0.03)) : 1;
  return Math.max(3, Math.ceil(total * 0.02));
}

function rankRows(rows: Agg[], metric: AskMetric, best: boolean): Agg[] {
  // For fees «worst» = most fees; for everything else «best» = highest value.
  const desc = metric === "fees" ? !best : best;
  return [...rows]
    .filter((r) => metricValue(r, metric) != null)
    .sort((x, y) => (desc ? metricValue(y, metric)! - metricValue(x, metric)! : metricValue(x, metric)! - metricValue(y, metric)!) || y.n - x.n);
}

interface Ctx { q: AskQuery; f: AskFilter; idx: BookIndex; maxIds: number; total: number; notes: string[] }

function emptyAnswer(subject: string, c: Ctx, link: AskLinkParams, headline?: string): AskAnswer {
  return {
    kind: "empty", subject, headline: headline ?? `${subject}: сделок нет`, big: { label: "Сделок", value: "0", tone: null },
    stats: [], chart: null, groups: null, trades: [], tradesTitle: "Сделки", link, linkLabel: "Открыть в «Сделках»",
    notes: c.notes, matched: 0, total: c.total, empty: true,
  };
}

export function buildAnswer(q: AskQuery, f: AskFilter, trades: AskTrade[], idx: BookIndex, meta: AnswerMeta & Partial<FilterOutcome> = {}): AskAnswer {
  const subject = describeSubject({ ...q, ...f });
  const maxIds = meta.maxLinkIds ?? MAX_LINK_IDS;
  const total = meta.total ?? trades.length;
  const { link, note } = baseLink(f, trades, maxIds);
  const notes: string[] = [];
  if (note) notes.push(note);
  if (meta.noTime) notes.push(`${tradesWord(meta.noTime)} без времени входа не учтены (фильтр по времени).`);
  if (meta.noHold) notes.push(`${tradesWord(meta.noHold)} без времени удержания не учтены.`);
  if (meta.noPrice) notes.push(`${tradesWord(meta.noPrice)} без цены входа не учтены.`);
  if (meta.noQty) notes.push(`${tradesWord(meta.noQty)} без размера позиции не учтены.`);
  if (meta.truncated) notes.push("Загружены не все сделки (лимит 5000) — уточните период.");
  const c: Ctx = { q, f, idx, maxIds, total, notes };

  if (!trades.length) return emptyAnswer(subject, c, link);

  const all = aggOf(trades, "all", "Все", idx);
  const stats = statsOf(all);
  const base = { subject, stats, link, linkLabel: "Открыть в «Сделках» с этим фильтром", notes, matched: trades.length, total, empty: false };
  const listed = sortChrono(trades, idx);

  // ── best / worst ──
  if ((q.intent === "best" || q.intent === "worst") && q.target) {
    const best = q.intent === "best";
    const metric = q.metric;
    const N = Math.max(1, q.topN);
    if (q.target === "trade") {
      const withPnl = trades.filter((t) => netPnl(t) != null);
      const sorted = [...withPnl].sort((x, y) => (best ? netPnl(y)! - netPnl(x)! : netPnl(x)! - netPnl(y)!));
      const top = sorted[0];
      if (!top) return emptyAnswer(subject, c, link, `${subject}: нет сделок с P&L`);
      const n = netPnl(top)!;
      const topList = sorted.slice(0, Math.max(N, 10));
      const head = N > 1
        ? `${best ? "Лучшие" : "Худшие"} ${N} сделок: ${sorted.slice(0, 3).map((t) => `${t.ticker} ${dm(t.date)} ${fmtMoney(netPnl(t))}`).join(", ")}${N > 3 ? "…" : ""}`
        : `${top.ticker}, ${dmy(top.date)}, ${top.side === "Short" ? "шорт" : top.side === "Long" ? "лонг" : ""}: нетто ${fmtMoney(n)}.`;
      return {
        ...base, kind: "top", headline: head.replace(/\s+:/, ":"),
        big: { label: `${targetTitle(q.intent, "trade")}: ${top.ticker} · ${dm(top.date)}`, value: fmtMoney(n), tone: n },
        chart: { type: "bars", title: best ? "Топ сделок по нетто" : "Худшие сделки по нетто", metric: "net", rows: topList.map((t) => ({ key: String(t.id), label: `${t.ticker} ${dm(t.date)}`, value: netPnl(t)!, highlight: sorted.indexOf(t) < N })) },
        groups: null, trades: topList, tradesTitle: N > 1 ? `Топ-${topList.length}` : "Сделка и следующие за ней", tradesByPnl: true,
        link: { ...link, ids: sorted.slice(0, N).map((t) => t.id) }, linkLabel: N > 1 ? `Открыть ${N} сделок в «Сделках»` : "Открыть сделку в «Сделках»",
      };
    }
    const minN = minGroupN(trades.length, metric, q.target);
    const rowsAll = groupTrades(trades, q.target, idx);
    const rows = rankRows(rowsAll.filter((r) => r.n >= minN), metric, best);
    if (minN > 1 && rowsAll.some((r) => r.n < minN)) notes.push(`Группы меньше ${minN} сделок не участвуют в рейтинге ${METRIC_WORD[metric]}.`);
    const top = rows[0];
    if (!top) return emptyAnswer(subject, c, link, `${subject}: мало данных для рейтинга`);
    const topRows = rows.slice(0, N);
    const hl = topRows.map((r) => r.key);
    const topIds = new Set(topRows.flatMap((r) => r.ids ?? []));
    const v = metricValue(top, metric);
    const head = N > 1
      ? `${targetTitle(q.intent, q.target, true)}: ${topRows.slice(0, 3).map((r) => `${r.label} ${fmtMetric(metricValue(r, metric), metric)}`).join(", ")}${N > 3 ? "…" : ""}`
      : `${targetTitle(q.intent, q.target)} — ${top.label}: ${METRIC_WORD[metric].replace(/^по /, "")} ${fmtMetric(v, metric)} (${statLine(top)}).`;
    const narrowed: AskLinkParams = { ...link };
    delete narrowed.ids;
    if (N === 1 && q.target === "ticker") narrowed.ticker = top.key;
    else if (N === 1 && q.target === "day") { narrowed.date = top.key; delete narrowed.from; delete narrowed.to; }
    else if (N === 1 && q.target === "side") narrowed.side = top.key as "Long" | "Short";
    else if (N === 1 && q.target === "trader") narrowed.trader = top.key;
    if (needsIds(f) || !(N === 1 && ["ticker", "day", "side", "trader"].includes(q.target))) {
      if (topIds.size <= maxIds) narrowed.ids = [...topIds];
    }
    const showRows = CHRONO.has(q.target) && rows.length <= 12 ? [...rows].sort((a, b) => a.key.localeCompare(b.key)) : rows.slice(0, 15);
    return {
      ...base, kind: "top", headline: head,
      big: { label: N > 1 ? `${targetTitle(q.intent, q.target, true)} · №1 ${top.label}` : `${targetTitle(q.intent, q.target)}: ${top.label}`, value: fmtMetric(v, metric), tone: metric === "net" || metric === "avg" ? v : null, sub: statLine(top) },
      chart: barsFrom(showRows, metric, `${DIM_TITLE[q.target]} — ${METRIC_WORD[metric]}`, hl),
      groups: { dim: q.target, title: `${DIM_TITLE[q.target]} — ${best ? "лучшие" : "худшие"} ${METRIC_WORD[metric]}`, rows: rows.slice(0, 24), highlight: hl, metric },
      trades: listed.filter((t) => topIds.has(t.id)), tradesTitle: N > 1 ? `Сделки топ-${N}` : `Сделки: ${top.label}`,
      link: narrowed, linkLabel: N > 1 ? `Открыть сделки топ-${N}` : `Открыть «${top.label}» в «Сделках»`,
    };
  }

  // ── streaks ──
  if (q.intent === "streak") return streakAnswer(q, trades, c, base, all);

  // ── insight ──
  if (q.intent === "insight") return insightAnswer(q, trades, c, base);

  // ── list / count / sum / avg / winrate / fees / pf / hold / size / drawdown ──
  let big: AskAnswer["big"];
  let headline = `${subject}: ${statLine(all)}.`;
  let chart: AskChart | null = equityChart(trades, idx);
  switch (q.intent) {
    case "count": big = { label: "Сделок", value: String(all.n), tone: null, sub: `${all.wins}W / ${all.losses}L` }; break;
    case "winrate":
      big = { label: "Винрейт", value: fmtPct(all.winRate), tone: null, sub: `${all.wins} в плюс, ${all.losses} в минус (W/(W+L))` };
      headline = `${subject}: винрейт ${fmtPct(all.winRate)} — ${all.wins} из ${all.wins + all.losses} закрыты в плюс.`;
      chart = netHist(trades) ?? chart;
      break;
    case "fees": {
      const share = all.gross != null && all.gross > 0 ? all.fees / all.gross : null;
      big = { label: "Комиссии", value: fmtMoney(all.fees, false), tone: null, sub: share != null ? `${fmtPct(share)} от брутто ${fmtMoney(all.gross)}` : `брутто ${fmtMoney(all.gross)}` };
      headline = share != null
        ? `Комиссии съели ${fmtMoney(all.fees, false)} — ${fmtPct(share)} брутто (${fmtMoney(all.gross)}); на руках нетто ${fmtMoney(all.net)}. В среднем ${fmtMoney(all.n ? all.fees / all.n : null, false)} на сделку.`
        : `${subject}: комиссии ${fmtMoney(all.fees, false)} за ${tradesWord(all.n)} (брутто ${fmtMoney(all.gross)}, нетто ${fmtMoney(all.net)}).`;
      const span = trades.length ? new Set(trades.map((t) => metaOf(idx, t).day.slice(0, 7))).size : 0;
      const rows = groupTrades(trades, span > 1 ? "month" : "day", idx).sort((a, b) => a.key.localeCompare(b.key));
      chart = barsFrom(rows, "fees", span > 1 ? "Комиссии по месяцам" : "Комиссии по дням");
      break;
    }
    case "avg":
      big = { label: "Среднее нетто на сделку", value: fmtMoney(all.avgNet), tone: all.avgNet, sub: `ср. плюс ${fmtMoney(all.avgWin)} · ср. минус ${fmtMoney(all.avgLoss)}` };
      headline = `${subject}: в среднем ${fmtMoney(all.avgNet)} на сделку (${tradesWord(all.n)}, винрейт ${fmtPct(all.winRate)}).`;
      chart = netHist(trades) ?? chart;
      break;
    case "pf":
      big = { label: "Профит-фактор ($)", value: all.pf == null ? "—" : all.pf.toFixed(2), tone: all.pf == null ? null : all.pf - 1, sub: "Σ плюсов / |Σ минусов|" };
      headline = all.pf == null ? `${subject}: убыточных сделок нет — PF не считается.` : `${subject}: PF ${all.pf.toFixed(2)} — на каждый потерянный $1 заработано $${all.pf.toFixed(2)}.`;
      break;
    case "hold": {
      const holds = trades.map((t) => metaOf(idx, t).hold).filter((h): h is number => h != null).sort((a, b) => a - b);
      const med = holds.length ? holds[Math.floor(holds.length / 2)] : null;
      big = { label: "Среднее удержание", value: all.avgHold == null ? "—" : fmtDuration(all.avgHold), tone: null, sub: med != null ? `медиана ${fmtDuration(med)}` : undefined };
      const wins = trades.filter((t) => resultOf(t) === "win"), losses = trades.filter((t) => resultOf(t) === "loss");
      const aw = aggOf(wins, "w", "w", idx).avgHold, al = aggOf(losses, "l", "l", idx).avgHold;
      headline = `${subject}: в среднем ${all.avgHold == null ? "—" : fmtDuration(all.avgHold)} в позиции${aw != null && al != null ? `; прибыльные держите ${fmtDuration(aw)}, убыточные — ${fmtDuration(al)}` : ""}.`;
      chart = bucketHist(trades, "holdBucket", idx, "Сделки по удержанию (цвет — знак нетто)") ?? chart;
      break;
    }
    case "size": {
      const qs = trades.map((t) => metaOf(idx, t).qty).filter((x): x is number => x != null);
      const avg = qs.length ? qs.reduce((s, x) => s + x, 0) / qs.length : null;
      big = { label: "Средний размер позиции", value: avg == null ? "—" : `${Math.round(avg)} акц.`, tone: null, sub: qs.length ? `от ${Math.min(...qs)} до ${Math.max(...qs)}` : undefined };
      headline = `${subject}: средний размер ${avg == null ? "—" : Math.round(avg)} акций за ${tradesWord(all.n)}.`;
      chart = bucketHist(trades, "sizeBucket", idx, "Сделки по размеру (цвет — знак нетто)") ?? chart;
      break;
    }
    case "drawdown": {
      const s = sortChrono(trades, idx, false).map((t) => netPnl(t)).filter((v): v is number => v != null);
      const dd = maxDrawdown(s);
      big = { label: "Макс. просадка (нетто, по сделкам)", value: fmtMoney(-Math.abs(dd)), tone: dd ? -1 : null };
      headline = `${subject}: максимальная просадка от пика ${fmtMoney(-Math.abs(dd))} при итоге ${fmtMoney(all.net)}.`;
      break;
    }
    default:
      big = { label: "Нетто", value: fmtMoney(all.net), tone: all.net, sub: `${tradesWord(all.n)} · винрейт ${fmtPct(all.winRate)}` };
  }
  const tk = takeaway(all);
  if (tk && q.intent !== "fees") headline += ` ${tk}`;

  let groups: AskGroups | null = null;
  let kind: AskAnswerKind = "summary";
  if (q.groupBy) {
    const rows = groupTrades(trades, q.groupBy, idx);
    const metric: AskMetric = q.intent === "winrate" ? "winRate" : q.intent === "count" ? "n" : q.intent === "fees" ? "fees" : q.intent === "avg" ? "avg" : q.intent === "pf" ? "pf" : "net";
    if (CHRONO.has(q.groupBy)) rows.sort((x, y) => x.key.localeCompare(y.key));
    else rows.sort((x, y) => (metricValue(y, metric) ?? -Infinity) - (metricValue(x, metric) ?? -Infinity) || y.n - x.n);
    const shown = q.groupBy === "day" ? rows.slice(-31) : rows.slice(0, 40);
    groups = { dim: q.groupBy, title: DIM_TITLE[q.groupBy], rows: shown, metric };
    chart = barsFrom(shown, metric, `${DIM_TITLE[q.groupBy]} — ${METRIC_WORD[metric]}`) ?? chart;
    const ranked = rankRows(rows.filter((r) => r.n >= minGroupN(trades.length, metric, q.groupBy!)), metric, true);
    if (ranked.length >= 2) {
      const b = ranked[0], w = ranked[ranked.length - 1];
      headline = `${subject}: ${statLine(all)}. Лучше всего — ${b.label} (${fmtMetric(metricValue(b, metric), metric)}), хуже всего — ${w.label} (${fmtMetric(metricValue(w, metric), metric)}).`;
    }
    kind = "groups";
  }

  return { ...base, kind, headline, big, chart, groups, trades: listed, tradesTitle: "Сделки по запросу" };
}

// ── Comparison ────────────────────────────────────────────────────────────────

export function buildCompare(q: AskQuery, f: AskFilter, a: AskTrade[], b: AskTrade[], idx: BookIndex, meta: AnswerMeta & { notes?: string[] } = {}): AskAnswer {
  const c = q.compare!;
  const subject = describeSubject(q);
  const metric = q.metric;
  const ra = { ...aggOf(a, "a", c.a.label, idx), ask: canonicalText({ ...f, ...c.a.patch }, { allTraders: q.allTraders }) };
  const rb = { ...aggOf(b, "b", c.b.label, idx), ask: canonicalText({ ...f, ...c.b.patch }, { allTraders: q.allTraders }) };
  const union = [...new Map([...a, ...b].map((t) => [t.id, t])).values()];
  const total = meta.total ?? union.length;
  const notes = [...(meta.notes ?? [])];
  const { link, note } = baseLink(f, union, meta.maxLinkIds ?? MAX_LINK_IDS);
  if (note) notes.push(note);
  if (!union.length) {
    return {
      kind: "empty", subject, headline: `${subject}: сделок нет ни там, ни там`, big: { label: "Сделок", value: "0", tone: null }, stats: [], chart: null, groups: null,
      trades: [], tradesTitle: "Сделки", link, linkLabel: "Открыть в «Сделках»", notes, matched: 0, total, empty: true,
    };
  }
  const va = metricValue(ra, metric), vb = metricValue(rb, metric);
  const diff = va != null && vb != null ? va - vb : null;
  const higherBetter = metric !== "fees";
  const winner = diff == null || diff === 0 ? null : (diff > 0) === higherBetter ? ra : rb;
  const loser = winner === ra ? rb : ra;
  const word = METRIC_WORD[metric].replace(/^по /, "");
  const headline = winner
    ? `Лучше — ${winner.label}: ${word} ${fmtMetric(metricValue(winner, metric), metric)} против ${fmtMetric(metricValue(loser, metric), metric)} (${tradesWord(winner.n)} vs ${tradesWord(loser.n)}; винрейт ${fmtPct(winner.winRate)} vs ${fmtPct(loser.winRate)}).`
    : `${ra.label} и ${rb.label} — одинаково: ${word} ${fmtMetric(va, metric)}.`;
  const diffFmt = diff == null ? "—" : metric === "winRate" ? `${diff > 0 ? "+" : diff < 0 ? "−" : ""}${Math.abs(Math.round(diff * 100))} п.п.` : metric === "n" ? `${diff > 0 ? "+" : ""}${diff}` : metric === "pf" ? `${diff > 0 ? "+" : ""}${diff.toFixed(2)}` : fmtMoney(diff);
  const all = aggOf(union, "all", "Все", idx);
  return {
    kind: "compare", subject, headline,
    big: { label: `Разница ${word}: ${ra.label} − ${rb.label}`, value: diffFmt, tone: metric === "net" || metric === "avg" ? diff : null },
    stats: statsOf(all),
    chart: barsFrom([ra, rb], metric, `${cap(ra.label)} vs ${rb.label} — ${METRIC_WORD[metric]}`, winner ? [winner.key] : []),
    groups: { dim: "side", title: "Сравнение", rows: [ra, rb], highlight: winner ? [winner.key] : [], metric },
    trades: sortChrono(union, idx), tradesTitle: "Сделки обеих групп",
    link: union.length <= (meta.maxLinkIds ?? MAX_LINK_IDS) ? { ...link, ids: union.map((t) => t.id) } : link,
    linkLabel: "Открыть обе группы в «Сделках»", notes, matched: union.length, total, empty: false,
  };
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// ── Streaks ───────────────────────────────────────────────────────────────────

interface Run { kind: "win" | "loss"; items: AskTrade[]; days?: string[]; net: number }

function runsOf(trades: AskTrade[], idx: BookIndex, unit: "trade" | "day"): Run[] {
  const s = sortChrono(trades, idx, false);
  const runs: Run[] = [];
  if (unit === "day") {
    const byDay = new Map<string, AskTrade[]>();
    for (const t of s) { const d = metaOf(idx, t).day; byDay.set(d, [...(byDay.get(d) ?? []), t]); }
    for (const [day, items] of byDay) {
      const net = items.reduce((x, t) => x + (netPnl(t) ?? 0), 0);
      if (net === 0) { runs.push({ kind: "win", items: [], net: 0 }); runs.pop(); continue; }
      const kind = net > 0 ? "win" : "loss";
      const last = runs[runs.length - 1];
      if (last && last.kind === kind) { last.items.push(...items); last.days!.push(day); last.net += net; }
      else runs.push({ kind, items: [...items], days: [day], net });
    }
    return runs;
  }
  for (const t of s) {
    const r = resultOf(t);
    if (r !== "win" && r !== "loss") continue;
    const last = runs[runs.length - 1];
    if (last && last.kind === r) { last.items.push(t); last.net += netPnl(t) ?? 0; }
    else runs.push({ kind: r, items: [t], net: netPnl(t) ?? 0 });
  }
  return runs;
}

function streakAnswer(q: AskQuery, trades: AskTrade[], c: Ctx, base: Omit<AskAnswer, "kind" | "headline" | "big" | "chart" | "groups" | "trades" | "tradesTitle">, all: Agg): AskAnswer {
  const unit = q.streak?.unit ?? "trade";
  const runs = runsOf(trades, c.idx, unit);
  const len = (r: Run) => (unit === "day" ? r.days!.length : r.items.length);
  const longest = (k: "win" | "loss") => runs.filter((r) => r.kind === k).sort((x, y) => len(y) - len(x) || (k === "win" ? y.net - x.net : x.net - y.net))[0] ?? null;
  const lw = longest("win"), ll = longest("loss");
  const kind = q.streak?.kind ?? "win";
  const focus = kind === "loss" ? ll : lw;
  const cur = runs[runs.length - 1] ?? null;
  const u = (n: number) => (unit === "day" ? `${n} ${plural(n, "день", "дня", "дней")}` : tradesWord(n));
  if (!focus) return { ...base, kind: "empty", headline: `${describeSubject(q)}: серий нет`, big: { label: "Серия", value: "0", tone: null }, chart: null, groups: null, trades: [], tradesTitle: "Сделки", empty: true };
  const span = (r: Run) => { const s = sortChrono(r.items, c.idx, false); return s.length ? `${dm(s[0].date)}–${dm(s[s.length - 1].date)}` : ""; };
  const other = kind === "loss" ? lw : ll;
  const headline = `Самая длинная серия ${kind === "loss" ? "убытков" : "побед"} — ${u(len(focus))} подряд (${span(focus)}, ${fmtMoney(focus.net)}).`
    + (other ? ` Серия ${kind === "loss" ? "побед" : "убытков"}: ${u(len(other))}.` : "")
    + (cur ? ` Сейчас: ${u(len(cur))} ${cur.kind === "win" ? "в плюс" : "в минус"} подряд.` : "");
  // Distribution of run lengths for the focused kind.
  const lens = runs.filter((r) => r.kind === kind).map(len);
  const maxL = Math.min(10, Math.max(...lens, 1));
  const bins = Array.from({ length: maxL }, (_, i) => ({ label: i + 1 === maxL && Math.max(...lens) > maxL ? `${maxL}+` : String(i + 1), value: lens.filter((l) => (i + 1 === maxL ? l >= maxL : l === i + 1)).length, tone: (kind === "loss" ? "down" : "up") as "up" | "down" }));
  const stats: AskStat[] = [
    { label: "Макс. серия побед", value: lw ? u(len(lw)) : "—" },
    { label: "Макс. серия убытков", value: ll ? u(len(ll)) : "—" },
    { label: "Текущая серия", value: cur ? `${u(len(cur))} ${cur.kind === "win" ? "в плюс" : "в минус"}` : "—" },
    { label: "Серий всего", value: String(runs.length) },
    ...statsOf(all).slice(0, 3),
  ].filter((s) => s.value !== "—");
  return {
    ...base, kind: "streak", headline, stats,
    big: { label: `Самая длинная серия ${kind === "loss" ? "убытков" : "побед"}`, value: u(len(focus)), tone: null, sub: `${span(focus)} · ${fmtMoney(focus.net)}` },
    chart: { type: "hist", title: `Длина серий ${kind === "loss" ? "убытков" : "побед"} (${unit === "day" ? "дни" : "сделки"})`, bins },
    groups: null, trades: sortChrono(focus.items, c.idx), tradesTitle: "Сделки этой серии",
    link: focus.items.length <= c.maxIds ? { ...base.link, ids: focus.items.map((t) => t.id) } : base.link, linkLabel: "Открыть серию в «Сделках»",
  };
}

// ── Insight: «когда я теряю больше всего» ────────────────────────────────────

const INSIGHT_DIMS: Array<{ dim: AskDim; title: string }> = [
  { dim: "slot", title: "Время дня" }, { dim: "hour", title: "Час входа" }, { dim: "weekday", title: "День недели" },
  { dim: "holdBucket", title: "Удержание" }, { dim: "sizeBucket", title: "Размер" }, { dim: "ticker", title: "Тикер" },
  { dim: "side", title: "Сторона" }, { dim: "setup", title: "Сетап" },
];

function insightAnswer(q: AskQuery, trades: AskTrade[], c: Ctx, base: Omit<AskAnswer, "kind" | "headline" | "big" | "chart" | "groups" | "trades" | "tradesTitle">): AskAnswer {
  const worst = q.insight !== "best";
  const minN = minGroupN(trades.length, "net", "insight");
  const baseText = canonicalText(c.f, { allTraders: q.allTraders });
  const findings: Agg[] = [];
  for (const { dim, title } of INSIGHT_DIMS) {
    const groups = groupTrades(trades, dim, c.idx).filter((r) => dim !== "setup" || r.key !== "—");
    if (groups.length < 2) continue; // one bucket = nothing to compare against
    const rows = groups.filter((r) => r.n >= minN && r.net != null);
    const top = rankRows(rows, "net", !worst)[0];
    if (!top || top.net == null || (worst ? top.net >= 0 : top.net <= 0)) continue;
    findings.push({ ...top, key: `${dim}:${top.key}`, label: `${title}: ${top.label}`, ask: [top.ask, baseText].filter(Boolean).join(" ") });
  }
  // Context: right after a loss vs the rest.
  const afterLoss = trades.filter((t) => metaOf(c.idx, t).prev[0] === "loss");
  if (afterLoss.length >= minN) {
    const a = aggOf(afterLoss, "ctx:afterLoss", "Контекст: сразу после убытка", c.idx);
    if (a.net != null && (worst ? a.net < 0 : a.net > 0)) findings.push({ ...a, ask: ["после убытка", baseText].filter(Boolean).join(" ") });
  }
  findings.sort((x, y) => (worst ? (x.net ?? 0) - (y.net ?? 0) : (y.net ?? 0) - (x.net ?? 0)));
  const top = findings[0];
  if (!top) {
    return {
      ...base, kind: "insight", headline: worst ? "Явных зон потерь не нашлось: ни одна группа с достаточной выборкой не в минусе." : "Явных сильных зон не нашлось: ни одна группа с достаточной выборкой не в плюсе.",
      big: { label: "Находок", value: "0", tone: null }, chart: equityChart(trades, c.idx), groups: null, trades: sortChrono(trades, c.idx), tradesTitle: "Сделки по запросу",
    };
  }
  const second = findings[1];
  const headline = `${worst ? "Больше всего теряете" : "Больше всего зарабатываете"}: ${top.label.toLowerCase()} — ${fmtMoney(top.net)} за ${tradesWord(top.n)} (винрейт ${fmtPct(top.winRate)}).`
    + (second ? ` Дальше: ${second.label.toLowerCase()} (${fmtMoney(second.net)}).` : "");
  const ids = new Set(top.ids ?? []);
  c.notes.push(`Сравниваются группы от ${minN} сделок по ${INSIGHT_DIMS.length + 1} срезам; по каждому срезу берётся ${worst ? "самая убыточная" : "самая прибыльная"} группа.`);
  return {
    ...base, kind: "insight", headline,
    big: { label: top.label, value: fmtMoney(top.net), tone: top.net, sub: `${tradesWord(top.n)} · винрейт ${fmtPct(top.winRate)} · ср. ${fmtMoney(top.avgNet)}` },
    chart: barsFrom(findings, "net", worst ? "Где уходят деньги" : "Где приходят деньги", [top.key]),
    groups: { dim: "insight", title: worst ? "Зоны потерь (по нетто)" : "Сильные зоны (по нетто)", rows: findings, highlight: [top.key], metric: "net" },
    trades: sortChrono(trades.filter((t) => ids.has(t.id)), c.idx), tradesTitle: `Сделки: ${top.label}`,
    link: ids.size <= c.maxIds ? { ...base.link, ids: [...ids] } : base.link, linkLabel: "Открыть эти сделки в «Сделках»",
  };
}

export { describeFilter, filterOf };
