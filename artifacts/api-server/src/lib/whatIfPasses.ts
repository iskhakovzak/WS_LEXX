/**
 * Rule passes of the «Что-если» engine, shared by runScenario (lib/whatIf.ts) and the suggestion fast path
 * (lib/whatIfSuggest.ts candidateEffect). Pure and I/O-free; every pass keeps the base order (sortSim), so callers
 * never re-sort:
 *   1. static filters per trade (`staticExclusion`) — the first matching rule wins;
 *   2. money changes over the kept trades (`money`): commissionPlan → maxSizeRel → capLoss;
 *   3. sequential day rules (`sequential`) in entry order on the changed net, per trader-day: in team scope every
 *      trader's day is limited on its own (a desk «day» used to pool everyone's trades), and a kept trade's result
 *      counts only from its close (no look-ahead into trades still open at a later entry).
 * With `T` null (the fast path) detail texts are "" and skip reasons are their keys.
 */
import type { whatifT } from "../i18n/ns";
import type ruWhatif from "../i18n/ru/whatif";
import {
  type ChangedTrade, type ExclusionReason, type Rule, type RuleType, type SimTrade, type SkippedRule,
  fmtHm, gradeRank, netOf, parseHm, round2,
} from "./whatIfTypes";

export type WhatifT = ReturnType<(typeof whatifT)["tFor"]>;
type SkipKey = keyof (typeof ruWhatif)["skip"];
type Hit = { reason: ExclusionReason; detail: string };
type OnExclude = (t: SimTrade, reason: ExclusionReason, detail: string) => void;
/** `delta` = new net − old net of the trade `t` (as it came in), unrounded: the fast path sums it by day. */
type OnChange = (c: ChangedTrade, delta: number, t: SimTrade) => void;

export interface Passes {
  /** The rules in effect (first of each type). */
  rules: Rule[];
  /** Rules that cannot apply to these trades, with the reason (the money pass may add one while it runs). */
  skipped: SkippedRule[];
  staticExclusion: ((t: SimTrade) => Hit | null) | null;
  money: ((kept: SimTrade[], onChange: OnChange) => SimTrade[]) | null;
  sequential: ((kept: SimTrade[], onExclude: OnExclude) => SimTrade[]) | null;
}

/** Tolerance of the profit-side day stops (target / giveback compare sums of cents). */
const EPS = 1e-9;
/** requireStop: share of the trades that must have a recorded stop (web builder-fields uses the same 15%). */
export const STOP_COVERAGE = 0.15;
const REGULATORY_KEYS = ["sec", "taf", "cat", "orf", "nfa"];

/**
 * Fees under a hypothetical tariff. Orders = fills (default 2); shares per order = 2·qty / orders.
 * Commission per order = max(minPerOrder, perShare · sharesInOrder); ECN = ecnPerShare per share both ways.
 * Regulatory pass-through (SEC/TAF/CAT/ORF/NFA) is kept from the broker breakdown when requested and known.
 */
export function recomputeFees(t: SimTrade, plan: Extract<Rule, { type: "commissionPlan" }>): number | null {
  if (t.qty == null || t.qty <= 0) return null;
  const orders = Math.max(2, Math.round(t.fills ?? 2));
  const sharesPerOrder = (2 * t.qty) / orders;
  const commission = orders * Math.max(plan.minPerOrder, plan.perShare * sharesPerOrder);
  const ecn = plan.ecnPerShare * 2 * t.qty;
  let regulatory = 0;
  if (plan.keepRegulatory && t.feeBreakdown) {
    for (const k of REGULATORY_KEYS) regulatory += Math.abs(t.feeBreakdown[k] ?? 0);
  }
  return round2(commission + ecn + regulatory);
}

