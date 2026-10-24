// Building blocks of the trades review page: KPI row, preset bar, trade row and the trading-day card.
import { TradeChip } from "@/components/ds/trade-chip";
import { isImxTrade } from "@/lib/trade-facets";
import * as React from "react";
import { Link } from "wouter";
import type { Trade } from "@workspace/api-client-react";
import { ArrowDownWideNarrow, ArrowUpNarrowWide, BookOpen, ChevronDown, ChevronRight, FileText, X } from "lucide-react";
import { FilterChip, Pill, Segmented, Sparkline, StatCard, StatGrid, toneOf, toneText, type Tone } from "@/components/ds";
import { moneyText, useBeRange } from "@/components/ds/money";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TradeSparkline } from "@/components/chart-engine";
import { exitEffTone } from "@/components/replay/QualityBlock";
import { links } from "@/lib/links";
import { cn } from "@/lib/utils";
import type { TradeDay, TradesPageFacets, TradesPageSummary } from "@/hooks/use-trades-page";
import { effectiveR, fmtHold, holdSeconds, netPnl, tradeWall, wallHm, type QualityMap, type SortConfig, type TradeQualityLite } from "./trade-utils";
import { feeShareText } from "./sheet-model";
import { PRESETS, PRESET_META, type Preset, type TagKind } from "./review-presets";
import { ReviewChips, type PickerTarget } from "./review-tagging";
import { SidePill } from "./trade-bits";
import { SortHead } from "./sort-head";
import { ShareCardRowButton } from "./share-card/ShareCardButton";
import type { TradesView } from "./use-trade-filters";
import { fmtCount, fmtDateCustom, fmtR, fmtRate, fmtUsd } from "@/lib/format";
import { commonI18n } from "@/i18n/ns/common";
import { tradesI18n } from "@/i18n/ns/trades";
import { personName } from "@/i18n";

/** Counts with locale grouping: «45 211» / «45,211», not «45211». */
const num = (v: number) => fmtCount(v);

/** «Чт, 15 окт» (+ year when it is not the current one). */
export function fmtDayLong(d: string, withWeekday = true): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  if (!m) return d;
  const otherYear = Number(m[1]) !== new Date().getFullYear();
  const s = fmtDateCustom(m[0], {
    ...(withWeekday ? { weekday: "short" } : {}),
    day: "numeric",
    month: "short",
    ...(otherYear ? { year: "numeric" } : {}),
  }).replace(".", "");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** /behavior deep link (route registered by the lead; `links.behavior` does not exist yet). */
export function behaviorHref(trader?: string | null): string {
  return trader ? `/behavior?trader=${encodeURIComponent(trader)}` : "/behavior";
}

// ── KPIs ──────────────────────────────────────────────────────────────────────

/**
 * Six KPIs that matter for review. $ by default (most trades carry no stop); R only when ≥ 50 % of the closed
 * trades have one. Win rate / PF are coloured only against a threshold, never by "being positive".
 */
