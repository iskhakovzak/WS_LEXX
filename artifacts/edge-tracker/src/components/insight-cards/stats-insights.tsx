/**
 * The insight cards on /stats for the selected period / trader / horizon («Разрезы» already applied to `trades`).
 * Bento on xl: «Серии» (2) + trade number + after a loss / time in position (2) + weekdays (2); two columns on
 * tablets, stacked on phones. Bars and rows drill into the trade list of the same period (kit InsightScope «trades»).
 */
import { AfterLossCard, HoldCard, SeqCard, WeekdayCard } from "./cards";
import type { InsightScope } from "./kit";
import type { InsightTrade } from "./model";
import { StreaksCard } from "./streaks-card";

export function StatsInsights({ trades, scope }: { trades: readonly InsightTrade[]; scope: InsightScope }) {
  return (
    <div className="grid items-stretch gap-4 md:grid-cols-2 xl:grid-cols-4">
      <div className="min-w-0 md:col-span-2"><StreaksCard trades={trades} scope={scope} /></div>
      <div className="min-w-0"><SeqCard trades={trades} scope={scope} /></div>
      <div className="min-w-0"><AfterLossCard trades={trades} scope={scope} /></div>
      <div className="min-w-0 xl:col-span-2"><HoldCard trades={trades} scope={scope} /></div>
      <div className="min-w-0 xl:col-span-2"><WeekdayCard trades={trades} scope={scope} /></div>
    </div>
  );
}
