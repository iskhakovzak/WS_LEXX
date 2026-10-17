import * as React from "react";
import { ArrowDownRight, ArrowUpRight, Check, ChevronDown, Database } from "lucide-react";
import { Pill, toneOf, toneText } from "@/components/ds";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { Trade } from "@workspace/api-client-react";
import { HORIZON_LABEL, RESULTS, RESULT_LABEL, fmtMoney, fmtR, isBrokerTrade, netPnl, resultKey, resultTone, splitTags, type Horizon } from "./trade-utils";

export function SidePill({ side, compact }: { side?: string | null; compact?: boolean }) {
  if (!side) return <span className="text-muted-foreground">—</span>;
  const isLong = side === "Long";
  const Icon = isLong ? ArrowUpRight : ArrowDownRight;
  return (
    // Direction is not a result: neutral tone, the arrow carries the meaning (design audit).
    <Pill tone="neutral" className={compact ? "px-1.5" : undefined}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      {compact ? (isLong ? "L" : "S") : side}
      {compact && <span className="sr-only">{side}</span>}
    </Pill>
  );
}

export function ResultPill({ result, className }: { result: string; className?: string }) {
  const k = resultKey(result);
  return (
    <Pill tone={resultTone(result)} dot className={className}>
      {RESULT_LABEL[k] ?? result}
    </Pill>
  );
}