export function ReviewKpis({
  summary,
  loading,
  dayCurve,
  onPreset,
}: {
  summary: TradesPageSummary | null;
  loading: boolean;
  /** Cumulative net by day (oldest → newest) for the net card spark. */
  dayCurve: number[];
  onPreset: (p: Preset) => void;
}) {
  const { t } = tradesI18n.useT();
  const { t: tc } = commonI18n.useT();
  const s = summary;
  const closed = s ? s.wins + s.losses + s.be : 0;
  const useR = !!s && closed > 0 && s.rCount / closed >= 0.5;
  const gross = s?.gross ?? null;
  const fees = s?.fees ?? null;
  const feeShare = feeShareText(fees, gross);
  const payoff = useR
    ? s?.avgWinR != null && s.avgLossR != null && s.avgLossR !== 0 ? s.avgWinR / Math.abs(s.avgLossR) : null
    : s?.avgWinNet != null && s.avgLossNet != null && s.avgLossNet !== 0 ? s.avgWinNet / Math.abs(s.avgLossNet) : null;
  const pf = useR ? s?.profitFactor ?? null : s?.profitFactorNet ?? null;
  const pfTone: Tone = pf == null ? "neutral" : pf < 1 ? "down" : pf >= 1.5 ? "up" : "neutral";
  const perTrade = s?.net != null && s.pnlCount ? s.net / s.pnlCount : null;
  const untagged = s?.untagged ?? 0;

  return (
    <StatGrid min="10.5rem">
      <StatCard
        label={tc("trading.net")}
        term="net"
        loading={loading}
        value={fmtUsd(s?.net ?? null, { signed: true, decimals: "auto" })}
        tone={toneOf(s?.net ?? null)}
        hint={s ? (perTrade != null ? t("review.kpi.perTrade", { trades: tc("units.trades", { count: s.total }), amount: fmtUsd(perTrade, { signed: true, decimals: "auto" }) }) : tc("units.trades", { count: s.total })) : undefined}
        spark={dayCurve.length > 1 ? dayCurve : undefined}
      />
      <StatCard
        label="Win rate"
        term="winrate"
        loading={loading}
        value={fmtRate(s?.winRate ?? null)}
        hint={s ? (s.be ? t("review.kpi.winLossBe", { wins: num(s.wins), losses: num(s.losses), be: num(s.be) }) : t("review.kpi.winLoss", { wins: num(s.wins), losses: num(s.losses) })) : undefined}
      />
      <StatCard
        label={useR ? "Payoff, R" : "Payoff"}
        term="payoff"
        loading={loading}
        // The ratio is the headline (fits the card); the average win / loss behind it goes to the hint line.
        value={payoff != null ? payoff.toFixed(2) : "—"}
        tone={payoff == null ? "neutral" : payoff < 1 ? "down" : payoff >= 1.5 ? "up" : "neutral"}
        hint={
          !s ? undefined : useR
            ? t("review.kpi.avgPair", { win: fmtR(s?.avgWinR ?? null, 2), loss: fmtR(s?.avgLossR ?? null, 2) })
            : t("review.kpi.avgPair", { win: fmtUsd(s?.avgWinNet ?? null, { signed: true, decimals: "auto" }), loss: fmtUsd(s?.avgLossNet ?? null, { signed: true, decimals: "auto" }) })
        }
      />
      <StatCard
        label={useR ? "Profit factor, R" : "Profit factor"}
        term="pf"
        loading={loading}
        value={pf != null ? pf.toFixed(2) : "—"}
        tone={pfTone}
        hint={useR ? undefined : s?.posNet != null ? `${fmtUsd(s.posNet, { signed: true, decimals: "auto" })} / ${fmtUsd(-(s.negNet ?? 0), { signed: true, decimals: "auto" })}` : undefined}
      />
      <StatCard
        label={tc("trading.fees")}
        term="fees"
        loading={loading}
        value={fees != null ? fmtUsd(-Math.abs(fees), { signed: true, decimals: "auto" }).replace("−", "") : "—"}
        delta={feeShare != null ? t("review.kpi.feesShareOfGross", { share: feeShare.text }) : undefined}
        deltaTone={feeShare != null && feeShare.share > 0.5 ? "warn" : "neutral"}
        hint={gross != null ? t("review.kpi.grossHint", { amount: fmtUsd(gross, { signed: true, decimals: "auto" }) }) : undefined}
        onClick={() => onPreset("fees")}
      />
      <StatCard
        label={t("review.kpi.unreviewed")}
        loading={loading}
        value={num(untagged)}
        tone={untagged > 0 ? "warn" : "neutral"}
        hint={s ? (untagged ? t("review.kpi.unreviewedHint", { count: num(closed) }) : t("review.kpi.allTagged")) : undefined}
        onClick={untagged ? () => onPreset("review") : undefined}
      />
    </StatGrid>
  );
}

// ── Preset bar ────────────────────────────────────────────────────────────────

const SORT_COLS = ["date", "impact", "pnl", "fees", "hold", "ticker", "entry", "exitEff", "setup"] as const satisfies readonly SortConfig["col"][];

