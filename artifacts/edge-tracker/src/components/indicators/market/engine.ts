/**
 * Market regime engine for /indicators («Рынок и мой эдж»). Pure functions, no React — covered by engine.test.ts.
 *
 * Input: daily bars of a few index symbols (SPY, VIX, …) + the trader's trades.
 * Output: an aligned daily frame, current indicator readings (value, Δ day/week, 1-year percentile),
 * the regime today (trend / volatility / risk appetite, with the drivers behind it), the trader's results
 * bucketed by market conditions, and the most similar past sessions.
 *
 * Timing convention (no look-ahead for "known before the open" conditions):
 *   - "pre" dimensions classify session D by the state at the close of D−1 (plus D's opening gap);
 *   - "day" dimensions classify D by how D itself traded (known only after the fact).
 */
import { netPnl, resultOf, type TradeLike } from "@/lib/trade-math";
import { fmtNum, fmtPct } from "@/lib/format";

export type Bar = { d: string; o: number; h: number; l: number; c: number };
export type SymbolKey = "spy" | "qqq" | "iwm" | "rsp" | "vix" | "vix3m" | "tnx" | "dxy";

/** Yahoo symbols (fetched through /api/stockdata/chart, server-cached). */
export const SYMBOLS: Record<SymbolKey, string> = {
  spy: "SPY",
  qqq: "QQQ",
  iwm: "IWM",
  rsp: "RSP",
  vix: "^VIX",
  vix3m: "^VIX3M",
  tnx: "^TNX",
  dxy: "DX-Y.NYB",
};
export const SYMBOL_KEYS = Object.keys(SYMBOLS) as SymbolKey[];

export type MarketData = Partial<Record<SymbolKey, Bar[]>>;

/** One session of the frame (dates follow SPY). All derived values are as of this session's close. */
export type Row = {
  d: string;
  spy: Bar;
  vix: number | null;
  vix3m: number | null;
  iwm: number | null;
  rsp: number | null;
  qqq: number | null;
  tnx: number | null;
  dxy: number | null;
  spyChg: number | null;
  spyGap: number | null;
  dist20: number | null;
  dist50: number | null;
  slope20: number | null;
  ret5: number | null;
  atrPct: number | null;
  rangeVsAtr: number | null;
  bodyRatio: number | null;
  vixChg: number | null;
  vixChg5: number | null;
  vixTerm: number | null;
  iwmRel20: number | null;
  rspRel20: number | null;
  qqqDist50: number | null;
  dxyChg20: number | null;
  tnxChgBp: number | null;
};

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const pct = (a: number | null | undefined, b: number | null | undefined) => (fin(a) && fin(b) && b !== 0 ? (a / b - 1) * 100 : null);
export const clamp = (v: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v));

function sma(xs: number[], end: number, n: number): number | null {
  if (end + 1 < n) return null;
  let s = 0;
  for (let k = end - n + 1; k <= end; k++) s += xs[k];
  return s / n;
}

