/**
 * Rule model of the «Что если» simulator. A scenario is a list of API rules (`Rule[]`, at most one per type —
 * the server engine api-server/src/lib/whatIf.ts ignores duplicates), shown as chips. Everything here is pure:
 * merging / removing rules, phrasing (whatIf namespace), URL encoding and a client-side preview of how many trades a single
 * rule touches (a mirror of the engine's per-rule logic, used only for the live counter — the scenario itself is
 * always computed by the server).
 */
import { type ErrorCode, errorCodeOf, isErrorCode } from "@/components/shared/error-vocab";
import { GRADES, STRATEGIES, type CommissionPlan, type Grade, type Rule, type Side, type Strategy } from "@/components/shared/what-if-rules";
export { GRADES, STRATEGIES, encodeRules, type CommissionPlan, type Grade, type Rule, type Side, type Strategy } from "@/components/shared/what-if-rules";
export { ENTRY_MISTAKES, chipLabel, fmtHold, ifNotPhrase, reasonLabel } from "./rules-phrasing";

/** 0 = best (A+); null when not a known grade. Mirror of whatIf.gradeRank. */
export function gradeRank(g: string | null | undefined): number | null {
  const i = GRADES.indexOf(String(g ?? "").trim().toUpperCase() as Grade);
  return i < 0 ? null : i;
}

export type RuleType = Rule["type"];

/** Longest personal tag a rule takes (the API's ruleSchema). */
export const MAX_TAG_LEN = 60;

/** Rule types the server shipped before sizeRange / afterLoss (used when /whatif/base has no `ruleTypes`). */
export const LEGACY_RULE_TYPES: RuleType[] = [
  "dailyLossLimit", "maxTradesPerDay", "stopAfterLosses", "timeWindow", "priceRange", "minHold", "excludeTickers", "excludeSide", "commissionPlan", "capLoss",
];

/** Minimal trade shape the preview needs (structurally a subset of the API's SimTrade). */
export type PreviewTrade = {
  id: number;
  day: string;
  entryMin: number | null;
  ticker: string;
  side: Side | null;
  qty: number | null;
  entry: number | null;
  gross: number | null;
  fees: number;
  holdSec: number | null;
  seq: number;
  fills?: number | null;
  feeBreakdown?: Record<string, number> | null;
  /** Σ regulatory fees (SEC/TAF/CAT/ORF/NFA) — the compact /whatif/base sends this instead of the breakdown. */
  regFees?: number | null;
  setup?: string | null;
  grade?: string | null;
  /** Owner: day rules run per trader-day (the whole team); absent ⇒ one trader. */
  trader?: string | null;
  /** Close-auction (IMX) trade. */
  imx?: boolean;
  /** Re-entry into the same ticker. */
  reentry?: boolean;
  /** Position / the trader's usual (60-day median) size; null when unknown. */
  sizeRel?: number | null;
  /** Entry with a stop: true / false, null = unknown. */
  hasStop?: boolean | null;
  /** Marked mistakes (vocabulary codes). */
  mistakes?: ErrorCode[];
  /** Personal tags (no IMX, no mistakes). */
  ptags?: string[];
  /** PropReports-style strategy (OPG, Day, MOC …); absent on older API builds. */
  strategy?: string | null;
  /** The stock reports earnings that trading day; null / absent = no calendar. */
  earnings?: boolean | null;
};

/* ─── Scenario list operations ───────────────────────────────────────────── */

/**
 * Adds a rule to the scenario. Rules of the same type are merged where that is meaningful (time window bounds,
 * price / size bounds, ticker lists); otherwise the new rule replaces the old one.
 */