/** Result pill that opens a menu to change the result in place. */
export function ResultMenu({
  result,
  onChange,
  disabled,
  ticker,
}: {
  result: string;
  onChange: (r: string) => void;
  disabled?: boolean;
  ticker: string;
}) {
  if (disabled) return <ResultPill result={result} />;
  const cur = resultKey(result);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          aria-label={`Результат ${ticker}: ${RESULT_LABEL[cur]}. Изменить`}
          className="group inline-flex items-center gap-0.5 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ResultPill result={result} />
          <ChevronDown className="h-3 w-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
        {RESULTS.map((r) => (
          <DropdownMenuItem key={r} onSelect={() => r !== cur && onChange(r)} className="gap-2">
            <ResultPill result={r} />
            {r === cur && <Check className="ml-auto h-3.5 w-3.5 text-primary" aria-hidden="true" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TagChips({ tags, max = 2, className }: { tags?: string | null; max?: number; className?: string }) {
  const chips = splitTags(tags);
  if (!chips.length) return null;
  const hidden = chips.length - max;
  return (
    <div className={cn("flex flex-wrap gap-1", className)} title={hidden > 0 ? chips.join(", ") : undefined}>
      {chips.slice(0, max).map((tag) => (
        <span key={tag} className="whitespace-nowrap rounded-full bg-primary/10 px-2 py-px text-2xs font-medium text-primary">
          {tag}
        </span>
      ))}
      {hidden > 0 && (
        <span className="whitespace-nowrap rounded-full border border-border px-1.5 py-px text-2xs text-muted-foreground">
          +{hidden}
          <span className="sr-only"> ещё: {chips.slice(max).join(", ")}</span>
        </span>
      )}
    </div>
  );
}

/** R value with a centred bar (left = loss, right = gain), scaled to `maxAbs`. */
export function RBar({ r, derived, maxAbs }: { r: number | null; derived?: boolean; maxAbs: number }) {
  if (r == null) return <span className="text-muted-foreground">—</span>;
  const pct = Math.min(1, Math.abs(r) / Math.max(maxAbs, 0.5)) * 50;
  const tone = toneOf(r);
  return (
    <div className="flex items-center gap-2" title={derived ? "Рассчитано по входу, стопу и выходу" : undefined}>
      <div className="relative hidden h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-[var(--glass-bg)] lg:block" aria-hidden="true">
        <span className="absolute inset-y-0 left-1/2 w-px bg-border" />
        <span
          className={cn("absolute inset-y-0 rounded-full", r >= 0 ? "bg-up" : "bg-down")}
          style={r >= 0 ? { left: "50%", width: `${pct}%` } : { right: "50%", width: `${pct}%` }}
        />
      </div>
      <span className={cn("font-medium tabular-nums", toneText(tone))}>
        {derived && <span className="text-muted-foreground">≈</span>}
        {fmtR(r, 1)}
      </span>
    </div>
  );
}

export function ConvictionDots({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-1" aria-label={`Убеждённость ${value} из 5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className={cn("h-1.5 w-3 rounded-full", i < value ? "bg-primary" : "bg-[var(--glass-bg)] border border-border")} />
      ))}
      <span className="ml-1 tabular-nums text-xs text-muted-foreground">{value}/5</span>
    </span>
  );
}

/** Horizon pill; intraday is the default and is hidden unless `showIntraday`. */
export function HorizonPill({ horizon, showIntraday }: { horizon: Horizon; showIntraday?: boolean }) {
  if (horizon === "intraday" && !showIntraday) return null;
  return (
    <Pill tone={horizon === "swing" ? "purple" : horizon === "overnight" ? "warn" : "neutral"} className="px-1.5 text-2xs">
      {HORIZON_LABEL[horizon]}
    </Pill>
  );
}

/** Net P&L (gross − |fees|, shared formula) with the gross/fees breakdown in the tooltip. */
export function NetPnl({ trade, className }: { trade: Trade; className?: string }) {
  const net = netPnl(trade);
  const title = trade.pnl != null && trade.fees ? `Брутто ${fmtMoney(trade.pnl)} · комиссии ${fmtMoney(-Math.abs(trade.fees))} · нетто ${fmtMoney(net)}` : undefined;
  return (
    <span title={title} className={cn("tabular-nums", net == null ? "text-muted-foreground" : toneText(toneOf(net)), className)}>
      {fmtMoney(net)}
    </span>
  );
}

/** «синхронизировано N мин назад» for broker-sourced trades. */
export function syncedAgo(iso: string | null | undefined, now = Date.now()): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const min = Math.max(0, Math.round((now - t) / 60000));
  if (min < 1) return "только что";
  if (min < 60) return `${min} мин назад`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} ч назад`;
  return `${Math.round(h / 24)} дн назад`;
}

/** Source badge: shown only for broker-sourced (PropReports) trades. */
export function SourceBadge({ trade, withSync, className }: { trade: Pick<Trade, "source" | "syncedAt" | "brokerAccount">; withSync?: boolean; className?: string }) {
  if (!isBrokerTrade(trade)) return null;
  const ago = syncedAgo(trade.syncedAt);
  const title = [
    "Источник: PropReports (числа брокера — только чтение)",
    trade.brokerAccount ? `Счёт: ${trade.brokerAccount}` : null,
    ago ? `Синхронизировано ${ago}` : null,
  ].filter(Boolean).join("\n");
  return (
    <span className={cn("inline-flex items-center gap-1", className)} title={title}>
      <Pill tone="accent" className="px-1.5 text-2xs">
        <Database className="h-3 w-3" aria-hidden="true" />
        PropReports
      </Pill>
      {withSync && ago && <span className="text-2xs text-muted-foreground">синхронизировано {ago}</span>}
    </span>
  );
}

/** Gross / fees / net in one compact row (for the detail sheet). */
export function PnlBreakdown({ trade, className }: { trade: Trade; className?: string }) {
  const net = netPnl(trade);
  if (trade.pnl == null) return <span className={cn("text-muted-foreground", className)}>—</span>;
  return (
    <span className={cn("inline-flex items-center gap-2 tabular-nums text-xs", className)}>
      <span title="Брутто">{fmtMoney(trade.pnl)}</span>
      <span className="text-muted-foreground">−</span>
      <span className="text-muted-foreground" title="Комиссии">{fmtMoney(Math.abs(trade.fees ?? 0)).replace(/^[+−]/, "")}</span>
      <span className="text-muted-foreground">=</span>
      <span className={cn("font-semibold", net == null ? "text-muted-foreground" : toneText(toneOf(net)))} title="Нетто">{fmtMoney(net)}</span>
    </span>
  );
}