/** Bars → frame aligned on SPY sessions; other symbols carried forward over a missing day (holiday mismatch). */
export function buildFrame(data: MarketData): Row[] {
  const spy = (data.spy ?? []).filter((b) => fin(b.c) && fin(b.o) && fin(b.h) && fin(b.l));
  if (!spy.length) return [];
  const series = (k: SymbolKey) => {
    const m = new Map<string, number>();
    for (const b of data[k] ?? []) if (fin(b.c)) m.set(b.d, b.c);
    return m;
  };
  const maps = { vix: series("vix"), vix3m: series("vix3m"), iwm: series("iwm"), rsp: series("rsp"), qqq: series("qqq"), tnx: series("tnx"), dxy: series("dxy") };
  const last: Record<keyof typeof maps, number | null> = { vix: null, vix3m: null, iwm: null, rsp: null, qqq: null, tnx: null, dxy: null };
  const closes = spy.map((b) => b.c);
  const trs: number[] = spy.map((b, i) => (i === 0 ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - spy[i - 1].c), Math.abs(b.l - spy[i - 1].c))));
  const rows: Row[] = [];
  const qqqCloses: (number | null)[] = [];
  for (let i = 0; i < spy.length; i++) {
    const b = spy[i];
    for (const k of Object.keys(maps) as (keyof typeof maps)[]) {
      const v = maps[k].get(b.d);
      if (v != null) last[k] = v;
    }
    qqqCloses.push(last.qqq);
    const prev = i > 0 ? spy[i - 1] : null;
    const s20 = sma(closes, i, 20);
    const s50 = sma(closes, i, 50);
    const s20prev = i >= 5 ? sma(closes, i - 5, 20) : null;
    const atr = sma(trs, i, 14);
    const range = b.h - b.l;
    const prevRow = i > 0 ? rows[i - 1] : null;
    const back = (n: number) => (i >= n ? rows[i - n] : null);
    const r20 = back(20);
    const r5 = back(5);
    const q50 = (() => {
      if (i < 49) return null;
      const xs = qqqCloses.slice(i - 49, i + 1);
      if (xs.some((x) => x == null)) return null;
      return (xs as number[]).reduce((a, c) => a + c, 0) / 50;
    })();
    const row: Row = {
      d: b.d,
      spy: b,
      vix: last.vix, vix3m: last.vix3m, iwm: last.iwm, rsp: last.rsp, qqq: last.qqq, tnx: last.tnx, dxy: last.dxy,
      spyChg: prev ? pct(b.c, prev.c) : null,
      spyGap: prev ? pct(b.o, prev.c) : null,
      dist20: pct(b.c, s20),
      dist50: pct(b.c, s50),
      slope20: pct(s20, s20prev),
      ret5: r5 ? pct(b.c, r5.spy.c) : null,
      atrPct: atr != null ? (atr / b.c) * 100 : null,
      rangeVsAtr: atr ? range / atr : null,
      bodyRatio: range > 0 ? Math.abs(b.c - b.o) / range : null,
      vixChg: prevRow ? pct(last.vix, prevRow.vix) : null,
      vixChg5: r5 ? pct(last.vix, r5.vix) : null,
      vixTerm: fin(last.vix) && fin(last.vix3m) && last.vix3m > 0 ? last.vix / last.vix3m : null,
      iwmRel20: r20 ? diff(pct(last.iwm, r20.iwm), pct(b.c, r20.spy.c)) : null,
      rspRel20: r20 ? diff(pct(last.rsp, r20.rsp), pct(b.c, r20.spy.c)) : null,
      qqqDist50: pct(last.qqq, q50),
      dxyChg20: r20 ? pct(last.dxy, r20.dxy) : null,
      tnxChgBp: prevRow && fin(last.tnx) && fin(prevRow.tnx) ? (last.tnx - prevRow.tnx) * 100 : null,
    };
    rows.push(row);
  }
  return rows;
}
function diff(a: number | null, b: number | null) {
  return fin(a) && fin(b) ? a - b : null;
}

/** Share (0..1) of the last `window` values that are ≤ the value at `idx`. null when < 60 values. */
export function percentileAt(values: (number | null)[], idx: number, window = 252): number | null {
  const v = values[idx];
  if (!fin(v)) return null;
  const from = Math.max(0, idx - window + 1);
  let n = 0, le = 0;
  for (let k = from; k <= idx; k++) {
    const x = values[k];
    if (!fin(x)) continue;
    n++;
    if (x <= v) le++;
  }
  return n >= 60 ? le / n : null;
}

/* ─────────────────────────────── Regime ─────────────────────────────── */

export type Axis = "trend" | "vol" | "risk";
export type Driver = { id: string; axis: Axis; label: string; reading: string; impact: number; weight: number };
export type Regime = {
  d: string;
  trend: { key: "up" | "down" | "range"; label: string; score: number };
  vol: { key: "low" | "mid" | "high"; label: string; score: number };
  risk: { key: "on" | "mixed" | "off"; label: string; score: number };
  drivers: Driver[];
  headline: string;
};

const ordinal = (p: number) => `${Math.round(p * 100)}-й перцентиль`;

function weighted(ds: Driver[]): number {
  const w = ds.reduce((a, d) => a + d.weight, 0);
  return w ? ds.reduce((a, d) => a + d.impact * d.weight, 0) / w : 0;
}

