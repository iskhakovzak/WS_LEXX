/**
 * Capital allocation engine (pure): per trader raise / keep / cut of the daily loss limit (and buying power in the same
 * proportion), and the desk view of where the risk moves. The estimates come from lib/capital/edge.ts.
 *
 * The formula, in plain words:
 *   1. composite S (−1 … 1) = weighted mean of: edge score, regime score, discipline (0–100 → −1 … 1); weights are desk
 *      settings, a missing part drops out and the rest are renormalised.
 *   2. gates, in order (the first that fires decides): a junior (unless settings include juniors) / no tier / a tier
 *      proposal waiting / the ladder itself says promote or demote (the stage ladder goes first) / no daily limit →
 *      keep. Discipline below `disciplineCut` → cut by the full max step (needs no sample). Fewer than `minTrades`
 *      closed trades → keep. A proven negative edge or S ≤ −DECISION_BAND → cut. S ≥ DECISION_BAND → raise only when
 *      the edge is proven (80 % interval above zero) and discipline ≥ `disciplineGate`; otherwise keep.
 *   3. step = max step × min(1, |S| / FULL_STEP_AT), whole percent; a step below `minStepPct` is no change (no churn).
 *   4. hard band: floor = tier template × floorPctOfTier, cap = min(tier template × capPctOfTier, the next tier's
 *      template, the weekly loss limit). Buying power moves by the same ratio within the stage bounds (lib/people/stageLimits).
 *   5. desk cap: the total daily loss limit may grow by at most maxDeskGrowthPct (+ what the cuts free up); raises are
 *      scaled down proportionally when they would exceed it.
 *   6. expected $: Δ limit × the posterior $ per day per $ of limit (the regime estimate when there is one), with the
 *      posterior spread as the honest uncertainty; it assumes P&L scales with the limit.
 */
import { BP_MAX_JUNIOR, BP_MIN } from "../people/stageLimits";
import { Z80 } from "../stats";
import type { RegimeKey } from "../marketRegime/regimes";
import { capitalPriors, disciplineOf, edgeOf, rawR, rawU, regimeEdgeOf, type CapPriors, type Raw } from "./edge";
import type {
  CapPlanRow, CapReason, CapTier, CapTraderInput, CapitalSettings, DeskSummary, Direction, EdgeEstimate, GateCode,
  RegimeEstimate, DisciplineScore,
} from "./types";

/** |S| below this → keep; S at or beyond FULL_STEP_AT → the full max step. */
export const DECISION_BAND = 0.2;
export const FULL_STEP_AT = 0.5;
const DAILY_ROUND = 10;
const BP_ROUND = 1000;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const r2 = (x: number) => Math.round(x * 100) / 100;

/** The hard band of a tier's daily loss limit (null bounds without a tier template). */
export function tierBand(tierKey: string | null, tiers: readonly CapTier[], s: Pick<CapitalSettings, "floorPctOfTier" | "capPctOfTier">): { floor: number | null; cap: number | null } {
  const sorted = [...tiers].sort((a, b) => a.order - b.order);
  const i = sorted.findIndex((t) => t.key === tierKey);
  const t = i >= 0 ? sorted[i] : null;
  if (!t || t.dailyLossLimit == null || !(t.dailyLossLimit > 0)) return { floor: null, cap: null };
  const next = sorted[i + 1]?.dailyLossLimit ?? null;
  const own = (t.dailyLossLimit * s.capPctOfTier) / 100;
  const cap = next != null && next > t.dailyLossLimit ? Math.min(own, next) : own;
  return { floor: (t.dailyLossLimit * s.floorPctOfTier) / 100, cap };
}

/** Weighted mean of the known parts on −1 … 1 (null when no part with a positive weight is known). */
export function compositeOf(edge: EdgeEstimate, regime: RegimeEstimate | null, disc: DisciplineScore, w: CapitalSettings["weights"]): number | null {
  const parts: [number | null, number][] = [
    [edge.score, w.edge],
    [regime?.score ?? null, w.regime],
    [disc.score == null ? null : disc.score / 50 - 1, w.discipline],
  ];
  let sw = 0;
  let s = 0;
  for (const [v, wt] of parts) {
    if (v == null || !(wt > 0)) continue;
    sw += wt;
    s += wt * v;
  }
  return sw > 0 ? s / sw : null;
}

