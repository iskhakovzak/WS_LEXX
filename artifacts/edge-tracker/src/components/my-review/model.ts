/**
 * «Мой разбор» — pure view model (unit-tested in __tests__/model.test.ts): labels of the buckets, the totals line, where
 * each row links (connectedness: a setup / a ticker opens its trades of the period, a pattern opens /behavior), and the
 * page state.
 */
import { fmtPct, fmtR, fmtRate, fmtUsd } from "@/lib/format";
import { links } from "@/lib/links";
import { addDays } from "@/lib/trading-date";
import { displayTicker } from "@/lib/option-symbol";
import { commonI18n } from "@/i18n/ns/common";
import { myReviewI18n } from "@/i18n/ns/myReview";
import type { MyReview, ReviewBucket, ReviewDimension } from "./api";

export const PERIODS = [30, 90] as const;
export type Period = (typeof PERIODS)[number];
export const isPeriod = (v: unknown): v is Period => v === 30 || v === 90;

export const DIMENSIONS: readonly ReviewDimension[] = ["setup", "ticker", "hour"];

/** «09» → «09:00–10:00»; a ticker → its display form; a setup → as named. */
export function bucketLabel(dim: ReviewDimension, key: string): string {
  if (dim === "hour") {
    const h = Number(key);
    if (!Number.isInteger(h)) return key;
    const pad = (n: number) => `${String(n % 24).padStart(2, "0")}:00`;
    return myReviewI18n.t("hour", { from: pad(h), to: pad(h + 1) });
  }
  return dim === "ticker" ? displayTicker(key) : key;
}

/** Where a row opens: the period's trades of that setup / ticker; hours have no trade filter → null. */
export function bucketHref(dim: ReviewDimension, key: string, r: Pick<MyReview, "from" | "to">): string | null {
  if (dim === "setup") return links.trades({ setup: key, from: r.from, to: r.to });
  if (dim === "ticker") return links.trades({ ticker: key, from: r.from, to: r.to });
  return null;
}

/** «+$420 · +3.5R» — net first, R only when known. */
export function bucketValue(b: Pick<ReviewBucket, "net" | "r">): string {
  const net = fmtUsd(b.net, { signed: true, decimals: "auto" });
  return b.r != null ? `${net} · ${fmtR(b.r, 1)}` : net;
}

/** «41 сделка · +$830 · +3.5R · 60% побед» (R left out when unknown — broker trades rarely carry it). */
export function totalsLine(t: MyReview["totals"]): string {
  const p = {
    trades: commonI18n.t("units.trades", { count: t.trades }),
    net: fmtUsd(t.net, { signed: true, decimals: "auto" }),
    winRate: fmtRate(t.winRate),
  };
  return t.r != null ? myReviewI18n.t("totalsR", { ...p, r: fmtR(t.r, 1) }) : myReviewI18n.t("totals", p);
}

/** The page body: nothing traded → «empty»; else the three answers. */
export function reviewState(r: MyReview | undefined): "loading" | "empty" | "ready" {
  if (!r) return "loading";
  return r.totals.trades > 0 ? "ready" : "empty";
}

/** Rows of one answer, in dimension order, only the dimensions that have rows (pure). */
export function sectionsOf(map: Record<ReviewDimension, ReviewBucket[]>): { dim: ReviewDimension; rows: ReviewBucket[] }[] {
  return DIMENSIONS.map((dim) => ({ dim, rows: map[dim] ?? [] })).filter((s) => s.rows.length > 0);
}

/** Money of a pattern, e.g. «−$241». */
export const costText = (v: number): string => fmtUsd(v, { signed: true, decimals: "auto" });

/** Win share for a row hint (0..1 → «67%»); «—» when nothing was decided. */
export const winText = (v: number | null): string => (v == null ? "—" : fmtPct(v * 100, { decimals: 0, signed: false }));

/** The weekday after `date` — «план на завтра» is the plan of that day. */
export function nextPlanDate(date: string): string {
  let d = addDays(date, 1);
  for (let i = 0; i < 3 && [0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay()); i++) d = addDays(d, 1);
  return d;
}