/** Regime as of the close of rows[i]. Null when the frame is too short (needs ~50 sessions). */
export function regimeAt(rows: Row[], i: number): Regime | null {
  const r = rows[i];
  if (!r || r.dist50 == null || r.dist20 == null) return null;
  const drivers: Driver[] = [];

  // Trend: where SPY sits vs its 20/50-day averages and where the 20-day is heading.
  drivers.push({ id: "dist50", axis: "trend", label: "SPY к 50-дневной средней", reading: fmtPct(r.dist50, 1), impact: clamp(r.dist50 / 3), weight: 1 });
  drivers.push({ id: "dist20", axis: "trend", label: "SPY к 20-дневной средней", reading: fmtPct(r.dist20, 1), impact: clamp(r.dist20 / 2), weight: 1 });
  if (r.slope20 != null) drivers.push({ id: "slope20", axis: "trend", label: "Наклон 20-дневной за неделю", reading: fmtPct(r.slope20, 2), impact: clamp(r.slope20 / 1), weight: 1 });

  // Volatility: VIX level vs the last year + how much SPY actually moves (ATR%).
  const vixP = percentileAt(rows.map((x) => x.vix), i);
  const atrP = percentileAt(rows.map((x) => x.atrPct), i);
  if (r.vix != null) {
    drivers.push({
      id: "vix", axis: "vol", label: "VIX", reading: `${fmtNum(r.vix, 1)}${vixP != null ? ` · ${ordinal(vixP)}` : ""}`,
      impact: vixP != null ? clamp((vixP - 0.5) * 2) : clamp((r.vix - 18) / 8), weight: 1.5,
    });
  }
  if (r.atrPct != null) {
    drivers.push({
      id: "atr", axis: "vol", label: "Дневной ход SPY (ATR)", reading: `${r.atrPct.toFixed(2)}%${atrP != null ? ` · ${ordinal(atrP)}` : ""}`,
      impact: atrP != null ? clamp((atrP - 0.5) * 2) : 0, weight: 1,
    });
  }

  // Risk appetite: VIX curve, small caps and equal-weight vs the index, VIX momentum, dollar.
  if (r.vixTerm != null) drivers.push({ id: "vixTerm", axis: "risk", label: "Структура VIX (VIX / VIX3M)", reading: r.vixTerm.toFixed(2), impact: clamp((0.95 - r.vixTerm) / 0.08), weight: 1.5 });
  if (r.iwmRel20 != null) drivers.push({ id: "iwm", axis: "risk", label: "Малые компании к SPY, 20 дн.", reading: `${fmtNum(r.iwmRel20, { decimals: 1, signed: true })} п.п.`, impact: clamp(r.iwmRel20 / 3), weight: 1 });
  if (r.rspRel20 != null) drivers.push({ id: "rsp", axis: "risk", label: "Широта: равновзвешенный к SPY, 20 дн.", reading: `${fmtNum(r.rspRel20, { decimals: 1, signed: true })} п.п.`, impact: clamp(r.rspRel20 / 2), weight: 1 });
  if (r.vixChg5 != null) drivers.push({ id: "vixChg5", axis: "risk", label: "VIX за неделю", reading: fmtPct(r.vixChg5, 1), impact: clamp(-r.vixChg5 / 15), weight: 1 });
  if (r.dxyChg20 != null) drivers.push({ id: "dxy", axis: "risk", label: "Доллар (DXY) за 20 дн.", reading: fmtPct(r.dxyChg20, 1), impact: clamp(-r.dxyChg20 / 2), weight: 0.5 });

  const trendScore = weighted(drivers.filter((d) => d.axis === "trend"));
  const volScore = weighted(drivers.filter((d) => d.axis === "vol"));
  const riskScore = weighted(drivers.filter((d) => d.axis === "risk"));

  const trend = trendScore >= 0.35 ? { key: "up" as const, label: "Тренд вверх" } : trendScore <= -0.35 ? { key: "down" as const, label: "Тренд вниз" } : { key: "range" as const, label: "Боковик" };
  const highVix = r.vix != null && r.vix >= 25;
  const vol = highVix || volScore >= 0.4 ? { key: "high" as const, label: "Высокая волатильность" } : volScore <= -0.3 ? { key: "low" as const, label: "Низкая волатильность" } : { key: "mid" as const, label: "Обычная волатильность" };
  const risk = riskScore >= 0.25 ? { key: "on" as const, label: "Аппетит к риску" } : riskScore <= -0.25 ? { key: "off" as const, label: "Бегство от риска" } : { key: "mixed" as const, label: "Смешанный фон" };

  return {
    d: r.d,
    trend: { ...trend, score: trendScore },
    vol: { ...vol, score: volScore },
    risk: { ...risk, score: riskScore },
    drivers,
    headline: `${trend.label} · ${vol.label.toLowerCase()} · ${risk.label.toLowerCase()}`,
  };
}

