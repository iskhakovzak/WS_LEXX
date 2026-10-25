/**
 * Staff-only generators (pure): curator attention / load and the readiness pipeline. Facts, not estimates — so no
 * multiple testing; the ticks say how clear-cut the fact is.
 *
 * curatorAttention:
 *   noReview   active traders (a closed trade in the last 20 weekdays) without any curator review (day / week / trade
 *              review or a weekly rating) for > REVIEW_STALE_DAYS calendar days (or never);
 *   noOneOnOne active traders without a 1:1 for > ONE_ON_ONE_DAYS (the cabinet's OLGA-18 threshold) or never;
 *   load       curators with more than CURATOR_MAX_WARDS active wards, or ≥ 2× the median load (and ≥ 10 wards).
 *   Each needs ≥ ATTENTION_MIN traders (or one overloaded curator) to show.
 *
 * readinessPipeline:
 *   ready      every counted criterion of the stage passes (not promoted yet);
 *   close      exactly one criterion left (≥ 2 counted); the most common blocking criterion (the readiness report's
 *              binding constraint) is named with how many it holds back.
 */
import { addDays } from "../tradingDate";
import { round, type RawRec } from "./types";

export const REVIEW_STALE_DAYS = 14;
export const ONE_ON_ONE_DAYS = 30;
export const CURATOR_MAX_WARDS = 25;
export const ATTENTION_MIN = 2;

export type AttentionInput = {
  today: string;
  /** Active traders (role trader, traded recently). */
  active: readonly string[];
  /** trader → last curator review (YYYY-MM-DD) / last 1:1; absent = never. */
  lastReview: ReadonlyMap<string, string>;
  lastOneOnOne: ReadonlyMap<string, string>;
  /** trader → assigned curator (null = none). */
  curatorOf: ReadonlyMap<string, string | null>;
};

