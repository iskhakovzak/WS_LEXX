/**
 * Rule model of the «Что если» simulator. A scenario is a list of API rules (`Rule[]`, at most one per type —
 * the server engine api-server/src/lib/whatIf.ts ignores duplicates), shown as chips. Everything here is pure:
 * merging / removing rules, Russian phrasing, URL encoding and a client-side preview of how many trades a single
 * rule touches (a mirror of the engine's per-rule logic, used only for the live counter — the scenario itself is
 * always computed by the server).
 */

export type Side = "long" | "short";

export type CommissionPlan = { type: "commissionPlan"; perShare: number; minPerOrder: number; ecnPerShare: number; keepRegulatory?: boolean };

export type Rule =
  | { type: "dailyLossLimit"; usd: number }
  | { type: "maxTradesPerDay"; n: number }
  | { type: "stopAfterLosses"; n: number }
  | { type: "timeWindow"; from?: string | null; to?: string | null }
  | { type: "priceRange"; min?: number | null; max?: number | null }
  | { type: "minHold"; seconds: number }
  | { type: "excludeTickers"; tickers: string[] }
  | { type: "excludeSide"; side: Side }
  | CommissionPlan
  | { type: "capLoss"; usd: number }
  | { type: "sizeRange"; min?: number | null; max?: number | null }
  | { type: "afterLoss"; minutes: number }
  | { type: "excludeSetups"; setups: string[] }
  | { type: "minGrade"; grade: Grade };

export const GRADES = ["A+", "A", "B", "C"] as const;
export type Grade = (typeof GRADES)[number];
/** 0 = best (A+); null when not a known grade. Mirror of whatIf.gradeRank. */
export function gradeRank(g: string | null | undefined): number | null {
  const i = GRADES.indexOf(String(g ?? "").trim().toUpperCase() as Grade);
  return i < 0 ? null : i;
}

export type RuleType = Rule["type"];

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
  setup?: string | null;
  grade?: string | null;
};

/* ─── Formatting helpers ─────────────────────────────────────────────────── */

export function fmtHold(seconds: number): string {
  if (seconds < 120) return `${Math.round(seconds)} с`;
  if (seconds < 7200) return `${Math.round(seconds / 60)} мин`;
  return `${Math.round(seconds / 3600)} ч`;
}

const money = (v: number) => `$${Number.isInteger(v) ? v : v.toFixed(2)}`;

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
  const out = [...rules];
  out[i] = next;
  return out;
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
    default: return r;
  }
}

/* ─── Russian phrasing ───────────────────────────────────────────────────── */

/** Short chip label. */
export function chipLabel(r: Rule): string {
  switch (r.type) {
    case "dailyLossLimit": return `Стоп дня на −${money(r.usd)}`;
    case "maxTradesPerDay": return `Не больше ${r.n} сделок в день`;
    case "stopAfterLosses": return `Стоп после ${r.n} убытков подряд`;
    case "timeWindow": return r.from && r.to ? `Входы ${r.from}–${r.to}` : r.from ? `Не входить раньше ${r.from}` : r.to ? `Не входить после ${r.to}` : "Окно времени";
    case "priceRange": return r.min != null && r.max != null ? `Цена $${r.min}–$${r.max}` : r.min != null ? `Без акций дешевле $${r.min}` : r.max != null ? `Без акций дороже $${r.max}` : "Цена";
    case "minHold": return `Без сделок короче ${fmtHold(r.seconds)}`;
    case "excludeTickers": return `Без ${r.tickers.join(", ")}`;
    case "excludeSide": return r.side === "long" ? "Без лонгов" : "Без шортов";
    case "commissionPlan": return `Тариф $${r.perShare}/акц. · мин. $${r.minPerOrder}`;
    case "capLoss": return `Убыток сделки не больше −${money(r.usd)} (оценка)`;
    case "sizeRange": return r.min != null && r.max != null ? `Размер ${r.min}–${r.max} акц.` : r.min != null ? `Без позиций меньше ${r.min} акц.` : r.max != null ? `Без позиций больше ${r.max} акц.` : "Размер";
    case "afterLoss": return `Пауза ${r.minutes} мин после убытка`;
    case "excludeSetups": return `Без сетапов: ${r.setups.join(", ")}`;
    case "minGrade": return r.grade === "A+" ? "Только A+" : `Только ${r.grade} и лучше`;
  }
}

