import type { CSSProperties } from "react";
import type { MetricDef, MetricUnit } from "./api";

const nf0 = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Signed dollars: +$1 234,5 / −$80 / —. */
export function fmtUsd(v: number | null | undefined, signed = true): string {
  if (!isNum(v)) return "—";
  const sign = signed ? (v > 0 ? "+" : v < 0 ? "−" : "") : v < 0 ? "−" : "";
  const abs = Math.abs(v);
  return `${sign}$${abs >= 1000 ? nf0.format(abs) : nf2.format(abs)}`;
}

export function fmtPct(v: number | null | undefined, digits = 0): string {
  if (!isNum(v)) return "—";
  return `${(v * 100).toFixed(digits).replace(".", ",")}%`;
}

export function fmtNum(v: number | null | undefined, digits = 2): string {
  if (!isNum(v)) return "—";
  return v.toFixed(digits).replace(".", ",");
}

export function fmtR(v: number | null | undefined): string {
  if (!isNum(v)) return "—";
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2).replace(".", ",")}R`;
}

/** 75 → «1 ч 15 мин», 4.5 → «4,5 мин», 0.4 → «24 с». */
export function fmtMinutes(v: number | null | undefined): string {
  if (!isNum(v)) return "—";
  if (v < 1) return `${Math.round(v * 60)} с`;
  if (v < 60) return `${v < 10 ? fmtNum(v, 1) : Math.round(v)} мин`;
  const h = Math.floor(v / 60);
  const m = Math.round(v - h * 60);
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}

/** NY minutes since midnight → «09:31». */
export function fmtClock(min: number | null | undefined): string {
  if (!isNum(min)) return "—";
  const h = Math.floor(min / 60);
  const m = Math.floor(min % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function fmtPrice(v: number | null | undefined): string {
  if (!isNum(v)) return "—";
  return v >= 10 ? v.toFixed(2) : v.toFixed(v >= 1 ? 3 : 4);
}

/** 2026-04-09 → «09.04.26». */
export function fmtDay(ymd: string | null | undefined): string {
  if (!ymd) return "—";
  const [y, m, d] = ymd.split("-");
  return `${d}.${m}.${y.slice(2)}`;
}

export function fmtByUnit(unit: MetricUnit, v: number | null | undefined): string {
  switch (unit) {
    case "usd": return fmtUsd(v);
    case "pct": return fmtPct(v);
    case "ratio": return fmtNum(v);
    case "count": return isNum(v) ? (Number.isInteger(v) ? String(v) : fmtNum(v, 1)) : "—";
    case "min": return fmtMinutes(v);
    case "days": return isNum(v) ? `${v} дн` : "—";
    case "r": return fmtR(v);
  }
}

export function fmtMetric(def: Pick<MetricDef, "unit" | "key">, v: number | null | undefined): string {
  // Drawdown and volatility are depths — no sign.
  if (def.key === "maxDd" || def.key === "dailyVol") return isNum(v) ? fmtUsd(v, false) : "—";
  return fmtByUnit(def.unit, v);
}

/**
 * Heatmap cell colour for a desk percentile (1 = best): red → neutral → green, as an inline style using the theme tokens.
 * Neutral (style) metrics use the accent hue instead of good/bad colours.
 */
export function heatStyle(p: number | null | undefined, neutral = false): CSSProperties {
  if (!isNum(p)) return {};
  if (neutral) return { backgroundColor: `hsl(var(--chart-1) / ${(0.06 + p * 0.3).toFixed(3)})` };
  const d = p - 0.5;
  const a = (Math.abs(d) * 2 * 0.42 + 0.04).toFixed(3);
  return { backgroundColor: d >= 0 ? `hsl(var(--up) / ${a})` : `hsl(var(--down) / ${a})` };
}

/** Stable per-trader colour for lines (chart tokens). */
export const SERIES_COLORS = ["hsl(var(--chart-1))", "hsl(var(--chart-5))", "hsl(var(--chart-3))", "hsl(var(--chart-2))", "hsl(var(--chart-4))"];