/* ─────────────────────── Trader days & edge buckets ─────────────────────── */

export type TraderDay = { d: string; net: number; trades: number; wins: number; losses: number; hasPnl: boolean };

/** Trades → per-session totals (session = NY trade date; net = gross − |fees|). */
export function traderDays(trades: TradeLike[]): Map<string, TraderDay> {
  const m = new Map<string, TraderDay>();
  for (const t of trades) {
    const d = String(t.date ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    const res = resultOf(t);
    if (res === null) continue; // still open
    const cur = m.get(d) ?? { d, net: 0, trades: 0, wins: 0, losses: 0, hasPnl: false };
    const n = netPnl(t);
    if (n != null) { cur.net += n; cur.hasPnl = true; }
    cur.trades++;
    if (res === "win") cur.wins++;
    else if (res === "loss") cur.losses++;
    m.set(d, cur);
  }
  return m;
}

export type BucketDef = { id: string; label: string };
export type Dimension = {
  id: string;
  label: string;
  when: "pre" | "day";
  /** Plain-Russian explanation shown in the tooltip. */
  explain: string;
  buckets: BucketDef[];
  /** Bucket of session rows[i]. "pre" dimensions must only read rows[i−1] (and rows[i].spy.o). */
  classify: (rows: Row[], i: number) => string | null;
};

const preRow = (rows: Row[], i: number) => (i > 0 ? rows[i - 1] : null);

export const DIMENSIONS: Dimension[] = [
  {
    id: "vixLevel", label: "VIX перед сессией", when: "pre",
    explain: "Уровень индекса страха на закрытии накануне. Чем выше, тем шире свечи и резче развороты.",
    buckets: [{ id: "lt15", label: "Ниже 15" }, { id: "15-20", label: "15–20" }, { id: "20-25", label: "20–25" }, { id: "ge25", label: "25 и выше" }],
    classify: (rows, i) => {
      const v = preRow(rows, i)?.vix;
      if (v == null) return null;
      return v < 15 ? "lt15" : v < 20 ? "15-20" : v < 25 ? "20-25" : "ge25";
    },
  },
  {
    id: "trend", label: "Тренд SPY перед сессией", when: "pre",
    explain: "Где был SPY относительно 20- и 50-дневной средней на закрытии накануне.",
    buckets: [{ id: "up", label: "Тренд вверх" }, { id: "range", label: "Боковик" }, { id: "down", label: "Тренд вниз" }],
    classify: (rows, i) => (i > 0 ? regimeAt(rows, i - 1)?.trend.key ?? null : null),
  },
  {
    id: "risk", label: "Аппетит к риску", when: "pre",
    explain: "Сводный фон накануне: структура VIX, малые компании и широта рынка к SPY, динамика VIX и доллара.",
    buckets: [{ id: "on", label: "Аппетит к риску" }, { id: "mixed", label: "Смешанный" }, { id: "off", label: "Бегство от риска" }],
    classify: (rows, i) => (i > 0 ? regimeAt(rows, i - 1)?.risk.key ?? null : null),
  },
  {
    id: "gap", label: "Гэп SPY на открытии", when: "pre",
    explain: "Открытие SPY относительно вчерашнего закрытия. Известно в 9:30, до первой сделки.",
    buckets: [{ id: "up", label: "Гэп вверх ≥ 0.5%" }, { id: "flat", label: "Без гэпа" }, { id: "down", label: "Гэп вниз ≥ 0.5%" }],
    classify: (rows, i) => {
      const g = rows[i]?.spyGap;
      if (g == null) return null;
      return g >= 0.5 ? "up" : g <= -0.5 ? "down" : "flat";
    },
  },
  {
    id: "breadth", label: "Широта рынка, 20 дн.", when: "pre",
    explain: "Равновзвешенный S&P 500 (RSP) против обычного (SPY) за 20 дней. Если RSP отстаёт, рост держится на нескольких мегакапах.",
    buckets: [{ id: "broad", label: "Широкий рост" }, { id: "neutral", label: "Нейтрально" }, { id: "narrow", label: "Узкий рынок" }],
    classify: (rows, i) => {
      const v = preRow(rows, i)?.rspRel20;
      if (v == null) return null;
      return v >= 0.5 ? "broad" : v <= -0.5 ? "narrow" : "neutral";
    },
  },
  {
    id: "dayType", label: "Тип дня SPY", when: "day",
    explain: "Трендовый день: SPY закрылся у края диапазона (тело свечи ≥ 60% диапазона) и прошёл ≥ 0.5%. Остальные дни считаются диапазонными.",
    buckets: [{ id: "trend", label: "Трендовый" }, { id: "range", label: "Диапазонный" }],
    classify: (rows, i) => {
      const r = rows[i];
      if (r?.bodyRatio == null || r.spyChg == null) return null;
      return r.bodyRatio >= 0.6 && Math.abs(r.spyChg) >= 0.5 ? "trend" : "range";
    },
  },
  {
    id: "direction", label: "Направление SPY за день", when: "day",
    explain: "Изменение SPY от вчерашнего закрытия до сегодняшнего.",
    buckets: [{ id: "up", label: "Рост > 0.3%" }, { id: "flat", label: "Флэт" }, { id: "down", label: "Падение > 0.3%" }],
    classify: (rows, i) => {
      const c = rows[i]?.spyChg;
      if (c == null) return null;
      return c > 0.3 ? "up" : c < -0.3 ? "down" : "flat";
    },
  },
  {
    id: "range", label: "Размах дня SPY", when: "day",
    explain: "Диапазон дня (хай − лоу) относительно обычного (ATR за 14 дней). Широкий день — рынок сильно ходит.",
    buckets: [{ id: "wide", label: "Широкий > 1.2 ATR" }, { id: "normal", label: "Обычный" }, { id: "narrow", label: "Узкий < 0.8 ATR" }],
    classify: (rows, i) => {
      const v = rows[i]?.rangeVsAtr;
      if (v == null) return null;
      return v > 1.2 ? "wide" : v < 0.8 ? "narrow" : "normal";
    },
  },
  {
    id: "vixMove", label: "VIX за день", when: "day",
    explain: "Рос или падал индекс страха в течение сессии. Рост VIX обычно означает распродажу и нервную ленту.",
    buckets: [{ id: "up", label: "Рос > 5%" }, { id: "flat", label: "Без изменений" }, { id: "down", label: "Падал > 5%" }],
    classify: (rows, i) => {
      const c = rows[i]?.vixChg;
      if (c == null) return null;
      return c > 5 ? "up" : c < -5 ? "down" : "flat";
    },
  },
];

export type BucketStats = BucketDef & {
  days: number;
  trades: number;
  net: number;
  netPerDay: number;
  winRate: number | null;
  perTrade: number | null;
  greenDays: number;
  /** (bucket mean − rest mean) / standard error — ≥ 2 by absolute value ⇒ the difference is unlikely to be noise. */
  t: number | null;
  dates: string[];
};

export const MIN_DAYS = 8;

/** Sessions that both have market data and trader results, keyed by frame index. */
export function joinDays(rows: Row[], days: Map<string, TraderDay>): { i: number; day: TraderDay }[] {
  const out: { i: number; day: TraderDay }[] = [];
  rows.forEach((r, i) => {
    const day = days.get(r.d);
    if (day && day.hasPnl) out.push({ i, day });
  });
  return out;
}

function stats(def: BucketDef, items: { i: number; day: TraderDay }[], rest: { i: number; day: TraderDay }[], rows: Row[]): BucketStats {
  const days = items.length;
  const trades = items.reduce((a, x) => a + x.day.trades, 0);
  const net = items.reduce((a, x) => a + x.day.net, 0);
  const wins = items.reduce((a, x) => a + x.day.wins, 0);
  const losses = items.reduce((a, x) => a + x.day.losses, 0);
  const mean = days ? net / days : 0;
  let t: number | null = null;
  if (days >= 3 && rest.length >= 3) {
    const restMean = rest.reduce((a, x) => a + x.day.net, 0) / rest.length;
    const v1 = variance(items.map((x) => x.day.net));
    const v2 = variance(rest.map((x) => x.day.net));
    const se = Math.sqrt(v1 / days + v2 / rest.length);
    t = se > 0 ? (mean - restMean) / se : null;
  }
  return {
    ...def,
    days,
    trades,
    net,
    netPerDay: mean,
    winRate: wins + losses ? wins / (wins + losses) : null,
    perTrade: trades ? net / trades : null,
    greenDays: items.filter((x) => x.day.net > 0).length,
    t,
    dates: items.map((x) => rows[x.i].d),
  };
}
function variance(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
}

export function bucketize(dim: Pick<Dimension, "buckets" | "classify">, rows: Row[], joined: { i: number; day: TraderDay }[]): BucketStats[] {
  const groups = new Map<string, { i: number; day: TraderDay }[]>();
  for (const j of joined) {
    const b = dim.classify(rows, j.i);
    if (b == null) continue;
    const g = groups.get(b) ?? [];
    g.push(j);
    groups.set(b, g);
  }
  const classified = [...groups.values()].flat();
  return dim.buckets.map((def) => {
    const items = groups.get(def.id) ?? [];
    const rest = classified.filter((x) => !items.includes(x));
    return stats(def, items, rest, rows);
  });
}

export function baseline(joined: { i: number; day: TraderDay }[], rows: Row[]): BucketStats {
  return stats({ id: "all", label: "Все дни" }, joined, [], rows);
}

/* ─────────────────────── Indicator readings (cards) ─────────────────────── */

export type IndicatorId = "vix" | "vixTerm" | "spyTrend" | "breadth" | "smallCaps" | "atr" | "tnx" | "dxy";

export type IndicatorDef = {
  id: IndicatorId;
  label: string;
  sub: string;
  /** What it is, in plain Russian (tooltip). */
  explain: string;
  /** How to read today's value. */
  read: (v: number) => string;
  value: (r: Row) => number | null;
  format: (v: number) => string;
  /** Δ formatting (absolute difference of `value`). */
  delta: (v: number) => string;
  /** +1: higher = calmer / risk-on; −1: higher = more risk; 0: neutral. Colours Δ. */
  polarity: 1 | -1 | 0;
  /** Default alert threshold suggestion. */
  alertHint: { op: "above" | "below"; value: number };
};

const pp = (v: number) => `${fmtNum(v, { decimals: 1, signed: true })} п.п.`;

export const INDICATORS: IndicatorDef[] = [
  {
    id: "vix", label: "VIX", sub: "Индекс страха",
    explain: "Ожидаемая волатильность S&P 500 на 30 дней вперёд. Ниже 15 — спокойный рынок и узкие диапазоны, 15–20 — норма, выше 25 — нервная лента, большие свечи и резкие развороты.",
    read: (v) => (v < 15 ? "спокойно" : v < 20 ? "норма" : v < 25 ? "повышенная" : "нервный рынок"),
    value: (r) => r.vix, format: (v) => v.toFixed(1), delta: (v) => fmtNum(v, { decimals: 1, signed: true }), polarity: -1,
    alertHint: { op: "above", value: 20 },
  },
  {
    id: "vixTerm", label: "VIX / VIX3M", sub: "Структура волатильности",
    explain: "Отношение VIX (30 дней) к VIX3M (3 месяца). Ниже 1 — рынок спокоен, страх отнесён в будущее. Выше 1 — страх «здесь и сейчас»: так бывает в распродажи и панику.",
    read: (v) => (v < 0.9 ? "спокойно" : v < 1 ? "насторожённо" : "стресс"),
    value: (r) => r.vixTerm, format: (v) => fmtNum(v), delta: (v) => fmtNum(v, { decimals: 2, signed: true }), polarity: -1,
    alertHint: { op: "above", value: 1 },
  },
  {
    id: "spyTrend", label: "SPY к 50-дн.", sub: "Тренд рынка",
    explain: "На сколько процентов SPY выше или ниже своей 50-дневной средней. Плюс — рынок в аптренде, минус — под давлением. Больше +5% — рынок растянут вверх.",
    read: (v) => (v > 5 ? "растянут вверх" : v > 0 ? "аптренд" : v > -5 ? "под давлением" : "даунтренд"),
    value: (r) => r.dist50, format: (v) => fmtPct(v, 1), delta: pp, polarity: 1,
    alertHint: { op: "below", value: 0 },
  },
  {
    id: "breadth", label: "Широта", sub: "RSP к SPY, 20 дн.",
    explain: "Равновзвешенный S&P 500 (RSP) против обычного SPY за 20 дней. Плюс — растёт широкий рынок, это хорошо для малых и средних бумаг. Минус — рост держится на нескольких мегакапах.",
    read: (v) => (v >= 0.5 ? "широкий рост" : v <= -0.5 ? "узкий рынок" : "нейтрально"),
    value: (r) => r.rspRel20, format: (v) => `${fmtNum(v, { decimals: 1, signed: true })} п.п.`, delta: pp, polarity: 1,
    alertHint: { op: "below", value: -1 },
  },
  {
    id: "smallCaps", label: "Малые компании", sub: "IWM к SPY, 20 дн.",
    explain: "Доходность Russell 2000 (IWM) минус доходность SPY за 20 дней. Малые компании сильнее рынка — у инвесторов есть аппетит к риску. Слабее — деньги уходят в крупные и защитные бумаги.",
    read: (v) => (v >= 1 ? "аппетит к риску" : v <= -1 ? "осторожность" : "нейтрально"),
    value: (r) => r.iwmRel20, format: (v) => `${fmtNum(v, { decimals: 1, signed: true })} п.п.`, delta: pp, polarity: 1,
    alertHint: { op: "below", value: -2 },
  },
  {
    id: "atr", label: "Ход SPY", sub: "ATR 14 дн., % цены",
    explain: "Средний дневной диапазон SPY за 14 дней в процентах от цены. Показывает, сколько рынок реально проходит за день: больше — шире стопы и больше возможностей, меньше — тесный рынок.",
    read: (v) => (v < 0.8 ? "тесный рынок" : v < 1.4 ? "обычный ход" : "широкий ход"),
    value: (r) => r.atrPct, format: (v) => `${v.toFixed(2)}%`, delta: (v) => `${fmtNum(v, { decimals: 2, signed: true })} п.п.`, polarity: 0,
    alertHint: { op: "above", value: 1.5 },
  },
  {
    id: "tnx", label: "Доходность 10Y", sub: "Казначейские облигации США",
    explain: "Доходность 10-летних облигаций США. Резкий рост бьёт по дорогим ростовым бумагам и технологиям; падение обычно поддерживает рост.",
    read: (v) => (v >= 4.75 ? "высокая" : v <= 3.75 ? "низкая" : "средняя"),
    value: (r) => r.tnx, format: (v) => `${v.toFixed(2)}%`, delta: (v) => `${fmtNum(v * 100, { decimals: 0, signed: true })} б.п.`, polarity: -1,
    alertHint: { op: "above", value: 4.75 },
  },
  {
    id: "dxy", label: "Доллар (DXY)", sub: "Индекс доллара США",
    explain: "Сила доллара к корзине валют. Быстрый рост доллара — признак бегства в защиту и давление на рисковые активы.",
    read: () => "",
    value: (r) => r.dxy, format: (v) => v.toFixed(2), delta: (v) => fmtNum(v, { decimals: 2, signed: true }), polarity: -1,
    alertHint: { op: "above", value: 105 },
  },
];
export const INDICATOR_BY_ID = new Map(INDICATORS.map((d) => [d.id, d]));

export type Reading = {
  id: IndicatorId;
  value: number | null;
  dDay: number | null;
  dWeek: number | null;
  percentile: number | null;
  spark: (number | null)[];
  /** Full series (aligned to rows) for terciles / alerts. */
  series: (number | null)[];
};

export function readings(rows: Row[], sparkLen = 60): Reading[] {
  const last = rows.length - 1;
  return INDICATORS.map((def) => {
    const series = rows.map(def.value);
    const v = last >= 0 ? series[last] : null;
    const at = (k: number) => (k >= 0 ? series[k] : null);
    const d1 = at(last - 1), d5 = at(last - 5);
    return {
      id: def.id,
      value: v,
      dDay: fin(v) && fin(d1) ? v - d1 : null,
      dWeek: fin(v) && fin(d5) ? v - d5 : null,
      percentile: last >= 0 ? percentileAt(series, last) : null,
      spark: series.slice(-sparkLen),
      series,
    };
  });
}

/** Tercile dimension for one indicator over the trader's sessions (value at the previous close ⇒ known pre-open). */
export function tercileDimension(def: IndicatorDef, rows: Row[], joined: { i: number; day: TraderDay }[]): { dim: Pick<Dimension, "buckets" | "classify">; cuts: [number, number] } | null {
  const vals = joined.map((j) => (j.i > 0 ? def.value(rows[j.i - 1]) : null)).filter(fin).sort((a, b) => a - b);
  if (vals.length < MIN_DAYS * 3) return null;
  const q = (p: number) => vals[Math.min(vals.length - 1, Math.max(0, Math.round(p * (vals.length - 1))))];
  const lo = q(1 / 3), hi = q(2 / 3);
  if (!(hi > lo)) return null;
  const f = def.format;
  return {
    cuts: [lo, hi],
    dim: {
      buckets: [
        { id: "low", label: `Ниже ${f(lo)}` },
        { id: "mid", label: `${f(lo)} … ${f(hi)}` },
        { id: "high", label: `Выше ${f(hi)}` },
      ],
      classify: (rs, i) => {
        if (i < 1) return null;
        const v = def.value(rs[i - 1]);
        if (!fin(v)) return null;
        return v < lo ? "low" : v > hi ? "high" : "mid";
      },
    },
  };
}

/* ─────────────────────────────── Analogues ─────────────────────────────── */

const FEATURES: { id: string; get: (r: Row) => number | null }[] = [
  { id: "vix", get: (r) => (fin(r.vix) && r.vix > 0 ? Math.log(r.vix) : null) },
  { id: "vixTerm", get: (r) => r.vixTerm },
  { id: "dist50", get: (r) => r.dist50 },
  { id: "ret5", get: (r) => r.ret5 },
  { id: "iwmRel20", get: (r) => r.iwmRel20 },
  { id: "rspRel20", get: (r) => r.rspRel20 },
  { id: "atrPct", get: (r) => r.atrPct },
];

export type Analogue = { i: number; d: string; similarity: number; day: TraderDay; spyChg: number | null; vix: number | null; dayType: string | null };

/**
 * Sessions whose PRE-OPEN state (close of the day before) is closest to `stateIdx` (z-scored Euclidean distance
 * over FEATURES). Only sessions the trader traded; `excludeDate` removes the live session itself.
 */
export function analogues(rows: Row[], joined: { i: number; day: TraderDay }[], stateIdx: number, n = 8, excludeDate?: string): Analogue[] {
  if (stateIdx < 0 || stateIdx >= rows.length) return [];
  const vecs = rows.map((r) => FEATURES.map((f) => f.get(r)));
  const complete = vecs.filter((v) => v.every(fin)) as number[][];
  if (complete.length < 30) return [];
  const k = FEATURES.length;
  const mu = Array.from({ length: k }, (_, j) => complete.reduce((a, v) => a + v[j], 0) / complete.length);
  const sd = Array.from({ length: k }, (_, j) => Math.sqrt(complete.reduce((a, v) => a + (v[j] - mu[j]) ** 2, 0) / complete.length) || 1);
  const cur = vecs[stateIdx];
  if (!cur.every(fin)) return [];
  const z = (v: number[]) => v.map((x, j) => (x - mu[j]) / sd[j]);
  const zc = z(cur as number[]);
  const dayType = DIMENSIONS.find((d) => d.id === "dayType")!;
  const out: Analogue[] = [];
  for (const j of joined) {
    if (j.i < 1 || rows[j.i].d === excludeDate || j.i - 1 === stateIdx) continue;
    const v = vecs[j.i - 1];
    if (!v.every(fin)) continue;
    const zv = z(v as number[]);
    const dist = Math.sqrt(zv.reduce((a, x, q) => a + (x - zc[q]) ** 2, 0));
    out.push({
      i: j.i,
      d: rows[j.i].d,
      similarity: Math.max(0, 1 - dist / (2 * Math.sqrt(k))),
      day: j.day,
      spyChg: rows[j.i].spyChg,
      vix: rows[j.i - 1].vix,
      dayType: dayType.classify(rows, j.i),
    });
  }
  return out.sort((a, b) => b.similarity - a.similarity).slice(0, n);
}

/* ─────────────────────────────── Alerts ─────────────────────────────── */

export type AlertRule = { op: "above" | "below"; value: number };

export function alertFires(rule: AlertRule, v: number | null): boolean {
  if (!fin(v)) return false;
  return rule.op === "above" ? v > rule.value : v < rule.value;
}
