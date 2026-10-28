/**
 * The two quick taps of a plan / watchlist ticker: the catalyst's direction (bullish / bearish) and strength (weak /
 * strong), stored per (me, day, ticker) — PropReports trades link to it by themselves. Prefill: without a mark the
 * suggested direction (the plan's own direction, else the day's event / earnings / gap) is drawn dashed; tapping it, or
 * tapping a strength, confirms it. Tapping a chosen value again clears it.
 */
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtPct } from "@/lib/format";
import { strategyI18n } from "@/i18n/ns/strategy";
import { catalystDayQuery, catalystHintQuery, useSaveMark } from "./api";
import { DIRECTIONS, STRENGTHS, suggestDirection, tapMark, type Direction, type MarkSource, type Strength, type Suggestion } from "./model";

const TICKER_RE = /^[A-Z0-9][-A-Z0-9.]{0,11}$/;

export function CatalystTaps({
  ticker: raw, date, source, planBias, gapPct, label = true, className,
}: {
  /** The leading «Катализатор» word (off where the row already says it). */
  label?: boolean;
  ticker: string;
  /** NY trading day the ticker is planned / watched for. */
  date: string;
  source: MarkSource;
  /** The ticker's direction in the plan (bull / bear / neutral) — the first prefill. */
  planBias?: string | null;
  /** The live gap the screen already has (watchlist quote), in %. */
  gapPct?: number | null;
  className?: string;
}) {
  const { t } = strategyI18n.useT();
  const ticker = raw.trim().toUpperCase();
  const valid = TICKER_RE.test(ticker);
  const day = useQuery({ ...catalystDayQuery(date), enabled: valid });
  const mark = day.data?.marks.find((m) => m.ticker === ticker) ?? null;
  const marked = !!mark && (mark.direction != null || mark.strength != null);
  // A suggestion is read only while there is nothing to confirm yet (one cached request per ticker and day).
  // With the plan's own direction the hint still matters: it may carry the analysts' «strong» (same direction only).
  const hintQ = useQuery({ ...catalystHintQuery(date, ticker), enabled: valid && day.isSuccess && !mark });
  const suggestion: Suggestion | null = mark ? null : suggestDirection({ planBias, hint: hintQ.data ?? null, gapPct });
  const save = useSaveMark(date);
  if (!valid) return null;

  const tap = (x: { direction: Direction } | { strength: Strength }) => {
    const next = tapMark(mark, x, suggestion);
    save.mutate({ date, ticker, ...next, kind: mark?.kind ?? suggestion?.kind ?? null, source });
  };
  const sourceText = (s: Suggestion) =>
    s.source === "gap" ? t("catalyst.source.gap", { gap: fmtPct(s.movePct ?? 0, 1) }) : t(`catalyst.source.${s.source}`);
  const analystText = (s: Suggestion) => !s.analyst ? "" : s.analyst.reason === "cluster"
    ? t("catalyst.analystCluster", { count: s.analyst.count })
    : t("catalyst.analystTarget", { pct: fmtPct(s.analyst.targetPct ?? 0, 0) });

  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)} data-catalyst-marked={marked || undefined}>
      {label && <span className="mr-1 text-xs text-muted-foreground">{t("catalyst.label")}</span>}
      <span role="group" aria-label={t("catalyst.directionAria", { ticker })} className="inline-flex items-center gap-0.5">
        {DIRECTIONS.map((d) => {
          const on = mark?.direction === d;
          const hinted = !on && suggestion?.direction === d;
          const Icon = d === "bull" ? ArrowUp : ArrowDown;
          return (
            <button
              key={d}
              type="button"
              aria-pressed={on}
              onClick={() => tap({ direction: d })}
              title={hinted ? t("catalyst.suggested", { source: sourceText(suggestion!) }) : t(`catalyst.direction.${d}`)}
              className={cn(
                "chip inline-flex h-7 items-center gap-1 px-2 text-xs font-medium",
                hinted && "border-dashed",
                hinted && (d === "bull" ? "text-up" : "text-down"),
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="sr-only sm:not-sr-only">{t(`catalyst.direction.${d}`)}</span>
            </button>
          );
        })}
      </span>
      <span role="group" aria-label={t("catalyst.strengthAria", { ticker })} className="inline-flex items-center gap-0.5">
        {STRENGTHS.map((s) => {
          const hinted = !mark?.strength && suggestion?.strength === s;
          return (
            <button
              key={s}
              type="button"
              aria-pressed={mark?.strength === s}
              onClick={() => tap({ strength: s })}
              title={hinted ? t("catalyst.suggested", { source: analystText(suggestion!) }) : undefined}
              className={cn("chip inline-flex h-7 items-center px-2 text-xs font-medium", hinted && "border-dashed text-primary")}
            >
              {t(`catalyst.strength.${s}`)}
            </button>
          );
        })}
      </span>
    </span>
  );
}