export function mergeRule(rules: Rule[], r: Rule): Rule[] {
  const i = rules.findIndex((x) => x.type === r.type);
  if (i < 0) return [...rules, r];
  const prev = rules[i];
  let next: Rule = r;
  if (r.type === "timeWindow" && prev.type === "timeWindow") next = { type: "timeWindow", from: r.from ?? prev.from ?? null, to: r.to ?? prev.to ?? null };
  else if (r.type === "priceRange" && prev.type === "priceRange") next = { type: "priceRange", min: r.min ?? prev.min ?? null, max: r.max ?? prev.max ?? null };
  else if (r.type === "sizeRange" && prev.type === "sizeRange") next = { type: "sizeRange", min: r.min ?? prev.min ?? null, max: r.max ?? prev.max ?? null };
  else if (r.type === "excludeTickers" && prev.type === "excludeTickers") next = { type: "excludeTickers", tickers: [...new Set([...prev.tickers, ...r.tickers].map((t) => t.toUpperCase()))] };
  else if (r.type === "excludeMistakes" && prev.type === "excludeMistakes") next = { type: "excludeMistakes", codes: [...new Set([...prev.codes, ...r.codes])] };
  else if (r.type === "excludeTags" && prev.type === "excludeTags") next = { type: "excludeTags", tags: uniqTags([...prev.tags, ...r.tags]) };
  const out = [...rules];
  out[i] = next;
  return out;
}

