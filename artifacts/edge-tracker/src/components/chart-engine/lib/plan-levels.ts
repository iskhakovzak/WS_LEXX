/**
 * Plan against execution (Волна 2, item 2.12): the morning plan's levels of the trade's ticker as rail lines on the
 * trade chart (GET /api/chart/plan-overlay — api lib/chartPlanOverlay.ts). Pure.
 */
import type { ChartTheme } from "../theme";
import type { LevelLine } from "../primitives/LevelsPrimitive";

export type PlanLevel = { price: number; kind: "support" | "resistance" };
export type PlanOverlay = { ticker: string; date: string; source: "own" | "desk" | null; levels: PlanLevel[]; setup: string | null };

/** Dotted rail lines: support in the up colour, resistance in the down colour; `label` = «План» in the UI language. */
export function planRail(levels: readonly PlanLevel[] | null | undefined, theme: ChartTheme, label: string): LevelLine[] {
  if (!levels?.length) return [];
  return levels
    .filter((l) => Number.isFinite(l.price) && l.price > 0)
    .map((l, i) => ({
      key: `plan${i}`,
      price: l.price,
      text: label,
      color: l.kind === "support" ? theme.up(0.75) : theme.down(0.75),
      dash: [2, 3],
    }));
}
