/**
 * Setup families of the desk (pure): the desk-level «what kind of trade» that does not depend on anyone's personal
 * playbook names — the day's opening gap of the ticker (candle archive: RTH open vs the previous close) × the side.
 * Shared by the desk pulse (a trade's family) and «лёгкие деньги дня» (the family a clean move paid).
 *
 *   gap_up_long / gap_up_short       the ticker opened ≥ gapPct above the previous close; long = gap-and-go, short = fade
 *   gap_down_long / gap_down_short   opened ≥ gapPct below; long = fade / bounce, short = continuation
 *   flat_long / flat_short           no gap of that size — a regular-session move
 *
 * A trade without the day's archived numbers, or without a side, has no family (null): it is counted as unclassified,
 * never guessed.
 */
export const FAMILIES = ["gap_up_long", "gap_up_short", "gap_down_long", "gap_down_short", "flat_long", "flat_short"] as const;
export type Family = (typeof FAMILIES)[number];

export const isFamily = (v: unknown): v is Family => typeof v === "string" && (FAMILIES as readonly string[]).includes(v);

export type GapKind = "gap_up" | "gap_down" | "flat";

/** The gap kind of a day from its opening gap in % (null without the number). */
export function gapKindOf(gapPct: number | null | undefined, minGapPct: number): GapKind | null {
  if (gapPct == null || !Number.isFinite(gapPct)) return null;
  if (gapPct >= minGapPct) return "gap_up";
  if (gapPct <= -minGapPct) return "gap_down";
  return "flat";
}

export function familyOf(gapPct: number | null | undefined, side: "long" | "short" | null | undefined, minGapPct: number): Family | null {
  const g = gapKindOf(gapPct, minGapPct);
  if (!g || (side !== "long" && side !== "short")) return null;
  return `${g}_${side}` as Family;
}

/** The side a family trades. */
export const sideOfFamily = (f: Family): "long" | "short" => (f.endsWith("_long") ? "long" : "short");

/** The day's numbers of one ticker from the candle archive (regular session + the previous close). */
export type DayBar = { open: number; high: number; low: number; close: number; prevClose: number };

const pct = (a: number, b: number) => Math.round(((a - b) / b) * 10_000) / 100;

/** Opening gap and the regular-session body of a day, in %. */
export function gapOf(b: Pick<DayBar, "open" | "prevClose">): number | null {
  return b.prevClose > 0 && b.open > 0 ? pct(b.open, b.prevClose) : null;
}
