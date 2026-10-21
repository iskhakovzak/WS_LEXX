/**
 * Ticker context from Finviz (read-only): a row of chips (sector · cap · float · short float · RVOL · ATR · earnings)
 * and a small «Контекст» panel with every field. Loads lazily — the snapshot is requested only when the row scrolls
 * into view — and hides itself while Finviz is not connected (the screener card says so once; no duplicates here).
 *   <TickerContext ticker="NVDA" />                          trade sheet, playbook setup / example cards
 *   <TickerContextList tickers={[...]} />                    day review: one row per traded ticker
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import { Info, LineChart } from "lucide-react";
import { Panel, Pill, type Tone } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtCompact, fmtDeskDate, fmtDeskDateTime, fmtNum, fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { finvizI18n } from "@/i18n/ns/finviz";
import { tickerSnapshotQuery, useFinvizStatus } from "./api";
import { normTicker, type TickerSnapshot } from "./model";
import { contextChips, type ContextChip } from "./chips";

/** True once the element has been near the viewport (then stays true: the query is cached). */
function useSeen<T extends Element>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (seen) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setSeen(true);
        io.disconnect();
      }
    }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return [ref, seen];
}

const CHIP_TONE: Record<ContextChip["tone"], Tone> = { neutral: "neutral", warn: "warn", accent: "accent" };

function Chips({ chips, max }: { chips: ContextChip[]; max?: number }) {
  const shown = max ? chips.slice(0, max) : chips;
  return (
    <>
      {shown.map((c) => (
        <Pill key={c.key} tone={CHIP_TONE[c.tone]} title={c.title} className="max-w-[14rem]">
          <span className="truncate">{c.text}</span>
        </Pill>
      ))}
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3 py-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right text-sm font-medium tabular-nums" title={value}>{value}</dd>
    </div>
  );
}

/** The full snapshot in a small popover panel. */
function ContextPanel({ snap }: { snap: TickerSnapshot }) {
  const { t } = finvizI18n.useT();
  const dash = "—";
  const earnings = snap.earningsDate
    ? `${fmtDeskDate(snap.earningsDate.slice(0, 10), "dayMonth")}${snap.earningsTiming ? ` · ${snap.earningsTiming.toUpperCase()}` : ""}`
    : dash;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div>
        <p className="text-sm font-semibold">{t("ctx.title", { ticker: snap.ticker })}</p>
        {snap.company && <p className="truncate text-xs text-muted-foreground" title={snap.company}>{snap.company}</p>}
      </div>
      <dl className="divide-y divide-border/60">
        <Field label={t("ctx.sector")} value={snap.sector ?? dash} />
        <Field label={t("ctx.industry")} value={snap.industry ?? dash} />
        <Field label={t("ctx.country")} value={snap.country ?? dash} />
        <Field label={t("ctx.marketCap")} value={snap.marketCap != null ? `$${fmtCompact(snap.marketCap)}` : dash} />
        <Field label={t("ctx.float")} value={fmtCompact(snap.float)} />
        <Field label={t("ctx.shortFloat")} value={fmtPct(snap.shortFloatPct, { decimals: 1, signed: false })} />
        <Field label={t("ctx.shortRatio")} value={fmtNum(snap.shortRatio)} />
        <Field label={t("ctx.avgVolume")} value={fmtCompact(snap.avgVolume)} />
        <Field label={t("ctx.relVolume")} value={fmtNum(snap.relVolume)} />
        <Field label={t("ctx.atr")} value={fmtNum(snap.atr)} />
        <Field label={t("ctx.beta")} value={fmtNum(snap.beta)} />
        <Field label={t("ctx.earnings")} value={earnings} />
      </dl>
      {snap.asOf && <p className="text-2xs text-muted-foreground">{t("ctx.asOf", { date: fmtDeskDateTime(snap.asOf) })}</p>}
    </div>
  );
}

/**
 * Chips + «Контекст» popover for one ticker. `day` (NY date) marks an earnings date that falls on / right after it;
 * `max` limits the chips shown inline (the popover always has everything).
 */
export function TickerContext({ ticker, day, max, className }: { ticker: string; day?: string | null; max?: number; className?: string }) {
  const { t } = finvizI18n.useT();
  const sym = normTicker(ticker);
  const { state } = useFinvizStatus();
  const [ref, seen] = useSeen<HTMLDivElement>();
  const q = useQuery({ ...tickerSnapshotQuery(sym ?? ""), enabled: !!sym && state === "on" && seen });
  if (!sym || state === "off") return null;
  const snap = q.data ?? null;
  const loading = state === "loading" || !seen || q.isLoading;
  return (
    <div ref={ref} role="group" aria-label={t("ctx.aria", { ticker: sym })} className={cn("flex min-w-0 flex-wrap items-center gap-1.5", className)}>
      {loading ? (
        <>
          <Skeleton className="h-5 w-24 rounded-full" />
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </>
      ) : q.isError ? (
        <button type="button" onClick={() => void q.refetch()} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <Info className="h-3.5 w-3.5" aria-hidden="true" /> {t("ctx.loadFailed")}
        </button>
      ) : !snap ? (
        <span className="text-xs text-muted-foreground">{t("ctx.noData")}</span>
      ) : (
        <>
          <Chips chips={contextChips(snap, day ?? null)} max={max} />
          <Popover>
            <PopoverTrigger asChild>
              <Button type="button" variant="ghost" size="sm" className="h-6 gap-1 px-2 text-xs" title={t("ctx.moreTitle", { ticker: sym })}>
                <LineChart className="h-3.5 w-3.5" aria-hidden="true" />
                {t("ctx.more")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72" align="start">
              <ContextPanel snap={snap} />
            </PopoverContent>
          </Popover>
        </>
      )}
    </div>
  );
}

/** Day review: the context of every ticker traded that day (unique, at most 12, in the order given). */
export function TickerContextList({ tickers, day, className }: { tickers: readonly string[]; day?: string | null; className?: string }) {
  const { t } = finvizI18n.useT();
  const { state } = useFinvizStatus();
  const list = [...new Set(tickers.map((x) => normTicker(x)).filter((x): x is string => !!x))].slice(0, 12);
  if (state !== "on" || list.length === 0) return null;
  return (
    <Panel title={t("ctx.listTitle")} description={t("ctx.listDesc")} icon={LineChart} className={className} data-print-hide>
      <ul className="flex flex-col divide-y divide-border/50">
        {list.map((sym) => (
          <li key={sym} className="flex min-w-0 flex-col gap-1.5 py-2 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:gap-3">
            <span className="w-16 shrink-0 text-sm font-semibold">{sym}</span>
            <TickerContext ticker={sym} day={day} />
          </li>
        ))}
      </ul>
    </Panel>
  );
}