/** «Если бы ты не …» — the suggestion card headline. */
export function ifNotPhrase(r: Rule): string {
  switch (r.type) {
    case "dailyLossLimit": return `Если бы ты останавливался, когда день уходит в −${money(r.usd)}`;
    case "maxTradesPerDay": return `Если бы ты не делал больше ${r.n} сделок в день`;
    case "stopAfterLosses": return `Если бы ты заканчивал день после ${r.n} убытков подряд`;
    case "timeWindow":
      if (r.from && r.to) return `Если бы ты входил только с ${r.from} до ${r.to}`;
      if (r.from) return `Если бы ты не входил раньше ${r.from}`;
      if (r.to) return `Если бы ты не входил после ${r.to}`;
      return "Если бы ты торговал в другое время";
    case "priceRange":
      if (r.min != null && r.max != null) return `Если бы ты торговал только акции за $${r.min}–$${r.max}`;
      if (r.min != null) return `Если бы ты не торговал акции дешевле $${r.min}`;
      if (r.max != null) return `Если бы ты не торговал акции дороже $${r.max}`;
      return "Если бы ты выбирал другие цены";
    case "minHold": return `Если бы ты не закрывал сделки быстрее ${fmtHold(r.seconds)}`;
    case "excludeTickers": return `Если бы ты не торговал ${r.tickers.join(", ")}`;
    case "excludeSide": return r.side === "long" ? "Если бы ты не открывал лонги" : "Если бы ты не открывал шорты";
    case "commissionPlan": return "Если бы у тебя был другой тариф";
    case "capLoss": return `Если бы ты не давал сделке уйти дальше −${money(r.usd)}`;
    case "sizeRange":
      if (r.max != null && r.min == null) return `Если бы ты не брал позиции больше ${r.max} акций`;
      if (r.min != null && r.max == null) return `Если бы ты не брал позиции меньше ${r.min} акций`;
      return `Если бы ты держал размер ${r.min ?? 0}–${r.max ?? "∞"} акций`;
    case "afterLoss": return `Если бы ты не входил ${r.minutes} мин после убыточной сделки`;
    case "excludeSetups": return `Если бы ты не торговал ${r.setups.length > 1 ? "сетапы" : "сетап"} ${r.setups.join(", ")}`;
    case "minGrade": return r.grade === "A+" ? "Если бы ты брал только сделки A+" : `Если бы ты брал только сделки ${r.grade} и лучше`;
  }
}

export const REASON_LABEL: Record<string, string> = {
  dailyLossLimit: "Стоп дня",
  maxTradesPerDay: "Лимит сделок",
  stopAfterLosses: "Серия убытков",
  timeWindow: "Время входа",
  priceRange: "Цена",
  minHold: "Короткая",
  excludeTickers: "Тикер",
  excludeSide: "Сторона",
  commissionPlan: "Тариф",
  capLoss: "Кап убытка",
  sizeRange: "Размер",
  afterLoss: "После убытка",
  excludeSetups: "Сетап",
  minGrade: "Оценка",
};

/* ─── URL state ──────────────────────────────────────────────────────────── */

const RULE_KEYS: Record<RuleType, string[]> = {
  dailyLossLimit: ["usd"], maxTradesPerDay: ["n"], stopAfterLosses: ["n"], timeWindow: ["from", "to"], priceRange: ["min", "max"],
  minHold: ["seconds"], excludeTickers: ["tickers"], excludeSide: ["side"], commissionPlan: ["perShare", "minPerOrder", "ecnPerShare", "keepRegulatory"],
  capLoss: ["usd"], sizeRange: ["min", "max"], afterLoss: ["minutes"], excludeSetups: ["setups"], minGrade: ["grade"],
};

/** Rules → compact URL-safe string (base64url of JSON). Empty list → "". */
export function encodeRules(rules: Rule[]): string {
  if (!rules.length) return "";
  const json = JSON.stringify(rules);
  const b64 = typeof btoa === "function" ? btoa(unescape(encodeURIComponent(json))) : Buffer.from(json, "utf8").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

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
    case "dailyLossLimit": case "capLoss": { const usd = posNum(o.usd); return usd ? { type, usd } : null; }
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
    default: {
      // Sequential day rules (dailyLossLimit / maxTradesPerDay / stopAfterLosses / afterLoss).
      let day = "", dayNet = 0, count = 0, lossRun = 0, stopped = false, lastLossClose: number | null = null;
      for (const t of list) {
        if (t.day !== day) { day = t.day; dayNet = 0; count = 0; lossRun = 0; stopped = false; lastLossClose = null; }
        const n = netOf(t)!;
        if (stopped) { affected++; net += n; continue; }
        if (r.type === "maxTradesPerDay" && count >= r.n) { stopped = true; affected++; net += n; continue; }
        if (r.type === "afterLoss" && lastLossClose != null && t.entryMin != null && t.entryMin >= lastLossClose && t.entryMin < lastLossClose + r.minutes) { affected++; net += n; continue; }
        count++;
        dayNet += n;
        if (n < 0) lossRun++; else if (n > 0) lossRun = 0;
        if (n < 0 && t.entryMin != null) lastLossClose = t.entryMin + (t.holdSec ?? 0) / 60;
        if (r.type === "dailyLossLimit" && dayNet <= -r.usd) stopped = true;
        else if (r.type === "stopAfterLosses" && lossRun >= r.n) stopped = true;
      }
      return { affected, net: round2(net), effect: round2(-net), total };
    }
  }
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
  if (plan.keepRegulatory !== false && t.feeBreakdown) for (const k of REGULATORY_KEYS) regulatory += Math.abs(t.feeBreakdown[k] ?? 0);
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
