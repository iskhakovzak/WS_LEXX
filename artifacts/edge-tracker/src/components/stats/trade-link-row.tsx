import { Link } from "wouter";
import { ChevronRight } from "lucide-react";
import type { Trade } from "@workspace/api-client-react";
import { Pill, toneOf } from "@/components/ds";
import { cn } from "@/lib/utils";
import { normalizeResult, resultLabel } from "@/lib/trade-result";
import { entryKey, fmtValue, valueOf, type Metric } from "./metrics";

export function resultTone(r: string) {
  const n = normalizeResult(r);
  return n === "win" ? "up" : n === "loss" ? "down" : n === "be" ? "warn" : r?.trim().toLowerCase() === "open" ? "accent" : "neutral";
}

function sideLabel(side: string | null | undefined): string | null {
  const s = (side ?? "").trim().toLowerCase();
  if (!s) return null;
  return s.startsWith("s") ? "Short" : s.startsWith("l") ? "Long" : side!.trim();
}

/** One compact trade row linking to the trade in the journal (/trades?highlight=id). */
export function TradeLinkRow({
  trade, metric, rank, showDate = true, className,
}: {
  trade: Trade; metric: Metric; rank?: number; showDate?: boolean; className?: string;
}) {
  const v = valueOf(trade, metric);
  const date = entryKey(trade);
  const side = sideLabel(trade.side);
  return (
    <li>
      <Link
        href={`/trades?highlight=${trade.id}`}
        className={cn(
          "group flex min-h-11 items-center gap-3 rounded-xl px-2 py-1.5 transition-colors hover:bg-[var(--glass-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
        aria-label={`Открыть сделку ${trade.ticker} от ${date}`}
      >
        {rank != null && <span className="w-4 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{rank}</span>}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-foreground">{trade.ticker}</span>
            {side && <span className="text-xs text-muted-foreground">{side}</span>}
            <Pill tone={resultTone(trade.result)} className="px-1.5 py-0 text-2xs">
              {trade.result?.trim().toLowerCase() === "open" ? "Открыта" : resultLabel(trade.result)}
            </Pill>
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {[showDate ? date : null, trade.setup || trade.eventType, trade.trader].filter(Boolean).join(" · ") || "—"}
          </div>
        </div>
        <span className={cn("shrink-0 text-sm font-semibold tabular-nums", v == null ? "text-muted-foreground" : toneOf(v) === "up" ? "text-up" : toneOf(v) === "down" ? "text-down" : "text-foreground")}>
          {fmtValue(v, metric)}
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-60 transition-opacity group-hover:opacity-100" aria-hidden="true" />
      </Link>
    </li>
  );
}
