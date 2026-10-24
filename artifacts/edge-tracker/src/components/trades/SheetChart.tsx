/**
 * The trade chart of the detail sheet (chart engine, lazy chunk) with the morning plan's levels (Волна 2 п. 2.12).
 * It sits in the sheet's hero, so it mounts with the sheet; the plan request lives here and fires with it.
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

/** Height the chart's toolbar (modes, intervals, layers) adds above the plot. */
const TOOLBAR_PX = 64;

type ChartProps = { trade: Trade; ideaTarget: string | null; height: number; showModes: boolean; fallbackClassName: string };

export function SheetChart({ trade, ideaTarget, height, showModes, fallbackClassName }: ChartProps) {
  const plan = usePlanOverlay(trade.id > 0 ? { tradeId: trade.id } : null);
  return (
    <React.Suspense fallback={<Skeleton className={fallbackClassName} style={{ height: height + (showModes ? TOOLBAR_PX : 0) }} />}>
      <LazyReplayChart
        trade={trade} target={parseTargetPrice(ideaTarget)} height={height} mode="analysis" showModes={showModes} planLevels={plan?.levels}
      />
    </React.Suspense>
  );
}