type Ctx = { settings: CapitalSettings; tiers: readonly CapTier[]; priors: CapPriors; regime: RegimeKey | null };

function baseReasons(edge: EdgeEstimate, regime: RegimeEstimate | null, disc: DisciplineScore, input: CapTraderInput): CapReason[] {
  const lim = input.dailyLossLimit ?? 0;
  const usd = (x: number) => r2(x * lim);
  const out: CapReason[] = [{
    code: "edge",
    r: edge.r ? { theta: r2(edge.r.theta), lo: r2(edge.r.lo80), hi: r2(edge.r.hi80), trades: edge.r.n } : null,
    usd: edge.u ? { theta: usd(edge.u.theta), lo: usd(edge.u.lo80), hi: usd(edge.u.hi80), days: edge.u.n } : null,
  }];
  if (regime) out.push({ code: "regime", regime: regime.regime, days: regime.days, usd: regime.u ? { theta: usd(regime.u.theta), lo: usd(regime.u.lo80), hi: usd(regime.u.hi80) } : null });
  else out.push({ code: "noRegime" });
  const d = input.discipline;
  out.push({
    code: "discipline", score: disc.score == null ? null : Math.round(disc.score), index: d.index == null ? null : Math.round(d.index),
    violations: d.violations, closedPct: d.tradedDays ? Math.round((100 * d.closedDays) / d.tradedDays) : null, stopDays: d.stopDays,
  });
  return out;
}

const roundDaily = (x: number) => Math.round(x / DAILY_ROUND) * DAILY_ROUND;
const roundBp = (x: number) => Math.round(x / BP_ROUND) * BP_ROUND;

/** Buying power moved by the limit ratio, within the stage bounds; unchanged when not set. */
export function scaledBp(bp: number | null, ratio: number, junior: boolean): number | null {
  if (bp == null || !(bp > 0)) return bp;
  const max = junior ? BP_MAX_JUNIOR : Number.POSITIVE_INFINITY;
  return clamp(roundBp(bp * ratio), Math.min(BP_MIN, bp), Math.max(max, bp));
}

/** Direction + target before the band: the gate that decided, or the signed step in %. */
function verdictOf(input: CapTraderInput, edge: EdgeEstimate, disc: DisciplineScore, S: number | null, s: CapitalSettings):
  { gate: GateCode; value?: number | null; limit?: number | null; action?: string; step?: number } {
  if (input.junior && !s.includeJuniors) return { gate: "junior" };
  if (!input.tierKey) return { gate: "noTier" };
  if (input.pendingTier) return { gate: "tierPending" };
  if (input.ladderAction === "promote" || input.ladderAction === "demote") return { gate: "ladder", action: input.ladderAction };
  if (input.dailyLossLimit == null || !(input.dailyLossLimit > 0)) return { gate: "noLimit" };
  if (disc.score != null && disc.score < s.disciplineCut) return { gate: "disciplineCut", value: Math.round(disc.score), limit: s.disciplineCut, step: -s.maxStepDownPct };
  if (edge.trades < s.minTrades) return { gate: "fewTrades", value: edge.trades, limit: s.minTrades };
  const strength = (x: number) => clamp(Math.abs(x) / FULL_STEP_AT, 0, 1);
  if (edge.negative || (S != null && S <= -DECISION_BAND)) {
    const step = Math.max(s.minStepPct, s.maxStepDownPct * strength(S ?? -FULL_STEP_AT));
    return { gate: edge.negative ? "negativeEdge" : "neutral", step: -Math.min(step, s.maxStepDownPct) };
  }
  if (S != null && S >= DECISION_BAND) {
    if (!edge.proven) return { gate: "notProven" };
    if (disc.score == null || disc.score < s.disciplineGate) return { gate: "disciplineBlock", value: disc.score == null ? null : Math.round(disc.score), limit: s.disciplineGate };
    return { gate: "neutral", step: s.maxStepUpPct * strength(S) };
  }
  return { gate: "neutral" };
}

