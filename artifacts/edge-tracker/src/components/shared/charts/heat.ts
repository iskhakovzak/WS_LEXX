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
import type { CSSProperties } from "react";
import { tint } from "./theme";

export type HeatKind = "empty" | "flat" | "be" | "up" | "down";

/** Alpha range of the fill: the faintest non-zero day … the period's largest day. */
export const HEAT_MIN = 0.16;
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

/** The same token tint at `k` × its alpha (the soft top of a cell's gradient, its hairline edge); other fills unchanged. */
export function heatAlpha(fill: string, k: number): string {
  const m = /^hsl\(var\((--[\w-]+)\) \/ ([\d.]+)\)$/.exec(fill);
  return m ? `hsl(var(${m[1]}) / ${Number((Number(m[2]) * k).toFixed(3))})` : fill;
}

/**
 * Cell paint of a tinted day: a soft vertical gradient (full tint at the bottom, lighter at the top), a hairline edge
 * and a faint inner glow in the same hue, plus a top highlight — reads as a lit tile instead of a flat block. The colour
 * logic (heatFill / break-even) is unchanged. The glow rides on Tailwind's `--tw-inset-shadow`, so it composes with
 * the ring / shadow utilities (pair the element with HEAT_CELL).
 */
export function heatCellStyle(fill: string | undefined): CSSProperties | undefined {
  if (!fill) return undefined;
  return {
    backgroundImage: `linear-gradient(to top, ${fill}, ${heatAlpha(fill, 0.55)})`,
    borderColor: heatAlpha(fill, 1.1),
    "--tw-inset-shadow": `inset 0 1px 0 hsl(var(--foreground) / 0.06), inset 0 0 14px ${heatAlpha(fill, 0.6)}`,
  } as CSSProperties;
}

/**
 * Classes of a heat cell: 10px corners, composable shadow (the inner glow above), a gentle lift + shadow on hover.
 * Motion is handled app-wide (data-motion kill-switch in index.css).
 */
export const HEAT_CELL =
  "rounded-[10px] shadow-none transition-[transform,box-shadow,background-color] duration-[var(--dur-1)] hover:-translate-y-px hover:shadow-[0_6px_16px_-8px_hsl(var(--foreground)/0.35)]";
