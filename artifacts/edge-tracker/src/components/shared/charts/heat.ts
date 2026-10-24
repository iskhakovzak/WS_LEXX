/**
 * Heat colours for P&L grids (calendars, weekday × hour tables). One diverging scale: loss hue ← neutral → profit
 * hue, intensity = |value| relative to the period's largest |value| on a square-root curve (small days stay visible,
 * one outlier doesn't wash the rest out). Colours are the theme tokens, so a new palette flows in.
 *
 * Three states are kept apart on purpose:
 *   · no trades  — no fill, dashed hairline ("empty");
 *   · break-even — neutral grey fill (traded, result 0 or no value);
 *   · profit / loss — the hue at its intensity.
 * The «Вид» break-even range (lib/appearance/be-range) is honoured for P&L: a day within ±range reads as
 * break-even (colour only, never the numbers).
 */
import { classifyPnl } from "@/lib/appearance/be-range";
import { tint } from "./theme";

export type HeatKind = "empty" | "flat" | "be" | "up" | "down";

/** Alpha range of the fill: the faintest non-zero day … the period's largest day. */
export const HEAT_MIN = 0.14;
export const HEAT_MAX = 0.62;
/** Break-even fill. */
export const HEAT_FLAT = tint("muted-foreground", 0.16);
/** Fill of a day inside the «Вид» break-even range (the person's break-even colour). */
export const HEAT_BE = tint("be", 0.2);

export function heatKind(value: number | null | undefined, traded: boolean): HeatKind {
  if (!traded) return "empty";
  if (value == null || !Number.isFinite(value) || value === 0) return "flat";
  if (classifyPnl(value) === "be") return "be";
  return value > 0 ? "up" : "down";
}

/** 0…1 intensity of |value| against the period max (sqrt curve). */
export function heatLevel(value: number | null | undefined, max: number): number {
  if (value == null || !Number.isFinite(value) || value === 0 || !(max > 0)) return 0;
  return Math.sqrt(Math.min(1, Math.abs(value) / max));
}

/** Fill of a profit / loss cell (undefined for zero / missing — the caller decides between empty and break-even). */
export function heatFill(value: number | null | undefined, max: number, hue: "pnl" | "accent" = "pnl"): string | undefined {
  const k = heatLevel(value, max);
  if (k === 0) return undefined;
  if (hue === "pnl" && classifyPnl(value) === "be") return HEAT_BE;
  const a = Number((HEAT_MIN + (HEAT_MAX - HEAT_MIN) * k).toFixed(2));
  if (hue === "accent") return tint("primary", a);
  return tint((value as number) > 0 ? "up" : "down", a);
}

/** Legend ramp steps (light → strong) for one hue. */
export function heatRamp(hue: "up" | "down" | "primary", steps = 4): string[] {
  return Array.from({ length: steps }, (_, i) => {
    const k = Math.sqrt((i + 1) / steps);
    return tint(hue, Number((HEAT_MIN + (HEAT_MAX - HEAT_MIN) * k).toFixed(2)));
  });
}