const daysSince = (from: string | undefined, today: string): number | null =>
  from ? Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${from.slice(0, 10)}T12:00:00Z`)) / 86_400_000) : null;

function staleList(active: readonly string[], last: ReadonlyMap<string, string>, today: string, maxDays: number) {
  return active
    .map((name) => ({ name, d: daysSince(last.get(name), today) }))
    .filter((x) => x.d == null || x.d > maxDays)
    .sort((a, b) => (b.d ?? 1e9) - (a.d ?? 1e9) || a.name.localeCompare(b.name));
}

export function curatorAttention(x: AttentionInput, period: { from: string; to: string }): RawRec[] {
  const out: RawRec[] = [];
  const n = x.active.length;
  if (!n) return out;
  const base = (kind: string, count: number, names: string[], params: RawRec["params"], priority: number, confidence: 1 | 2 | 3, href = "/curator"): RawRec => ({
    id: `attention:${kind}`, kind: "attention", audience: "staff", priority, confidence,
    params: { sub: kind, active: n, ...params },
    money: null,
    rel: { mean: round(count / n, 4), lo: round(count / n, 4), hi: round(count / n, 4), unit: "share" },
    affected: { count, names },
    action: { kind: "curator", href }, secondary: null,
    basis: { trades: 0, days: 0, traders: n, from: period.from, to: period.to, q: null },
  });
  const noReview = staleList(x.active, x.lastReview, x.today, REVIEW_STALE_DAYS);
  if (noReview.length >= ATTENTION_MIN) {
    const never = noReview.filter((r) => r.d == null).length;
    out.push(base("noReview", noReview.length, noReview.map((r) => r.name), { days: REVIEW_STALE_DAYS, never }, 30 + noReview.length, noReview.length / n >= 0.25 ? 3 : 2));
  }
  const noMeet = staleList(x.active, x.lastOneOnOne, x.today, ONE_ON_ONE_DAYS);
  if (noMeet.length >= ATTENTION_MIN) {
    const never = noMeet.filter((r) => r.d == null).length;
    out.push(base("noOneOnOne", noMeet.length, noMeet.map((r) => r.name), { days: ONE_ON_ONE_DAYS, never }, 20 + noMeet.length, noMeet.length / n >= 0.25 ? 3 : 2));
  }
  // Load per curator (active wards only); traders without a curator are a finding of their own.
  const load = new Map<string, number>();
  const orphans: string[] = [];
  for (const t of x.active) {
    const c = x.curatorOf.get(t);
    if (c) load.set(c, (load.get(c) ?? 0) + 1); else orphans.push(t);
  }
  const loads = [...load.values()].sort((a, b) => a - b);
  const med = loads.length ? loads[loads.length >> 1] : 0;
  const over = [...load.entries()].filter(([, k]) => k > CURATOR_MAX_WARDS || (loads.length >= 3 && k >= 2 * med && k >= 10)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (over.length) {
    out.push(base("load", over.length, over.map(([c]) => c), { maxWards: over[0][1], medianWards: med, limit: CURATOR_MAX_WARDS, curators: load.size }, 25 + over[0][1] - med, 3, "/admin"));
  }
  if (orphans.length >= ATTENTION_MIN) {
    out.push(base("noCurator", orphans.length, orphans.sort((a, b) => a.localeCompare(b)), {}, 28 + orphans.length, 3, "/admin"));
  }
  return out.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id)).slice(0, 3);
}

export type ReadinessRow = {
  user: string;
  stage: string | null;
  nextStage: string | null;
  passed: number;
  total: number;
  ready: boolean;
  /** Metric key of the binding constraint (the one criterion to work on). */
  binding: string | null;
};

export function readinessPipeline(rows: readonly ReadinessRow[], period: { from: string; to: string }): RawRec[] {
  const withNext = rows.filter((r) => r.nextStage && r.total > 0);
  if (!withNext.length) return [];
  const out: RawRec[] = [];
  const ready = withNext.filter((r) => r.ready).map((r) => r.user).sort((a, b) => a.localeCompare(b));
  const pathHref = (u: string | undefined) => (u ? `/academy/path?user=${encodeURIComponent(u)}` : "/academy/path");
  const meta = (count: number): Pick<RawRec, "money" | "secondary" | "basis"> & { rel: RawRec["rel"] } => ({
    money: null, secondary: null,
    rel: { mean: round(count / withNext.length, 4), lo: round(count / withNext.length, 4), hi: round(count / withNext.length, 4), unit: "share" },
    basis: { trades: 0, days: 0, traders: withNext.length, from: period.from, to: period.to, q: null },
  });
  if (ready.length) {
    out.push({
      id: "readiness:ready", kind: "readiness", audience: "staff", priority: 40 + ready.length, confidence: 3,
      params: { sub: "ready", tracked: withNext.length }, affected: { count: ready.length, names: ready },
      action: { kind: "academy", href: pathHref(ready.length === 1 ? ready[0] : undefined) }, ...meta(ready.length),
    });
  }
  const close = withNext.filter((r) => !r.ready && r.total >= 2 && r.passed === r.total - 1);
  if (close.length >= 2 || (close.length === 1 && !ready.length)) {
    const by = new Map<string, number>();
    for (const r of close) if (r.binding) by.set(r.binding, (by.get(r.binding) ?? 0) + 1);
    const top = [...by.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? null;
    out.push({
      id: "readiness:close", kind: "readiness", audience: "staff", priority: 35 + close.length, confidence: close.length >= 3 ? 3 : 2,
      params: { sub: "close", tracked: withNext.length, blocker: top?.[0] ?? null, blockerCount: top?.[1] ?? 0 },
      affected: { count: close.length, names: close.map((r) => r.user).sort((a, b) => a.localeCompare(b)) },
      action: { kind: "academy", href: pathHref(close.length === 1 ? close[0].user : undefined) }, ...meta(close.length),
    });
  }
  return out;
}

/** The window start for «active»: 20 weekdays back (holidays not excluded). */
export function activeSince(today: string): string {
  let d = today, k = 0;
  while (k < 20) { d = addDays(d, -1); const wd = new Date(`${d}T12:00:00Z`).getUTCDay(); if (wd !== 0 && wd !== 6) k++; }
  return d;
}
