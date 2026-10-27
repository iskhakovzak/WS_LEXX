/**
 * Price line of an image card: the same bars and fills the trade chart already fetched (useChartData with the chart's
 * own window, so an opened chart makes the card instant); a straight entry → exit line when the day has no bars.
 */
import * as React from "react";
import { useChartData } from "./useChartData";
import { isoToEpoch } from "../lib/time";
import type { TradeLike } from "../types";
import { cardSeries, fallbackSeries, type CardSeries } from "@/components/shared/share-canvas/series";

export type CardSeriesState = { series: CardSeries | null; loading: boolean };

// A placeholder the chart hook can window (a real date) while nothing is fetched (enabled: false, no ticker).
const NO_TRADE: TradeLike = { id: 0, ticker: "", date: "2000-01-03" };

/** `trade` null = nothing to draw (no request is made). */
export function useCardSeries(trade: TradeLike | null, entry: number | null, exit: number | null): CardSeriesState {
  const data = useChartData(trade ?? NO_TRADE, { enabled: trade != null });
  const series = React.useMemo(() => {
    if (!trade) return null;
    const opening = data.executions.filter((e) => (e.kind === "entry" || e.kind === "add") && e.executedAt);
    const closing = data.executions.filter((e) => e.kind !== "entry" && e.kind !== "add" && e.executedAt);
    const entryTime = opening.length ? isoToEpoch(opening[0]!.executedAt) : null;
    const exitTime = closing.length ? isoToEpoch(closing[closing.length - 1]!.executedAt) : null;
    const fromBars = cardSeries(data.bars, Number.isFinite(entryTime) ? entryTime : null, Number.isFinite(exitTime) ? exitTime : null, entry, exit);
    return fromBars ?? fallbackSeries(entry, exit);
  }, [trade, data.bars, data.executions, entry, exit]);
  return { series: data.loading ? null : series, loading: trade != null && data.loading };
}
