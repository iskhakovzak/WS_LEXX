/**
 * Viewport and volume helpers for the chart — pure.
 */

export type LogicalRange = { from: number; to: number };

/**
 * The view a trader expects when a trade opens: some lead-in before the entry (at least 30 bars), the whole trade and
 * some room after the exit. Without a trade: the regular session of the day; without that: the last 120 bars.
 */
export function defaultViewRange(o: {
  count: number;
  entryIdx: number | null;
  exitIdx: number | null;
  dayRange: { from: number; to: number } | null;
}): LogicalRange | null {
  if (o.count <= 0) return null;
  if (o.entryIdx != null) {
    const a = o.entryIdx, b = Math.max(a, o.exitIdx ?? a);
    const span = b - a;
    return { from: a - Math.max(30, Math.round(span * 0.6)), to: b + Math.max(20, Math.round(span * 0.5)) };
  }
  if (o.dayRange) return { from: o.dayRange.from - 5, to: o.dayRange.to + 5 };
  return { from: Math.max(0, o.count - 120), to: o.count + 5 };
}

/**
 * Keep the replay cursor in view: when it leaves the window (or gets within 3 bars of the right edge), re-centre it at
 * ~70 % of the current width. Returns null when the current view is fine.
 */
export function followCursor(view: LogicalRange | null, cursor: number, minSpan = 40): LogicalRange | null {
  const span = view ? Math.max(minSpan, view.to - view.from) : 100;
  if (view && cursor <= view.to - 3 && cursor >= view.from) return null;
  return { from: cursor - span * 0.7, to: cursor + span * 0.3 };
}

/**
 * Volume capped at a high percentile so one opening-print spike does not flatten every other bar. The legend keeps
 * showing the true volume; only the bar heights are capped.
 */
export function capVolumes(vols: readonly number[], q = 0.98): { cap: number; values: number[] } {
  const clean = vols.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const sorted = clean.filter((v) => v > 0).sort((a, b) => a - b);
  if (!sorted.length) return { cap: 0, values: clean };
  const cap = sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))];
  return { cap, values: clean.map((v) => Math.min(v, cap)) };
}
