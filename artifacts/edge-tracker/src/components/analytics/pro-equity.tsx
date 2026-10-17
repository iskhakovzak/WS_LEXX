import { useMemo } from "react";
import { LineChart } from "lucide-react";
import { Panel, EmptyState } from "@/components/ds";
import { type Metric, type OhlcCandle } from "@/lib/analytics-pro";
import { EquityChart, fromOhlc } from "@/components/equity-chart";

/** Cumulative equity by day on the equity engine: candles (open/close of the day, wick = intraday extreme) or area. */
export function EquityPanel({ candles, metric }: { candles: OhlcCandle[]; metric: Metric }) {
  const days = useMemo(() => fromOhlc(candles), [candles]);
  return (
    <Panel
      icon={LineChart}
      title="Кривая капитала"
      description={metric === "r" ? "Накопленный результат в R · клик по дню — разбор дня" : "Накопленный P&L · клик по дню — разбор дня"}
    >
      {candles.length === 0 ? (
        <EmptyState icon={LineChart} title="Нет данных для графика" description="В выборке нет сделок с датой." />
      ) : (
        <EquityChart days={days} unit={metric === "r" ? "r" : "net"} storageKey="analyticsPro.equity" height={400} />
      )}
    </Panel>
  );
}