export function PresetBar({
  view,
  onView,
  preset,
  onPreset,
  counts,
  sort,
  onSort,
  trader,
}: {
  view: TradesView;
  onView: (v: TradesView) => void;
  preset: Preset | null;
  onPreset: (p: Preset | null) => void;
  counts: TradesPageFacets["presets"];
  sort: SortConfig;
  onSort: (s: SortConfig) => void;
  trader: string | null;
}) {
  const { t } = tradesI18n.useT();
  const meta = preset ? PRESET_META[preset] : null;
  const listLike = view === "list" || !!preset;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          ariaLabel={t("review.viewAria")}
          size="sm"
          value={preset ? "list" : view}
          onChange={(v) => onView(v as TradesView)}
          options={[{ value: "days", label: t("review.byDays") }, { value: "list", label: t("review.asList") }]}
        />
        <span className="mx-1 h-5 w-px bg-[var(--glass-border)]" aria-hidden="true" />
        <div role="group" aria-label={t("review.presetsAria")} className="flex flex-wrap items-center gap-1.5">
          {PRESETS.map((k) => {
            const n = counts?.[k];
            return (
              <FilterChip key={k} active={preset === k} onClick={() => onPreset(preset === k ? null : k)} count={n ?? undefined} size="sm">
                {PRESET_META[k].label}
              </FilterChip>
            );
          })}
        </div>
        {listLike && (
          <div className="ml-auto flex items-center gap-1">
            <Select value={sort.col} onValueChange={(v) => onSort({ col: v as SortConfig["col"], dir: sort.dir })}>
              <SelectTrigger className="h-8 w-auto min-w-[160px] gap-1.5 text-xs" aria-label={commonI18n.t("actions.sort")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORT_COLS.map((c) => <SelectItem key={c} value={c}>{t(`review.sort.${c}`)}</SelectItem>)}
                {!(SORT_COLS as readonly string[]).includes(sort.col) && <SelectItem value={sort.col}>{sort.col}</SelectItem>}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t(sort.dir === "desc" ? "review.sort.desc" : "review.sort.asc")}
              title={t(sort.dir === "desc" ? "review.sort.desc" : "review.sort.asc")}
              onClick={() => onSort({ col: sort.col, dir: sort.dir === "desc" ? "asc" : "desc" })}
            >
              {sort.dir === "desc" ? <ArrowDownWideNarrow className="h-4 w-4" aria-hidden="true" /> : <ArrowUpNarrowWide className="h-4 w-4" aria-hidden="true" />}
            </Button>
          </div>
        )}
      </div>
      {meta && (
        <div className="flex items-start gap-3 rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-2">
          <Pill tone={meta.tone} className="mt-0.5 shrink-0">{meta.label}</Pill>
          <p className="min-w-0 flex-1 text-sm text-muted-foreground">
            {meta.why}
            {preset === "revenge" && (
              <> <Link href={behaviorHref(trader)} className="whitespace-nowrap text-primary hover:underline">{t("review.behaviorLink")}</Link></>
            )}
          </p>
          <Button variant="ghost" size="icon-sm" className="shrink-0" aria-label={t("review.closePreset")} onClick={() => onPreset(null)}><X className="h-4 w-4" aria-hidden="true" /></Button>
        </div>
      )}
    </div>
  );
}

// ── Trade row ─────────────────────────────────────────────────────────────────

/**
 * Row grid. md+: the review table (fixed tracks, ~900px; the page scrolls it sideways when needed). Below md a
 * two-line card (ILYA-09): checkbox | ticker + side / time + hold | net + R; the other cells are hidden there.
 */
export const ROW_GRID = "grid grid-cols-[20px_minmax(0,1fr)_auto] md:grid-cols-[20px_116px_minmax(96px,0.6fr)_104px_140px_92px_minmax(200px,1.7fr)_52px] items-center gap-x-3";
/** Cell placement of the phone card (reset to the table flow from md). */
const CELL_PHONE = {
  check: "row-span-2 md:row-span-1",
  when: "col-start-2 row-start-2 md:col-start-auto md:row-start-auto",
  ticker: "col-start-2 row-start-1 md:col-start-auto md:row-start-auto",
  net: "col-start-3 row-start-1 row-span-2 md:col-start-auto md:row-start-auto md:row-span-1",
} as const;

function CaptureCell({ q, pending }: { q: TradeQualityLite | undefined; pending: boolean }) {
  const { t } = tradesI18n.useT();
  if (!q) return <span className="text-xs text-muted-foreground">{pending ? "…" : "—"}</span>;
  if (q.status === "unavailable" || q.exitEfficiency == null) return <span className="text-xs text-muted-foreground" title={t("review.noBars")}>—</span>;
  const mfe = q.mfeR != null ? fmtR(q.mfeR, 1) : q.mfeUsd != null ? fmtUsd(q.mfeUsd, { signed: true, decimals: "auto" }) : null;
  return (
    <span className="flex flex-col leading-tight" title={t("review.captureTitle")}>
      <span className={cn("text-sm font-medium tabular-nums", toneText(exitEffTone(q.exitEfficiency)))}>{fmtRate(q.exitEfficiency)}</span>
      {mfe && <span className="text-xs tabular-nums text-muted-foreground">MFE {mfe}</span>}
    </span>
  );
}

