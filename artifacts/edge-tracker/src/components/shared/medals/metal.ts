/**
 * Metals of the «Олимп» coins (stage medals and award tokens). The raw colours below are the ONLY raw colours of the
 * medal family: they paint the SVG metal gradients (a coin has to read as bronze / silver / gold in every theme).
 * Everything around a coin (text, rings, pills) uses the semantic tokens; a locked coin is painted with tokens too.
 */

export type Metal = "bronze" | "silver" | "gold" | "platinum";

/** hi → light → mid → dark → deep: highlight, polished face, body, shadow, engraving ink. */
export type MetalPaint = { hi: string; light: string; mid: string; dark: string; deep: string };

export const METALS: Readonly<Record<Metal, MetalPaint>> = {
  bronze: { hi: "#ffe4c8", light: "#e6a874", mid: "#b8733f", dark: "#7d4521", deep: "#46230d" },
  silver: { hi: "#ffffff", light: "#e6ebf0", mid: "#b3bcc8", dark: "#76818f", deep: "#3c4450" },
  gold: { hi: "#fff7d6", light: "#f6d36e", mid: "#d6a432", dark: "#986c10", deep: "#4f3705" },
  platinum: { hi: "#f6fdff", light: "#d6edf3", mid: "#a2c5d0", dark: "#668c99", deep: "#2f4b55" },
};

/** An unearned coin: a flat, unpolished blank in the theme's muted tones (semantic tokens, follows light / dark) —
 *  no metal gradient, so it never reads as silver. */
export const LOCKED_PAINT: MetalPaint = {
  hi: "hsl(var(--muted))",
  light: "hsl(var(--muted))",
  mid: "hsl(var(--muted))",
  dark: "hsl(var(--muted-foreground) / 0.35)",
  deep: "hsl(var(--muted-foreground) / 0.65)",
};