/** One trader's row (before the desk cap). `raw` = the pre-computed R / $ samples (allocate shares them with the prior). */
export function decideTrader(input: CapTraderInput, ctx: Ctx, raw?: { r: Raw | null; u: Raw | null }): CapPlanRow {
  const s = ctx.settings;
  const lim = input.dailyLossLimit;
  const edge = edgeOf(input.days, lim, ctx.priors, input.trader, raw);
  const regime = regimeEdgeOf(input.days, ctx.regime, lim, edge.u, ctx.priors.tauU);
  const disc = disciplineOf(input.discipline);
  const S = compositeOf(edge, regime, disc, s.weights);
  const band = tierBand(input.tierKey, ctx.tiers, s);
  const row: CapPlanRow = {
    trader: input.trader, tierKey: input.tierKey, direction: "keep", stepPct: 0,
    current: { dailyLossLimit: lim, buyingPower: input.buyingPower },
    proposed: { dailyLossLimit: lim, buyingPower: input.buyingPower },
    band, composite: S == null ? null : r2(S), edge, regime, discipline: disc, expected: null,
    reasons: baseReasons(edge, regime, disc, input),
  };
  const v = verdictOf(input, edge, disc, S, s);
  const gate = (g: GateCode, extra: Omit<Extract<CapReason, { code: "gate" }>, "code" | "gate"> = {}) => row.reasons.push({ code: "gate", gate: g, ...extra });
  if (v.gate !== "neutral") gate(v.gate, { value: v.value, limit: v.limit, action: v.action });
  if (v.step == null || lim == null) return finalize(row);
  const stepPct = Math.round(v.step);
  if (Math.abs(stepPct) < s.minStepPct) { gate("smallStep", { value: Math.abs(stepPct), limit: s.minStepPct }); return finalize(row); }
  setTarget(row, input, stepPct > 0 ? "raise" : "cut", lim * (1 + stepPct / 100), ctx);
  return finalize(row);
}

/** Moves the row to `target` within the band; a change smaller than minStepPct after the band is no change. */
function setTarget(row: CapPlanRow, input: CapTraderInput, dir: Direction, target: number, ctx: Ctx): void {
  const s = ctx.settings;
  const cur = input.dailyLossLimit as number;
  let next = dir === "raise" ? Math.floor(target / DAILY_ROUND) * DAILY_ROUND : roundDaily(target);
  let bound: GateCode | null = null;
  if (dir === "raise") {
    const caps = [row.band.cap, input.weeklyLossLimit].filter((x): x is number => x != null && x > 0);
    const cap = caps.length ? Math.min(...caps) : null;
    if (cap != null && next > cap) { next = Math.floor(cap / DAILY_ROUND) * DAILY_ROUND; bound = "atCap"; }
  } else if (row.band.floor != null && next < row.band.floor) {
    next = Math.ceil(row.band.floor / DAILY_ROUND) * DAILY_ROUND;
    bound = "atFloor";
  }
  const pct = ((next - cur) / cur) * 100;
  const wrongWay = dir === "raise" ? next <= cur : next >= cur;
  if (wrongWay || Math.abs(pct) < s.minStepPct) {
    row.direction = "keep";
    row.stepPct = 0;
    row.proposed = { ...row.current };
    row.expected = null;
    row.reasons.push(bound ? { code: "gate", gate: bound, limit: dir === "raise" ? row.band.cap : row.band.floor } : { code: "gate", gate: "smallStep", value: Math.abs(Math.round(pct)), limit: s.minStepPct });
    return;
  }
  if (bound) row.reasons.push({ code: "gate", gate: bound, limit: next });
  row.direction = dir;
  row.stepPct = Math.round(pct);
  row.proposed = { dailyLossLimit: next, buyingPower: scaledBp(input.buyingPower, next / cur, input.junior) };
  const est = row.regime?.u ?? row.edge.u;
  const delta = next - cur;
  row.expected = est ? { perDay: r2(est.theta * delta), sdPerDay: r2(est.sd * Math.abs(delta)) } : null;
}

function finalize(row: CapPlanRow): CapPlanRow {
  row.reasons = row.reasons.filter((r) => r.code !== "verdict");
  row.reasons.push({
    code: "verdict", direction: row.direction, pct: row.stepPct,
    fromDaily: row.current.dailyLossLimit, toDaily: row.proposed.dailyLossLimit,
    fromBp: row.current.buyingPower, toBp: row.proposed.buyingPower,
  });
  return row;
}