export function ReviewTradeRow({
  trade: t,
  showDate,
  showTrader,
  quality,
  qualityPending,
  active,
  selected,
  highlight,
  canTag,
  picker,
  setPicker,
  onPick,
  setupOptions,
  onOpen,
  onToggle,
  onFocusRow,
  onAddToPlaybook,
}: {
  trade: Trade;
  showDate: boolean;
  showTrader: boolean;
  quality: QualityMap;
  qualityPending: boolean;
  active: boolean;
  selected: boolean;
  highlight: boolean;
  canTag: boolean;
  picker: PickerTarget;
  setPicker: (p: PickerTarget) => void;
  onPick: (t: Trade, kind: TagKind, value: string | null) => void;
  setupOptions: readonly string[];
  onOpen: (t: Trade) => void;
  onToggle: (id: number, range: boolean) => void;
  onFocusRow: (id: number) => void;
  /** Optional row action «В плейбук» (icon in the last column, shown on hover / focus / active row). */
  onAddToPlaybook?: (t: Trade) => void;
}) {
  const { t: tr } = tradesI18n.useT();
  const w = tradeWall(t);
  const hold = holdSeconds(t);
  const net = t.pnl != null ? netPnl(t) : null;
  const open = wallHm(w.open);
  const r = effectiveR(t).value;
  const beRange = useBeRange();
  return (
    <div
      role="row"
      data-trade-id={t.id}
      data-active={active || undefined}
      aria-selected={selected || undefined}
      // Clicks inside a dialog portalled from this row (share card) bubble here through React: they are not row clicks.
      onClick={(e) => { if (!e.currentTarget.contains(e.target as Node)) return; onFocusRow(t.id); onOpen(t); }}
      className={cn(
        ROW_GRID,
        "group relative min-h-[var(--row-min-h)] cursor-pointer border-t border-[var(--glass-border)] px-3 py-[var(--row-py)] transition-colors first:border-t-0 hover:bg-[var(--glass-hover-bg)]",
        active && "bg-[var(--glass-hover-bg)] shadow-[inset_2px_0_0_hsl(var(--primary))]",
        selected && "bg-primary/[0.07]",
        // Deep-link target: a steady tint (fades with transition-colors when cleared), not an opacity pulse.
        highlight && "bg-primary/[0.14] shadow-[inset_2px_0_0_hsl(var(--primary))]",
      )}
    >
      <span onClick={(e) => e.stopPropagation()} className={cn("flex items-center", CELL_PHONE.check)}>
        {/* 16px box, ~40px hit area: on phones a near miss would open the trade sheet instead of selecting. */}
        <Checkbox
          className="relative after:absolute after:-inset-3 after:content-['']"
          checked={selected}
          aria-label={tr("review.select", { ticker: t.ticker })}
          onClick={(e) => { e.stopPropagation(); onToggle(t.id, e.shiftKey); }}
          onCheckedChange={() => { /* handled in onClick (shift-range) */ }}
        />
      </span>
      <span className={cn("flex flex-col leading-tight max-md:flex-row max-md:gap-1.5", CELL_PHONE.when)}>
        <span className="text-sm tabular-nums text-foreground max-md:text-xs max-md:text-muted-foreground">
          {showDate ? fmtDayLong(t.date.slice(0, 10), false) : open ?? "—"}
        </span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {showDate ? (open ? `${open} · ${fmtHold(hold)}` : fmtHold(hold)) : fmtHold(hold)}
        </span>
      </span>
      <span className={cn("flex min-w-0 flex-col leading-tight", CELL_PHONE.ticker)}>
        <span className="flex min-w-0 items-center gap-1.5">
          <button type="button" onClick={(e) => { e.stopPropagation(); onFocusRow(t.id); onOpen(t); }} className="truncate text-sm font-semibold text-foreground hover:underline" title={t.ticker}>
            {t.ticker}
          </button>
          <SidePill side={t.side} compact />
        </span>
        {showTrader && t.trader && <span className="truncate text-xs text-muted-foreground" title={personName(t.trader)}>{personName(t.trader)}</span>}
        {!showTrader && t.qty != null && <span className="hidden truncate text-xs tabular-nums text-muted-foreground md:inline">{commonI18n.t("units.shares", { count: fmtCount(t.qty) })}</span>}
      </span>
      <span className="hidden items-center md:flex" aria-hidden="true">
        <TradeSparkline trade={t} width={100} height={30} />
      </span>
      <span className={cn("flex flex-col items-end leading-tight", CELL_PHONE.net)}>
        <span className={cn("text-sm font-semibold tabular-nums", moneyText(net, beRange))}>{fmtUsd(net, { signed: true, decimals: "auto" })}</span>
        {r != null && <span className="text-xs tabular-nums text-muted-foreground md:hidden" title={tr("review.rGrossTitle")}>{fmtR(r, 2)}</span>}
        {t.fees ? <span className="hidden whitespace-nowrap text-xs tabular-nums text-muted-foreground md:inline" title={tr("review.grossFeesTitle")}>{tr("review.grossFees", { gross: fmtUsd(t.pnl, { signed: true, decimals: "auto" }), fees: fmtUsd(Math.abs(t.fees), { signed: true, decimals: "auto" }).replace("+", "") })}</span> : null}
      </span>
      <span className="hidden justify-end md:flex">
        <CaptureCell q={quality[t.id]} pending={qualityPending} />
      </span>
      {/* Strategy chips (colours from «Вид» → Чипы) lead the tag chips in the same cell. */}
      <span className="hidden min-w-0 flex-wrap items-center gap-1 md:flex">
        {t.strategy && <TradeChip group="strategy" value={t.strategy} />}
        {isImxTrade(t) && t.strategy !== "IMX" && <TradeChip group="strategy" value="IMX" />}
        <ReviewChips trade={t} canTag={canTag} picker={picker} setPicker={setPicker} onPick={onPick} setupOptions={setupOptions} />
      </span>
      {/* Row actions: «Картинка» (own closed trades, share-card) and «В плейбук» / the open chevron. */}
      <span className="hidden items-center justify-end md:flex">
        <ShareCardRowButton trade={t} active={active} onFocusRow={onFocusRow} />
        {onAddToPlaybook ? (
          <button
            type="button"
            aria-label={tr("review.addToPlaybookAria", { ticker: t.ticker })}
            title={tr("review.addToPlaybookTitle")}
            onClick={(e) => { e.stopPropagation(); onFocusRow(t.id); onAddToPlaybook(t); }}
            className={cn(
              "-mr-1.5 hidden h-8 w-8 place-items-center md:grid rounded-full text-muted-foreground transition-opacity hover:bg-[var(--glass-hover-bg)] hover:text-primary focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:opacity-0 md:group-hover:opacity-100",
              active && "md:opacity-100",
            )}
          >
            <BookOpen className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : (
          <ChevronRight className="hidden h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 md:block" aria-hidden="true" />
        )}
      </span>
    </div>
  );
}

/**
 * Column headers. With `sort`/`onSort` (list mode, server-side sort) the headers are clickable and stay in sync with
 * the sort select in the preset bar; the day view keeps plain headers (trades go in time order within a day).
 */
export function RowsHeader({ showDate, sort, onSort }: { showDate: boolean; sort?: SortConfig; onSort?: (col: SortConfig["col"]) => void }) {
  const { t } = tradesI18n.useT();
  const { t: tc } = commonI18n.useT();
  const head = (col: SortConfig["col"], label: React.ReactNode, opts: { align?: "left" | "right"; title?: string } = {}) =>
    sort && onSort ? (
      <SortHead active={sort.col === col} dir={sort.dir} onSort={() => onSort(col)} align={opts.align} title={opts.title}>{label}</SortHead>
    ) : (
      <span role="columnheader" className={cn(opts.align === "right" && "text-right")} title={opts.title}>{label}</span>
    );
  return (
    <div role="row" className={cn(ROW_GRID, "hidden border-b border-[var(--glass-border)] px-3 py-1.5 text-xs text-muted-foreground md:grid")}>
      <span />
      {sort && onSort && showDate ? (
        <span className="flex min-w-0 items-center gap-1">
          {head("date", t("review.head.date"))}
          {head("hold", t("review.head.hold"), { title: t("review.head.holdTitle") })}
        </span>
      ) : (
        head("date", showDate ? t("review.head.date") : t("review.head.entryHold"))
      )}
      {head("ticker", tc("trading.ticker"))}
      {head("entry", tc("trading.price"), { title: t("review.head.priceTitle") })}
      {head("pnl", tc("trading.net"), { align: "right" })}
      {head("exitEff", t("review.head.capture"), { align: "right", title: t("review.head.captureTitle") })}
      {head("setup", t("review.head.tags"))}
      <span />
    </div>
  );
}

export function RowsSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-1.5 p-3" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-11 w-full rounded-xl" />)}
    </div>
  );
}

