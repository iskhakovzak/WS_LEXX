/**
 * The trade chart of the detail sheet (chart engine, lazy chunk) with the morning plan's levels (Волна 2 п. 2.12).
 * The plan request lives here, so it fires only when a chart actually mounts; on «Обзор» the chart mounts once it is
 * scrolled near the viewport (InViewSheetChart), on «График» at once.
 */
import * as React from "react";
import type { Trade } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { usePlanOverlay } from "@/components/chart-engine/hooks/usePlanOverlay";

const LazyReplayChart = React.lazy(() => import("@/components/chart-engine").then((m) => ({ default: m.WsChart })));

/** Idea targets are free text («125 / 130», «$12.50») — the replay draws the first price it finds. */
export function parseTargetPrice(target: string | null): number | null {
  if (!target) return null;
  const m = /\d+(?:[.,]\d+)?/.exec(target);
  if (!m) return null;
  const n = Number(m[0].replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

type ChartProps = { trade: Trade; ideaTarget: string | null; height: number; showModes: boolean; fallbackClassName: string };

export function SheetChart({ trade, ideaTarget, height, showModes, fallbackClassName }: ChartProps) {
  const plan = usePlanOverlay(trade.id > 0 ? { tradeId: trade.id } : null);
  return (
    <React.Suspense fallback={<Skeleton className={fallbackClassName} />}>
      <LazyReplayChart
        trade={trade} target={parseTargetPrice(ideaTarget)} height={height} mode="analysis" showModes={showModes} planLevels={plan?.levels}
      />
    </React.Suspense>
  );
}

/** Mounts the chart (and its bars / plan requests) only once the slot is near the viewport; stays mounted after. */
export function InViewSheetChart(p: ChartProps) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [seen, setSeen] = React.useState(false);
  React.useEffect(() => {
    if (seen) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") { setSeen(true); return; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); }
    }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  if (seen) return <SheetChart {...p} />;
  return <div ref={ref} className={p.fallbackClassName} aria-hidden="true" />;
}
