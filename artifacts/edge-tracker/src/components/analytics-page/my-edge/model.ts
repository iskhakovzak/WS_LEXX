/**
 * «Мой edge и рынок» — pure helpers: labels of dimensions / buckets, the verdict picks, the «Сделки» link (the exact
 * trades of a row in /trades) and the «Проверить в Что если» rule of a leak. Unit-tested in model.test.ts.
 */
import type { Rule } from "@/components/shared/what-if-rules";
import { fmtUsd } from "@/lib/format";
import { myEdgeI18n } from "@/i18n/ns/myEdge";
import type { AnalyticsFilters } from "../metrics";
import type { CompareRow, MeRow } from "./api";

/** Bucket vocabulary of each dimension (dims sharing one: SPY / QQQ trend, gap, vol). */
const BUCKET_GROUP: Record<string, string> = {
  time: "time", seq: "seq", prev: "prev", dayPnl: "dayPnl", price: "price", familiarity: "familiarity", side: "side",
  sizeRel: "sizeRel", hold: "hold", setup: "setup",
  spyTrend: "trend", qqqTrend: "trend", spyGap: "gap", qqqGap: "gap", spyVol: "vol", spyPrevVol: "vol",
  tkGap: "tkGap", tkAtr: "tkAtr", tkRvol: "tkRvol", earnings: "earnings", analyst: "analyst", theme: "theme",
};
/** Dimensions whose keys are free text (a strategy, a setup, a sector, a theme name): the label names the dimension. */
const RAW_DIMS: ReadonlySet<string> = new Set(["strategy", "setup", "sector", "theme"]);

/** Signed $ — whole dollars from $100, cents below. */
export const money = (v: number | null | undefined): string => fmtUsd(v, { signed: true, decimals: Math.abs(v ?? 0) >= 100 ? 0 : 2 });

export const dimLabel = (dim: string): string => myEdgeI18n.tryT(`dim.${dim}`) ?? dim;

export function bucketLabel(dim: string, key: string): string {
  const g = BUCKET_GROUP[dim];
  return (g && myEdgeI18n.tryT(`bucket.${g}.${key}`)) || key;
}

/** «3-я сделка» / «Стратегия: Momentum» — the row's name inside a verdict sentence. */
export function rowName(r: Pick<MeRow, "dim" | "key">): string {
  const b = bucketLabel(r.dim, r.key);
  return RAW_DIMS.has(r.dim) && b === r.key ? `${dimLabel(r.dim)}: ${b}` : b;
}

/** The exact trades of a row in /trades (ids are already the filtered + «Разрезы» set); staff keep the person. */
export function tradesHref(r: Pick<MeRow, "ids">, filters: Pick<AnalyticsFilters, "trader">): string | null {
  if (!r.ids.length) return null;
  const sp = new URLSearchParams();
  sp.set("ids", r.ids.join(","));
  sp.set("view", "list");
  if (filters.trader) sp.set("trader", filters.trader);
  return `/trades?${sp.toString()}`;
}

const TIME_FROM: Record<string, string> = { "before-8:30": "08:30", "8:30-9:30": "09:30", "9:30-9:50": "09:50", "9:50-10:10": "10:10" };
const TIME_TO: Record<string, string> = { "13:30-15:30": "13:30", "15:30-16:00": "15:30", "after-16:00": "16:00" };
const SEQ_MAX: Record<string, number> = { "2": 1, "3": 2, "4-5": 3, "6+": 5 };

/**
 * The /what-if rule that removes a LEAK (point $ / day < 0), or null when the bucket has no faithful rule (a middle
 * time / price band, a strategy, a familiarity band) or the row is an outcome / a strength.
 */
export function whatIfRule(r: Pick<MeRow, "dim" | "key" | "outcome" | "perDay">, typicalDay: number | null): Rule | null {
  if (r.outcome || r.perDay.point >= 0) return null;
  const D = typicalDay && typicalDay > 0 ? typicalDay : null;
  const round = (v: number) => Math.max(1, Math.round(v));
  switch (r.dim) {
    case "time":
      if (TIME_FROM[r.key]) return { type: "timeWindow", from: TIME_FROM[r.key], to: null };
      if (TIME_TO[r.key]) return { type: "timeWindow", from: null, to: TIME_TO[r.key] };
      return null;
    case "seq": return SEQ_MAX[r.key] ? { type: "maxTradesPerDay", n: SEQ_MAX[r.key]! } : null;
    case "prev": return r.key === "after-loss" ? { type: "afterLoss", minutes: 15 } : null;
    case "dayPnl":
      if (!D) return null;
      if (r.key === "deepDown") return { type: "dailyLossLimit", usd: round(D) };
      if (r.key === "down") return { type: "dailyLossLimit", usd: round(D * 0.2) };
      if (r.key === "bigUp") return { type: "dailyProfitTarget", usd: round(D) };
      if (r.key === "up") return { type: "dailyProfitTarget", usd: round(D * 0.2) };
      return null;
    case "price":
      if (r.key === "lt5") return { type: "priceRange", min: 5, max: null };
      if (r.key === "gt200") return { type: "priceRange", min: null, max: 200 };
      return null;
    case "setup": return r.key && r.key !== "none" ? { type: "excludeSetups", setups: [r.key] } : null;
    case "side": return r.key === "long" || r.key === "short" ? { type: "excludeSide", side: r.key } : null;
    case "sizeRel": return r.key === "x2" || r.key === "x3" ? { type: "maxSizeRel", x: 1.5 } : null;
    default: return null;
  }
}

/** Best and worst usable buckets of one dimension (status ≠ «мало данных»); null below two of them. */
export function bestWorst(rows: readonly MeRow[], dim: string): { best: MeRow; worst: MeRow } | null {
  const list = rows.filter((r) => r.dim === dim && r.status !== "low").sort((a, b) => b.perDay.point - a.perDay.point);
  return list.length >= 2 ? { best: list[0]!, worst: list[list.length - 1]! } : null;
}

/** Changed metrics, in display order. */
export const changedRows = (rows: readonly CompareRow[]): CompareRow[] => rows.filter((r) => r.changed && r.diff);

/** Coverage share 0…1 (null without trades). */
export const coverageShare = (c: { known: number; total: number } | null | undefined): number | null => (c && c.total ? c.known / c.total : null);

/** A common symmetric-free scale of a set of intervals for the inline range bars: [min(lo, 0), max(hi, 0)]. */
export function scaleOf(rows: readonly { perDay: { lo: number; hi: number } }[]): { min: number; max: number } {
  let min = 0;
  let max = 0;
  for (const r of rows) { min = Math.min(min, r.perDay.lo); max = Math.max(max, r.perDay.hi); }
  if (min === max) return { min: -1, max: 1 };
  return { min, max };
}

/** Position 0…100 % of `v` on a scale. */
export const pctOn = (v: number, s: { min: number; max: number }): number => Math.min(100, Math.max(0, ((v - s.min) / (s.max - s.min)) * 100));