/** Scales the raises down so the desk's total daily loss limit grows by at most maxDeskGrowthPct (+ what cuts free). */
export function applyDeskCap(rows: CapPlanRow[], inputs: ReadonlyMap<string, CapTraderInput>, ctx: Ctx): boolean {
  const before = rows.reduce((s, r) => s + (r.current.dailyLossLimit ?? 0), 0);
  const delta = (r: CapPlanRow) => (r.proposed.dailyLossLimit ?? 0) - (r.current.dailyLossLimit ?? 0);
  const raises = rows.filter((r) => r.direction === "raise");
  const up = raises.reduce((s, r) => s + delta(r), 0);
  const freed = rows.filter((r) => r.direction === "cut").reduce((s, r) => s - delta(r), 0);
  const allowed = (before * ctx.settings.maxDeskGrowthPct) / 100 + freed;
  if (!(up > allowed) || up <= 0) return false;
  const f = Math.max(0, allowed / up);
  for (const r of raises) {
    const input = inputs.get(r.trader);
    if (!input || r.current.dailyLossLimit == null) continue;
    const cur = r.current.dailyLossLimit;
    r.reasons = r.reasons.filter((x) => !(x.code === "gate" && x.gate === "atCap"));
    r.reasons.push({ code: "gate", gate: "deskCap", limit: ctx.settings.maxDeskGrowthPct });
    setTarget(r, input, "raise", cur + delta(r) * f, ctx);
    finalize(r);
  }
  return true;
}

const ORDER: Record<Direction, number> = { raise: 0, cut: 1, keep: 2 };

export function deskSummary(rows: readonly CapPlanRow[], deskCapApplied: boolean): DeskSummary {
  let riskBefore = 0, riskAfter = 0, bpBefore = 0, bpAfter = 0, mean = 0, variance = 0;
  const from: { trader: string; delta: number }[] = [];
  const to: { trader: string; delta: number }[] = [];
  for (const r of rows) {
    riskBefore += r.current.dailyLossLimit ?? 0;
    riskAfter += r.proposed.dailyLossLimit ?? 0;
    bpBefore += r.current.buyingPower ?? 0;
    bpAfter += r.proposed.buyingPower ?? 0;
    const d = (r.proposed.dailyLossLimit ?? 0) - (r.current.dailyLossLimit ?? 0);
    if (r.direction === "raise") to.push({ trader: r.trader, delta: d });
    if (r.direction === "cut") from.push({ trader: r.trader, delta: d });
    if (r.expected) { mean += r.expected.perDay; variance += r.expected.sdPerDay ** 2; }
  }
  const half = Z80 * Math.sqrt(variance);
  const day = { mean: r2(mean), lo: r2(mean - half), hi: r2(mean + half) };
  return {
    traders: rows.length, riskBefore: r2(riskBefore), riskAfter: r2(riskAfter), bpBefore: r2(bpBefore), bpAfter: r2(bpAfter),
    raised: { count: to.length, usd: r2(to.reduce((s, x) => s + x.delta, 0)) },
    cut: { count: from.length, usd: r2(from.reduce((s, x) => s - x.delta, 0)) },
    from: from.sort((a, b) => a.delta - b.delta),
    to: to.sort((a, b) => b.delta - a.delta),
    expectedPerDay: day,
    // The uncertainty is about the edge itself (the same every day), so a week is 5 × the day, not √5.
    expectedPerWeek: { mean: r2(day.mean * 5), lo: r2(day.lo * 5), hi: r2(day.hi * 5) },
    deskCapApplied,
  };
}

/** The whole desk: priors from everyone's samples, a row per trader, the desk cap, the summary. */
export function allocate(inputs: readonly CapTraderInput[], ctx: Omit<Ctx, "priors">): { rows: CapPlanRow[]; desk: DeskSummary; priors: CapPriors } {
  const raws = inputs.map((i) => ({ r: rawR(i.days, i.trader), u: rawU(i.days, i.dailyLossLimit, i.trader) }));
  const priors = capitalPriors(raws, ctx.settings.minTrades);
  const full: Ctx = { ...ctx, priors };
  const rows = inputs.map((i, k) => decideTrader(i, full, raws[k]));
  const capped = applyDeskCap(rows, new Map(inputs.map((i) => [i.trader, i])), full);
  rows.sort((a, b) => ORDER[a.direction] - ORDER[b.direction] || Math.abs(b.stepPct) - Math.abs(a.stepPct) || a.trader.localeCompare(b.trader));
  return { rows, desk: deskSummary(rows, capped), priors };
}