// ── Trading-day card ──────────────────────────────────────────────────────────

export function DayCard({
  day,
  expanded,
  onToggle,
  trader,
  children,
}: {
  day: TradeDay;
  expanded: boolean;
  onToggle: () => void;
  trader: string | null;
  children?: React.ReactNode;
}) {
  const curve = React.useMemo(() => {
    let c = 0;
    return [0, ...day.seq.map((v) => (c += v))];
  }, [day.seq]);
  const feeShare = feeShareText(day.fees, day.gross);
  const closed = day.wins + day.losses + day.be;
  const { t } = tradesI18n.useT();
  const beRange = useBeRange();
  return (
    <section className="glass-panel overflow-hidden rounded-2xl" aria-label={t("review.day.aria", { date: fmtDayLong(day.date) })}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 basis-full flex-wrap items-center gap-x-4 gap-y-1 text-left sm:basis-0"
        >
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-[var(--dur-2)] ease-[var(--ease)]", !expanded && "-rotate-90")} aria-hidden="true" />
          <span className="w-[112px] shrink-0">
            <span className="block text-sm font-semibold text-foreground">{fmtDayLong(day.date)}</span>
            <span className="block text-xs tabular-nums text-muted-foreground">{day.firstAt && day.lastAt ? `${day.firstAt}–${day.lastAt}` : t("review.day.timeUnknown")}</span>
          </span>
          <span className={cn("ml-auto shrink-0 text-right text-lg font-semibold tabular-nums sm:ml-0 sm:w-[96px]", moneyText(day.net, beRange))}>
            {fmtUsd(day.net, { signed: true, decimals: "auto" })}
          </span>
          <Sparkline data={curve} baseline={0} tone={toneOf(day.net)} width={120} height={30} className="hidden shrink-0 sm:block" ariaLabel={t("review.day.curveAria")} />
          <span className="flex min-w-0 basis-full flex-wrap items-center gap-x-4 gap-y-1 pl-8 text-sm text-muted-foreground sm:basis-auto sm:pl-0">
            <span className="tabular-nums"><span className="text-foreground">{num(day.count)}</span> {commonI18n.t("units.tradesWord", { count: day.count })}</span>
            <span className="tabular-nums">WR <span className="text-foreground">{fmtRate(day.winRate)}</span>{closed ? ` · ${day.wins}/${day.losses}` : ""}</span>
            {day.fees != null && day.fees > 0 && (
              <span className="tabular-nums" title={t("review.day.feesTitle")}>
                {t("review.day.feesShort")} <span className="text-foreground">{fmtUsd(day.fees, { signed: true, decimals: "auto" }).replace("+", "")}</span>
                {feeShare != null && <span className={cn(feeShare.share > 0.5 && "text-warn")}> · {feeShare.text}</span>}
              </span>
            )}
            {day.rCount > 0 && <span className="tabular-nums" title={t("review.rGrossTitle")}>{t("review.day.rGross", { r: fmtR(day.totalR, 1) })}</span>}
          </span>
        </button>
        {day.untagged > 0 && <Pill tone="warn" title={t("review.day.untaggedTitle")} className="shrink-0 whitespace-nowrap">{t("review.day.untagged", { count: day.untagged })}</Pill>}
        <Button asChild variant="ghost" size="sm" className="shrink-0 gap-1.5 text-muted-foreground">
          <Link href={links.dayReport(day.date, trader ?? undefined)}><FileText className="h-3.5 w-3.5" aria-hidden="true" /> {t("review.day.report")}</Link>
        </Button>
      </div>
      {expanded && <div className="border-t border-[var(--glass-border)]">{children}</div>}
    </section>
  );
}
