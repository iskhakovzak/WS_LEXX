/**
 * Focus + context for recharts: the hovered bar stays full, the others recede. P&L lines carry no glow (design audit).
 *
 *   const focus = useBarFocus();
 *   <BarChart {...focus.chartProps}>
 *     {barGradients(gid)}
 *     <Bar …>{rows.map((r, i) => <Cell key={i} fill={`url(#${gid}-${r.v >= 0 ? "up" : "down"})`} fillOpacity={focus.opacity(i)} />)}</Bar>
 *
 * State changes only when the hovered index changes (React bails out on the same value), so moving inside a bar is free.
 */
import { useCallback, useMemo, useState } from "react";
import { BAR_DIM } from "./theme";

interface ChartMouseState { isTooltipActive?: boolean; activeTooltipIndex?: number | string | null }

export function useBarFocus() {
  const [active, setActive] = useState<number | null>(null);
  const onMouseMove = useCallback((s: ChartMouseState | null) => {
    const i = s?.isTooltipActive ? Number(s.activeTooltipIndex) : NaN;
    setActive(Number.isFinite(i) ? i : null);
  }, []);
  const onMouseLeave = useCallback(() => setActive(null), []);
  return useMemo(() => ({
    active,
    chartProps: { onMouseMove, onMouseLeave },
    /** Fill opacity of bar `i`: full when nothing / this one is hovered, dimmed otherwise. */
    opacity: (i: number) => (active == null || active === i ? 1 : BAR_DIM),
  }), [active, onMouseMove, onMouseLeave]);
}