/** Tags without case-insensitive repeats (the first spelling stays). */
function uniqTags(tags: string[]): string[] {
  const seen = new Set<string>();
  return tags.filter((t) => {
    const k = t.trim().toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function removeRule(rules: Rule[], type: RuleType): Rule[] {
  return rules.filter((r) => r.type !== type);
}

/**
 * Takes a previously merged rule back out: for mergeable types only the parts `r` contributed are removed
 * (e.g. un-applying «не входить после 15:00» keeps a «не раньше 09:45» bound); otherwise the type is removed.
 */
export function subtractRule(rules: Rule[], r: Rule): Rule[] {
  const i = rules.findIndex((x) => x.type === r.type);
  if (i < 0) return rules;
  const cur = rules[i];
  let next: Rule | null = null;
  if (cur.type === "timeWindow" && r.type === "timeWindow") {
    const from = r.from && cur.from === r.from ? null : cur.from ?? null;
    const to = r.to && cur.to === r.to ? null : cur.to ?? null;
    next = from || to ? { type: "timeWindow", from, to } : null;
  } else if ((cur.type === "priceRange" && r.type === "priceRange") || (cur.type === "sizeRange" && r.type === "sizeRange")) {
    const min = r.min != null && cur.min === r.min ? null : cur.min ?? null;
    const max = r.max != null && cur.max === r.max ? null : cur.max ?? null;
    next = min != null || max != null ? { type: cur.type, min, max } : null;
  } else if (cur.type === "excludeTickers" && r.type === "excludeTickers") {
    const drop = new Set(r.tickers.map((t) => t.toUpperCase()));
    const tickers = cur.tickers.filter((t) => !drop.has(t.toUpperCase()));
    next = tickers.length ? { type: "excludeTickers", tickers } : null;
  } else if (cur.type === "excludeMistakes" && r.type === "excludeMistakes") {
    const codes = cur.codes.filter((c) => !r.codes.includes(c));
    next = codes.length ? { type: "excludeMistakes", codes } : null;
  } else if (cur.type === "excludeTags" && r.type === "excludeTags") {
    const drop = new Set(r.tags.map((t) => t.trim().toLowerCase()));
    const tags = cur.tags.filter((t) => !drop.has(t.trim().toLowerCase()));
    next = tags.length ? { type: "excludeTags", tags } : null;
  }
  const out = [...rules];
  if (next) out[i] = next;
  else out.splice(i, 1);
  return out;
}

/** Same rule (by value) — used to mark a suggestion as applied. */
export function sameRule(a: Rule, b: Rule): boolean {
  return JSON.stringify(normalise(a)) === JSON.stringify(normalise(b));
}

/** True when `r` is already fully covered by the scenario (its rule of that type equals r after merging). */
export function isApplied(rules: Rule[], r: Rule): boolean {
  const cur = rules.find((x) => x.type === r.type);
  if (!cur) return false;
  return sameRule(cur, mergeRule([cur], r)[0]);
}

function normalise(r: Rule): Rule {
  switch (r.type) {
    case "timeWindow": return { type: r.type, from: r.from || null, to: r.to || null };
    case "priceRange": return { type: r.type, min: r.min ?? null, max: r.max ?? null };
    case "sizeRange": return { type: r.type, min: r.min ?? null, max: r.max ?? null };
    case "excludeTickers": return { type: r.type, tickers: [...r.tickers].map((t) => t.toUpperCase()).sort() };
    case "commissionPlan": return { ...r, keepRegulatory: r.keepRegulatory ?? true };
    case "excludeMistakes": return { type: r.type, codes: [...r.codes].sort() };
    case "excludeTags": return { type: r.type, tags: r.tags.map((t) => t.trim().toLowerCase()).sort() };
    default: return r;
  }
}

/* ─── URL state ──────────────────────────────────────────────────────────── */

const RULE_KEYS: Record<RuleType, string[]> = {
  dailyLossLimit: ["usd"], maxTradesPerDay: ["n"], stopAfterLosses: ["n"], timeWindow: ["from", "to"], priceRange: ["min", "max"],
  minHold: ["seconds"], excludeTickers: ["tickers"], excludeSide: ["side"], commissionPlan: ["perShare", "minPerOrder", "ecnPerShare", "keepRegulatory"],
  capLoss: ["usd"], sizeRange: ["min", "max"], afterLoss: ["minutes"], excludeSetups: ["setups"], minGrade: ["grade"],
  excludeImx: [], noReentry: [], requireStop: [], maxSizeRel: ["x"], excludeMistakes: ["codes"], excludeTags: ["tags"],
  profitGiveback: ["peak", "pct"], dailyProfitTarget: ["usd"],
  afterWin: ["minutes"], redZone: ["usd", "k", "floor"], blockWindow: ["from", "to"], maxTradesPerTicker: ["n"],
  noReentryAfterLoss: ["minutes"], excludeStrategies: ["strategies"], excludeEarnings: [],
};

/** Inverse of encodeRules; drops anything that does not look like a valid rule. Never throws. */
export function decodeRules(s: string | null | undefined): Rule[] {
  if (!s) return [];
  try {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    const json = typeof atob === "function" ? decodeURIComponent(escape(atob(b64))) : Buffer.from(b64, "base64").toString("utf8");
    const arr = JSON.parse(json) as unknown;
    if (!Array.isArray(arr)) return [];
    let out: Rule[] = [];
    for (const x of arr.slice(0, 20)) {
      const r = sanitize(x);
      if (r) out = mergeRule(out, r);
    }
    return out;
  } catch {
    return [];
  }
}

const HM = /^([01]?\d|2[0-3]):[0-5]\d$/;
const posNum = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
const nonNeg = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

function sanitize(x: unknown): Rule | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const type = o.type as RuleType;
  if (!(type in RULE_KEYS)) return null;
  switch (type) {
    case "dailyLossLimit": case "capLoss": case "dailyProfitTarget": { const usd = posNum(o.usd); return usd ? { type, usd } : null; }
    case "excludeImx": case "noReentry": case "requireStop": case "excludeEarnings": return { type };
    case "afterWin": case "noReentryAfterLoss": { const minutes = posNum(o.minutes); return minutes ? { type, minutes } : null; }
    case "maxTradesPerTicker": { const n = posNum(o.n); return n ? { type, n: Math.max(1, Math.round(n)) } : null; }
    case "redZone": {
      const usd = posNum(o.usd), k = nonNeg(o.k), floor = posNum(o.floor);
      if (!usd || k == null) return null;
      return { type, usd, k: Math.round(k), ...(floor != null && floor > usd ? { floor } : {}) };
    }
    case "blockWindow": {
      const from = typeof o.from === "string" && HM.test(o.from) ? o.from : null;
      const to = typeof o.to === "string" && HM.test(o.to) ? o.to : null;
      return from && to ? { type, from, to } : null;
    }
    case "excludeStrategies": {
      const list = Array.isArray(o.strategies) ? o.strategies.filter((v): v is Strategy => (STRATEGIES as readonly unknown[]).includes(v)) : [];
      return list.length ? { type, strategies: [...new Set(list)] } : null;
    }
    case "maxSizeRel": { const x = posNum(o.x); return x != null && x >= 0.5 && x <= 10 ? { type, x } : null; }
    case "profitGiveback": {
      const peak = posNum(o.peak), pct = o.pct;
      return peak && typeof pct === "number" && Number.isInteger(pct) && pct >= 10 && pct <= 90 ? { type, peak, pct } : null;
    }
    case "excludeMistakes": {
      const codes = Array.isArray(o.codes) ? [...new Set(o.codes.filter(isErrorCode))] : [];
      return codes.length ? { type, codes } : null;
    }
    case "excludeTags": {
      // Personal tags only: IMX and the mistakes vocabulary have their own rules (the server refuses them here).
      const raw = Array.isArray(o.tags) ? o.tags.filter((v): v is string => typeof v === "string").map((v) => v.trim()) : [];
      const tags = uniqTags(raw.filter((v) => v.length > 0 && v.length <= MAX_TAG_LEN && v.toUpperCase() !== "IMX" && !errorCodeOf(v))).slice(0, 20);
      return tags.length ? { type, tags } : null;
    }
    case "maxTradesPerDay": case "stopAfterLosses": { const n = posNum(o.n); return n ? { type, n: Math.max(1, Math.round(n)) } : null; }
    case "timeWindow": {
      const from = typeof o.from === "string" && HM.test(o.from) ? o.from : null;
      const to = typeof o.to === "string" && HM.test(o.to) ? o.to : null;
      return from || to ? { type, from, to } : null;
    }
    case "priceRange": case "sizeRange": {
      const min = nonNeg(o.min), max = posNum(o.max);
      return min != null || max != null ? { type, min, max } : null;
    }
    case "minHold": { const seconds = posNum(o.seconds); return seconds ? { type, seconds } : null; }
    case "afterLoss": { const minutes = posNum(o.minutes); return minutes ? { type, minutes } : null; }
    case "excludeTickers": {
      const tickers = Array.isArray(o.tickers) ? o.tickers.filter((t): t is string => typeof t === "string" && /^[A-Za-z0-9.\-]{1,16}$/.test(t)).map((t) => t.toUpperCase()) : [];
      return tickers.length ? { type, tickers: [...new Set(tickers)] } : null;
    }
    case "excludeSide": return o.side === "long" || o.side === "short" ? { type, side: o.side } : null;
    case "excludeSetups": {
      const setups = Array.isArray(o.setups) ? o.setups.filter((v): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= 80).map((v) => v.trim()) : [];
      return setups.length ? { type, setups: [...new Set(setups)].slice(0, 50) } : null;
    }
    case "minGrade": return typeof o.grade === "string" && gradeRank(o.grade) != null ? { type, grade: GRADES[gradeRank(o.grade) as number] } : null;
    case "commissionPlan": {
      const perShare = nonNeg(o.perShare), minPerOrder = nonNeg(o.minPerOrder), ecnPerShare = nonNeg(o.ecnPerShare);
      if (perShare == null || minPerOrder == null || ecnPerShare == null) return null;
      return { type, perShare, minPerOrder, ecnPerShare, keepRegulatory: o.keepRegulatory !== false };
    }
  }
  return null;
}

/* ─── Client preview (mirror of the engine, one rule at a time) ──────────── */

/** Tolerance of the profit-side day stops (same as the engine). */
const EPS = 1e-9;

export function netOf(t: PreviewTrade): number | null {
  return t.gross == null ? null : t.gross - Math.abs(t.fees);
}

function parseHm(s: string | null | undefined): number | null {
  if (!s || !HM.test(s)) return null;
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}

function sortTrades<T extends PreviewTrade>(trades: T[]): T[] {
  return [...trades].sort((a, b) => a.day.localeCompare(b.day) || (a.entryMin ?? 1e9) - (b.entryMin ?? 1e9) || a.seq - b.seq || a.id - b.id);
}

/** requireStop: share of the trades that must have a recorded stop (engine whatIfPasses STOP_COVERAGE). */
export const STOP_COVERAGE = 0.15;

/** Stops are recorded on a real share of the trades (hasStop false means «none recorded», not «entered without one»). */
export function stopsRecorded(trades: PreviewTrade[]): boolean {
  return trades.length > 0 && trades.filter((t) => t.hasStop === true).length >= STOP_COVERAGE * trades.length;
}

/** Does a static (per-trade) rule exclude this trade? null for sequential / money rules. */
export function staticExcludes(r: Rule, t: PreviewTrade): boolean | null {
  switch (r.type) {
    case "timeWindow": {
      if (t.entryMin == null) return false;
      const from = parseHm(r.from), to = parseHm(r.to);
      return (from != null && t.entryMin < from) || (to != null && t.entryMin >= to);
    }
    case "priceRange": return t.entry != null && ((r.min != null && t.entry < r.min) || (r.max != null && t.entry > r.max));
    case "minHold": return t.holdSec != null && t.holdSec < r.seconds;
    case "excludeTickers": return r.tickers.some((x) => x.toUpperCase() === t.ticker.toUpperCase());
    case "excludeSide": return t.side === r.side;
    case "sizeRange": return t.qty != null && ((r.min != null && t.qty < r.min) || (r.max != null && t.qty > r.max));
    case "excludeSetups": return !!t.setup && r.setups.some((x) => x.trim().toLowerCase() === t.setup!.trim().toLowerCase());
    case "minGrade": { const g = gradeRank(t.grade); return g == null || g > (gradeRank(r.grade) ?? 0); }
    case "excludeImx": return t.imx === true;
    case "noReentry": return t.reentry === true;
    // No stop recorded goes; unknown (null) is kept, like the engine.
    case "requireStop": return t.hasStop === false;
    case "excludeMistakes": return !!t.mistakes?.some((c) => r.codes.includes(c));
    case "excludeTags": return !!t.ptags?.some((p) => r.tags.some((x) => x.trim().toLowerCase() === p.trim().toLowerCase()));
    case "blockWindow": {
      const from = parseHm(r.from), to = parseHm(r.to);
      return t.entryMin != null && from != null && to != null && t.entryMin >= from && t.entryMin < to;
    }
    case "excludeStrategies": return !!t.strategy && r.strategies.some((s) => s.toLowerCase() === t.strategy!.trim().toLowerCase());
    case "excludeEarnings": return t.earnings === true;
    default: return null;
  }
}

export type Preview = {
  /** Trades the rule removes or changes. */
  affected: number;
  /** Net $ of the removed trades (for money rules: the change of net, positive = better). */
  net: number;
  /** Effect on the period net if this rule were applied alone ($, positive = better). */
  effect: number;
  total: number;
};

/** How many trades a single rule touches, and the effect on net, as if it were the only rule. */
export function previewRule(trades: PreviewTrade[], r: Rule): Preview {
  const list = sortTrades(trades.filter((t) => t.gross != null));
  const total = list.length;
  let affected = 0, net = 0;
  // Like the engine: «only graded …» does nothing when no trade is graded.
  if (r.type === "minGrade" && !list.some((t) => gradeRank(t.grade) != null)) return { affected: 0, net: 0, effect: 0, total };
  if (r.type === "requireStop" && !stopsRecorded(list)) return { affected: 0, net: 0, effect: 0, total };
  const stat = list.length ? staticExcludes(r, list[0]) : null;
  if (stat !== null) {
    for (const t of list) if (staticExcludes(r, t)) { affected++; net += netOf(t)!; }
    return { affected, net: round2(net), effect: round2(-net), total };
  }
  switch (r.type) {
    case "commissionPlan": {
      let delta = 0;
      for (const t of list) {
        const f = recomputeFees(t, r);
        if (f == null) continue;
        if (Math.abs(f - Math.abs(t.fees)) >= 0.005) { affected++; delta += Math.abs(t.fees) - f; }
      }
      return { affected, net: round2(delta), effect: round2(delta), total };
    }
    case "capLoss": {
      let delta = 0;
      for (const t of list) { const n = netOf(t)!; if (n < -r.usd) { affected++; delta += -r.usd - n; } }
      return { affected, net: round2(delta), effect: round2(delta), total };
    }
    case "maxSizeRel": {
      // Scale (estimate): gross and fees shrink alike to x× the usual size (the engine's rounding).
      let delta = 0;
      for (const t of list) {
        if (t.sizeRel == null || !(t.sizeRel > r.x)) continue;
        const f = r.x / t.sizeRel;
        affected++;
        delta += round2(t.gross! * f) - round2(Math.abs(t.fees) * f) - netOf(t)!;
      }
      return { affected, net: round2(delta), effect: round2(delta), total };
    }
    default: return sequentialPreview(list, r, total);
  }
}

type DayState = {
  dayNet: number; count: number; lossRun: number; peak: number; stopped: boolean; lastLossClose: number | null;
  lastWinClose: number | null; zoneLeft: number | null; perTicker: Map<string, number>; tickerLoss: Map<string, number>;
  /** Kept trades still open, by close time. */
  open: { close: number; net: number; ticker: string }[];
};
const newState = (): DayState => ({
  dayNet: 0, count: 0, lossRun: 0, peak: 0, stopped: false, lastLossClose: null, lastWinClose: null, zoneLeft: null, perTicker: new Map(), tickerLoss: new Map(), open: [],
});
const within = (em: number | null, close: number | null | undefined, minutes: number) => em != null && close != null && em >= close && em < close + minutes;

/**
 * Sequential day rules, per trader-day like the engine (the whole team: every trader's day on its own). A kept trade
 * counts only from its close (engine whatIfPasses: no look-ahead into trades still open at a later entry); without an
 * entry time or hold it counts at once.
 */
function sequentialPreview(list: PreviewTrade[], r: Rule, total: number): Preview {
  let affected = 0, net = 0, day = "";
  const states = new Map<string, DayState>();
  const realise = (s: DayState, n: number, close: number | null, ticker: string) => {
    s.dayNet += n;
    if (s.dayNet > s.peak) s.peak = s.dayNet;
    if (n < 0) s.lossRun++; else if (n > 0) s.lossRun = 0;
    if (n < 0 && close != null) { s.lastLossClose = Math.max(s.lastLossClose ?? close, close); s.tickerLoss.set(ticker, Math.max(s.tickerLoss.get(ticker) ?? close, close)); }
    if (n > 0 && close != null) s.lastWinClose = Math.max(s.lastWinClose ?? close, close);
    if (r.type === "redZone" && s.zoneLeft == null && s.dayNet <= -r.usd + EPS) s.zoneLeft = r.k;
    if (s.stopped) return;
    if (r.type === "redZone" && r.floor != null && r.floor > r.usd && s.dayNet <= -r.floor + EPS) s.stopped = true;
    else if (r.type === "dailyLossLimit" && s.dayNet <= -r.usd) s.stopped = true;
    else if (r.type === "stopAfterLosses" && s.lossRun >= r.n) s.stopped = true;
    else if (r.type === "dailyProfitTarget" && s.dayNet >= r.usd - EPS) s.stopped = true;
    else if (r.type === "profitGiveback" && s.peak >= r.peak - EPS && s.dayNet <= s.peak * (1 - r.pct / 100) + EPS) s.stopped = true;
  };
  for (const t of list) {
    if (t.day !== day) { day = t.day; states.clear(); }
    const key = t.trader ?? "";
    let s = states.get(key);
    if (!s) { s = newState(); states.set(key, s); }
    const at = t.entryMin ?? Infinity;
    while (s.open.length && s.open[0].close <= at) { const o = s.open.shift()!; realise(s, o.net, o.close, o.ticker); }
    const n = netOf(t)!;
    const tk = t.ticker.toUpperCase();
    if (s.stopped) { affected++; net += n; continue; }
    if (r.type === "maxTradesPerDay" && s.count >= r.n) { s.stopped = true; affected++; net += n; continue; }
    const skip = (r.type === "redZone" && s.zoneLeft != null && s.zoneLeft <= 0)
      || (r.type === "afterLoss" && within(t.entryMin, s.lastLossClose, r.minutes))
      || (r.type === "afterWin" && within(t.entryMin, s.lastWinClose, r.minutes))
      || (r.type === "maxTradesPerTicker" && (s.perTicker.get(tk) ?? 0) >= r.n)
      || (r.type === "noReentryAfterLoss" && within(t.entryMin, s.tickerLoss.get(tk), r.minutes));
    if (skip) { affected++; net += n; continue; }
    s.count++;
    s.perTicker.set(tk, (s.perTicker.get(tk) ?? 0) + 1);
    if (s.zoneLeft != null) s.zoneLeft--;
    if (t.entryMin != null && t.holdSec != null) {
      const close = t.entryMin + t.holdSec / 60;
      let i = s.open.length;
      while (i > 0 && s.open[i - 1].close > close) i--;
      s.open.splice(i, 0, { close, net: n, ticker: tk });
    } else realise(s, n, t.entryMin, tk);
  }
  return { affected, net: round2(net), effect: round2(-net), total };
}

/* ─── Fees (mirror of whatIf.recomputeFees) ──────────────────────────────── */

const REGULATORY_KEYS = ["sec", "taf", "cat", "orf", "nfa"];

/** Fees of one round trip under a hypothetical tariff (same formula as the server engine). */
export function recomputeFees(t: PreviewTrade, plan: Omit<CommissionPlan, "type">): number | null {
  if (t.qty == null || t.qty <= 0) return null;
  const orders = Math.max(2, Math.round(t.fills ?? 2));
  const sharesPerOrder = (2 * t.qty) / orders;
  const commission = orders * Math.max(plan.minPerOrder, plan.perShare * sharesPerOrder);
  const ecn = plan.ecnPerShare * 2 * t.qty;
  let regulatory = 0;
  if (plan.keepRegulatory !== false) {
    if (t.regFees != null) regulatory = Math.abs(t.regFees);
    else if (t.feeBreakdown) for (const k of REGULATORY_KEYS) regulatory += Math.abs(t.feeBreakdown[k] ?? 0);
  }
  return round2(commission + ecn + regulatory);
}

export type PlanSummary = { fees: number; gross: number; net: number; feePctOfGross: number | null; breakEvenCents: number | null; shares: number; trades: number };

/** Totals of the period under a tariff (null plan = the broker's actual fees). Trades without qty keep their fees. */
export function planSummary(trades: PreviewTrade[], plan: Omit<CommissionPlan, "type"> | null): PlanSummary {
  let fees = 0, gross = 0, shares = 0, n = 0;
  for (const t of trades) {
    if (t.gross == null) continue;
    n++;
    gross += t.gross;
    shares += Math.abs(t.qty ?? 0);
    const f = plan ? recomputeFees(t, plan) : null;
    fees += f ?? Math.abs(t.fees);
  }
  return {
    fees: round2(fees), gross: round2(gross), net: round2(gross - fees),
    feePctOfGross: gross !== 0 ? fees / Math.abs(gross) : null,
    breakEvenCents: shares > 0 ? round2((fees / shares) * 100) : null,
    shares, trades: n,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