type DayState = {
  dayNet: number; count: number; lossRun: number; peakNet: number;
  stoppedBy: ExclusionReason | null; stopDetail: string;
  /** Close time (minutes since NY midnight) of the trader's last realised losing / winning trade of the day. */
  lastLossClose: number | null;
  lastWinClose: number | null;
  /** redZone: entries still allowed since the realised day first reached −usd (null = not in the zone yet). */
  zoneLeft: number | null;
  /** Kept entries per ticker today (maxTradesPerTicker). */
  perTicker: Map<string, number>;
  /** Close of the last realised losing trade per ticker today (noReentryAfterLoss). */
  tickerLossClose: Map<string, number>;
  /** Kept trades still open at the current entry, by close time: their result is not known yet. */
  open: { close: number; net: number; ticker: string }[];
};

const newDayState = (): DayState => ({
  dayNet: 0, count: 0, lossRun: 0, peakNet: 0, stoppedBy: null, stopDetail: "", lastLossClose: null, lastWinClose: null,
  zoneLeft: null, perTicker: new Map(), tickerLossClose: new Map(), open: [],
});

/** Close (minutes since NY midnight) of a trade with a known entry and hold; null ⇒ realised at once (old order). */
export function closeMinOf(t: { entryMin: number | null; holdSec: number | null }): number | null {
  return t.entryMin != null && t.holdSec != null ? t.entryMin + t.holdSec / 60 : null;
}

/** Puts an open trade into the list kept in close order (ties: entry order). */
function pushOpen(open: DayState["open"], o: DayState["open"][number]): void {
  let i = open.length;
  while (i > 0 && open[i - 1].close > o.close) i--;
  open.splice(i, 0, o);
}

export function buildPasses(input: Rule[], base: SimTrade[], T: WhatifT | null): Passes {
  const skipped: SkippedRule[] = [];
  const sk = (rule: RuleType, key: SkipKey) => skipped.push({ rule, reason: T ? T(`skip.${key}`) : key });
  const seen = new Set<RuleType>();
  for (const r of input) {
    if (seen.has(r.type)) sk(r.type, "duplicate");
    seen.add(r.type);
  }
  const rules = input.filter((r, i) => input.findIndex((x) => x.type === r.type) === i);
  const get = <K extends RuleType>(type: K) => rules.find((r): r is Extract<Rule, { type: K }> => r.type === type);
  const hit = (reason: ExclusionReason, text: (t: WhatifT) => string): Hit => ({ reason, detail: T ? text(T) : "" });

  /* 1. static filters */
  const tw = get("timeWindow");
  const twFrom = tw ? parseHm(tw.from) : null;
  const twTo = tw ? parseHm(tw.to) : null;
  if (tw && twFrom == null && twTo == null) sk("timeWindow", "noWindow");
  if (tw && (twFrom != null || twTo != null) && !base.some((t) => t.entryMin != null)) sk("timeWindow", "noEntryTime");
  const pr = get("priceRange");
  if (pr && pr.min == null && pr.max == null) sk("priceRange", "noPrice");
  const mh = get("minHold");
  if (mh && !base.some((t) => t.holdSec != null)) sk("minHold", "noHold");
  const et = get("excludeTickers");
  const etSet = new Set((et?.tickers ?? []).map((s) => s.trim().toUpperCase()).filter(Boolean));
  if (et && !etSet.size) sk("excludeTickers", "noTickers");
  const es = get("excludeSide");
  const sr = get("sizeRange");
  if (sr && sr.min == null && sr.max == null) sk("sizeRange", "noSize");
  if (sr && (sr.min != null || sr.max != null) && !base.some((t) => t.qty != null)) sk("sizeRange", "noQty");
  const xs = get("excludeSetups");
  const xsSet = new Set((xs?.setups ?? []).map((v) => v.trim().toLowerCase()).filter(Boolean));
  if (xs && !xsSet.size) sk("excludeSetups", "noSetups");
  else if (xs && !base.some((t) => t.setup)) sk("excludeSetups", "noSetupLabels");
  const mg = get("minGrade");
  const mgRank = mg ? gradeRank(mg.grade) : null;
  const mgActive = mg != null && mgRank != null && base.some((t) => gradeRank(t.grade) != null);
  if (mg && mgRank == null) sk("minGrade", "unknownGrade");
  else if (mg && !mgActive) sk("minGrade", "noGrades");
  const imx = get("excludeImx");
  const nre = get("noReentry");
  const rs = get("requireStop");
  // hasStop false = «no stop recorded» (lib/tradeFacetDerive hasStopOf), not «entered without one»: the rule means
  // something only where stops are recorded on a real share of the trades — ≥ 15%, the builder's gate.
  const rsActive = rs != null && base.length > 0 && base.filter((t) => t.hasStop === true).length >= STOP_COVERAGE * base.length;
  if (rs && !rsActive) sk("requireStop", "noStopData");
  const xm = get("excludeMistakes");
  const xmSet = new Set(xm?.codes ?? []);
  if (xm && !xmSet.size) sk("excludeMistakes", "noMistakes");
  else if (xm && !base.some((t) => t.mistakes?.length)) sk("excludeMistakes", "noMistakeLabels");
  const xt = get("excludeTags");
  const xtSet = new Set((xt?.tags ?? []).map((v) => v.trim().toLowerCase()).filter(Boolean));
  if (xt && !xtSet.size) sk("excludeTags", "noTags");
  else if (xt && !base.some((t) => t.ptags?.length)) sk("excludeTags", "noTagLabels");
  const bw = get("blockWindow");
  const bwFrom = bw ? parseHm(bw.from) : null;
  const bwTo = bw ? parseHm(bw.to) : null;
  const bwActive = bw != null && bwFrom != null && bwTo != null && bwTo > bwFrom && base.some((t) => t.entryMin != null);
  if (bw && (bwFrom == null || bwTo == null || bwTo <= bwFrom)) sk("blockWindow", "noWindow");
  else if (bw && !bwActive) sk("blockWindow", "noEntryTime");
  const xst = get("excludeStrategies");
  const xstSet = new Set((xst?.strategies ?? []).map((v) => v.trim().toLowerCase()).filter(Boolean));
  if (xst && !xstSet.size) sk("excludeStrategies", "noStrategies");
  else if (xst && !base.some((t) => t.strategy)) sk("excludeStrategies", "noStrategyLabels");
  const xe = get("excludeEarnings");
  // The calendar is read from the archive: without a single marked trade there is nothing to say (not «no reports»).
  const xeActive = xe != null && base.some((t) => t.earnings === true);
  if (xe && !xeActive) sk("excludeEarnings", "noEarnings");

  const anyStatic = tw || pr || mh || etSet.size || es || sr || xsSet.size || mgActive || imx || nre || rsActive || xmSet.size || xtSet.size
    || bwActive || xstSet.size || xeActive;
  const staticExclusion = anyStatic ? (t: SimTrade): Hit | null => {
    const em = t.entryMin;
    if (tw && em != null) {
      if (twFrom != null && em < twFrom) return hit("timeWindow", (T) => T("excl.entryBefore", { entry: fmtHm(em), from: fmtHm(twFrom) }));
      if (twTo != null && em >= twTo) return hit("timeWindow", (T) => T("excl.entryAfter", { entry: fmtHm(em), to: fmtHm(twTo) }));
    }
    const px = t.entry;
    if (pr && px != null) {
      if (pr.min != null && px < pr.min) { const min = pr.min; return hit("priceRange", (T) => T("excl.priceBelow", { price: px, min })); }
      if (pr.max != null && px > pr.max) { const max = pr.max; return hit("priceRange", (T) => T("excl.priceAbove", { price: px, max })); }
    }
    if (mh && t.holdSec != null && t.holdSec < mh.seconds) { const n = Math.round(t.holdSec); return hit("minHold", (T) => T("excl.hold", { n })); }
    if (etSet.size && etSet.has(t.ticker.toUpperCase())) return hit("excludeTickers", (T) => T("excl.ticker", { ticker: t.ticker }));
    if (es && t.side === es.side) return hit("excludeSide", (T) => (es.side === "long" ? T("excl.long") : T("excl.short")));
    const q = t.qty;
    if (sr && q != null) {
      if (sr.min != null && q < sr.min) { const min = sr.min; return hit("sizeRange", (T) => T("excl.sizeBelow", { qty: q, min })); }
      if (sr.max != null && q > sr.max) { const max = sr.max; return hit("sizeRange", (T) => T("excl.sizeAbove", { qty: q, max })); }
    }
    const setup = t.setup;
    if (xsSet.size && setup && xsSet.has(setup.trim().toLowerCase())) return hit("excludeSetups", (T) => T("excl.setup", { setup }));
    if (mgActive) {
      const g = gradeRank(t.grade);
      if (g == null) return hit("minGrade", (T) => T("excl.noGrade"));
      if (g > (mgRank as number)) return hit("minGrade", (T) => T("excl.grade", { grade: String(t.grade) }));
    }
    if (imx && t.imx === true) return hit("excludeImx", (T) => T("excl.imx"));
    if (nre && t.reentry === true) return hit("noReentry", (T) => T("excl.reentry"));
    if (rsActive && t.hasStop === false) return hit("requireStop", (T) => T("excl.noStop"));
    if (xmSet.size && t.mistakes?.length) {
      const code = t.mistakes.find((c) => xmSet.has(c));
      if (code) return hit("excludeMistakes", (T) => T("excl.mistake", { name: T(`mistake.${code}`) }));
    }
    if (xtSet.size && t.ptags?.length) {
      const tag = t.ptags.find((p) => xtSet.has(p.trim().toLowerCase()));
      if (tag) return hit("excludeTags", (T) => T("excl.tag", { tag }));
    }
    if (bwActive && em != null && em >= (bwFrom as number) && em < (bwTo as number)) {
      return hit("blockWindow", (T) => T("excl.blocked", { entry: fmtHm(em), from: fmtHm(bwFrom as number), to: fmtHm(bwTo as number) }));
    }
    const st = t.strategy;
    if (xstSet.size && st && xstSet.has(st.trim().toLowerCase())) return hit("excludeStrategies", (T) => T("excl.strategy", { strategy: st }));
    if (xeActive && t.earnings === true) return hit("excludeEarnings", (T) => T("excl.earnings"));
    return null;
  } : null;

  /* 2. money modifications */
  const plan = get("commissionPlan");
  const msr = get("maxSizeRel");
  if (msr && !base.some((t) => t.sizeRel != null)) sk("maxSizeRel", "noSizeRel");
  const cap = get("capLoss");
  const money = plan || msr || cap ? (input: SimTrade[], onChange: OnChange): SimTrade[] => {
    let kept = input;
    if (plan) {
      let applied = 0;
      kept = kept.map((t) => {
        const f = recomputeFees(t, plan);
        if (f == null) return t;
        applied++;
        const before = round2(Math.abs(t.fees));
        if (Math.abs(f - Math.abs(t.fees)) >= 0.005) {
          onChange({ id: t.id, day: t.day, ticker: t.ticker, reason: "commissionPlan", before, after: f, detail: T ? T("excl.fee", { before, after: f }) : "", estimate: false }, Math.abs(t.fees) - f, t);
        }
        return { ...t, fees: f };
      });
      if (!applied) sk("commissionPlan", "noQty");
    }
    if (msr) {
      kept = kept.map((t) => {
        const rel = t.sizeRel;
        if (rel == null || !(rel > msr.x) || t.gross == null) return t;
        const f = msr.x / rel;
        const before = netOf(t) as number;
        const gross = round2(t.gross * f), fees = round2(Math.abs(t.fees) * f);
        const after = gross - fees;
        onChange({
          id: t.id, day: t.day, ticker: t.ticker, reason: "maxSizeRel", before: round2(before), after: round2(after),
          detail: T ? T("excl.sizeScaled", { rel: Math.round(rel * 10) / 10, x: msr.x }) : "", estimate: true,
        }, after - before, t);
        return { ...t, gross, fees };
      });
    }
    if (cap) {
      kept = kept.map((t) => {
        const net = netOf(t);
        if (net == null || net >= -cap.usd) return t;
        // Keep the fees; lift the gross so that net = −cap.
        const newGross = round2(-cap.usd + Math.abs(t.fees));
        onChange({ id: t.id, day: t.day, ticker: t.ticker, reason: "capLoss", before: round2(net), after: -cap.usd, detail: T ? T("excl.capped", { loss: round2(net), cap: cap.usd }) : "", estimate: true }, newGross - Math.abs(t.fees) - net, t);
        return { ...t, gross: newGross };
      });
    }
    return kept;
  } : null;

  /* 3. sequential day rules, per trader-day */
  const dll = get("dailyLossLimit");
  const mtd = get("maxTradesPerDay");
  const sal = get("stopAfterLosses");
  const al = get("afterLoss");
  const dpt = get("dailyProfitTarget");
  const pg = get("profitGiveback");
  const aw = get("afterWin");
  const rzIn = get("redZone");
  const rz = rzIn && !(rzIn.floor != null && rzIn.floor <= rzIn.usd) ? rzIn : undefined;
  if (rzIn && !rz) sk("redZone", "badZone");
  const mtt = get("maxTradesPerTicker");
  const rel = get("noReentryAfterLoss");
  const hasTimes = base.some((t) => t.entryMin != null);
  if (al && !hasTimes) sk("afterLoss", "noEntryTime");
  if (aw && !hasTimes) sk("afterWin", "noEntryTime");
  if (rel && !hasTimes) sk("noReentryAfterLoss", "noEntryTime");
  /*
   * A kept trade counts for the day (net, loss run, peak, the stops) only once it has CLOSED: before deciding an entry,
   * the trader's kept trades that closed at or before it are realised, in close order. So a stop excludes only the
   * entries taken at or after the close that triggered it — never a trade entered while the trigger was still open
   * (that would be hindsight). A trade without an entry time or hold is realised at once (the old entry order).
   */
  const realise = (s: DayState, net: number, close: number | null, ticker: string) => {
    s.dayNet += net;
    if (s.dayNet > s.peakNet) s.peakNet = s.dayNet;
    if (net < 0) s.lossRun++; else if (net > 0) s.lossRun = 0;
    if (net < 0 && close != null) {
      s.lastLossClose = Math.max(s.lastLossClose ?? close, close);
      s.tickerLossClose.set(ticker, Math.max(s.tickerLossClose.get(ticker) ?? close, close));
    }
    if (net > 0 && close != null) s.lastWinClose = Math.max(s.lastWinClose ?? close, close);
    // The zone is sticky: once the realised day touched −usd, the k entries left do not come back with a recovery.
    if (rz && s.zoneLeft == null && s.dayNet <= -rz.usd + EPS) s.zoneLeft = rz.k;
    if (s.stoppedBy) return;
    if (rz?.floor != null && s.dayNet <= -rz.floor + EPS) { s.stoppedBy = "redZone"; s.stopDetail = T ? T("excl.redFloor", { floor: rz.floor }) : ""; }
    else if (dll && s.dayNet <= -dll.usd) { s.stoppedBy = "dailyLossLimit"; s.stopDetail = T ? T("excl.dayLimit", { day: round2(Math.abs(s.dayNet)), limit: dll.usd }) : ""; }
    else if (sal && s.lossRun >= sal.n) { s.stoppedBy = "stopAfterLosses"; s.stopDetail = T ? T("excl.lossRun", { n: sal.n }) : ""; }
    else if (dpt && s.dayNet >= dpt.usd - EPS) { s.stoppedBy = "dailyProfitTarget"; s.stopDetail = T ? T("excl.profitTarget", { usd: dpt.usd }) : ""; }
    else if (pg && s.peakNet >= pg.peak - EPS && s.dayNet <= s.peakNet * (1 - pg.pct / 100) + EPS) {
      s.stoppedBy = "profitGiveback";
      s.stopDetail = T ? T("excl.profitGiveback", { pct: pg.pct, peak: round2(s.peakNet) }) : "";
    }
  };
  /** Entry `em` falls inside [close, close + minutes) of a realised close. */
  const within = (em: number | null, close: number | null | undefined, minutes: number) => em != null && close != null && em >= close && em < close + minutes;
  const sequential = dll || mtd || sal || al || dpt || pg || aw || rz || mtt || rel ? (kept: SimTrade[], onExclude: OnExclude): SimTrade[] => {
    const out: SimTrade[] = [];
    const states = new Map<string, DayState>();
    let day = "";
    for (const t of kept) {
      if (t.day !== day) { day = t.day; states.clear(); }
      const key = t.trader ?? "";
      let s = states.get(key);
      if (!s) { s = newDayState(); states.set(key, s); }
      // Unknown entry time (sorted last in the day): everything before it counts as closed.
      const at = t.entryMin ?? Infinity;
      while (s.open.length && s.open[0].close <= at) { const o = s.open.shift()!; realise(s, o.net, o.close, o.ticker); }
      if (s.stoppedBy) { onExclude(t, s.stoppedBy, s.stopDetail); continue; }
      if (mtd && s.count >= mtd.n) {
        s.stoppedBy = "maxTradesPerDay";
        s.stopDetail = T ? T("excl.nthTrade", { n: mtd.n }) : "";
        onExclude(t, s.stoppedBy, s.stopDetail);
        continue;
      }
      if (rz && s.zoneLeft != null && s.zoneLeft <= 0) {
        onExclude(t, "redZone", T ? T("excl.redZone", { usd: rz.usd, k: rz.k }) : "");
        continue;
      }
      const em = t.entryMin;
      if (al && within(em, s.lastLossClose, al.minutes)) {
        onExclude(t, "afterLoss", T ? T("excl.afterLoss", { n: Math.max(0, Math.round((em as number) - (s.lastLossClose as number))) }) : "");
        continue;
      }
      if (aw && within(em, s.lastWinClose, aw.minutes)) {
        onExclude(t, "afterWin", T ? T("excl.afterWin", { n: Math.max(0, Math.round((em as number) - (s.lastWinClose as number))) }) : "");
        continue;
      }
      const tk = t.ticker.toUpperCase();
      if (mtt && (s.perTicker.get(tk) ?? 0) >= mtt.n) {
        onExclude(t, "maxTradesPerTicker", T ? T("excl.tickerCount", { n: mtt.n, ticker: t.ticker }) : "");
        continue;
      }
      if (rel && within(em, s.tickerLossClose.get(tk), rel.minutes)) {
        onExclude(t, "noReentryAfterLoss", T ? T("excl.reentryLoss", { n: Math.max(0, Math.round((em as number) - (s.tickerLossClose.get(tk) as number))), ticker: t.ticker }) : "");
        continue;
      }
      out.push(t);
      s.count++;
      s.perTicker.set(tk, (s.perTicker.get(tk) ?? 0) + 1);
      if (s.zoneLeft != null) s.zoneLeft--;
      const net = netOf(t) ?? 0;
      const close = closeMinOf(t);
      if (close != null) pushOpen(s.open, { close, net, ticker: tk });
      else realise(s, net, t.entryMin, tk);
    }
    return out;
  } : null;

  return { rules, skipped, staticExclusion, money, sequential };
}
