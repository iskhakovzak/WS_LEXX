// Building blocks of the trades review page: KPI row, preset bar, trade row and the trading-day card.
import * as React from "react";
import { Link } from "wouter";
import type { Trade } from "@workspace/api-client-react";
import { ArrowDownWideNarrow, ArrowUpNarrowWide, BookOpen, ChevronDown, ChevronRight, FileText, X } from "lucide-react";
import { FilterChip, Pill, Segmented, Sparkline, StatCard, StatGrid, toneOf, toneText, type Tone } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TradeSparkline } from "@/components/chart-engine";
import { exitEffTone } from "@/components/replay/QualityBlock";
import { links } from "@/lib/links";
import { cn } from "@/lib/utils";
import type { TradeDay, TradesPageFacets, TradesPageSummary } from "@/hooks/use-trades-page";
import { fmtHold, fmtMoney, fmtPct, fmtR, holdSeconds, netPnl, plural, tradeWall, wallHm, type QualityMap, type SortConfig, type TradeQualityLite } from "./trade-utils";
import { PRESETS, PRESET_META, type Preset, type TagKind } from "./review-presets";
import { ReviewChips, type PickerTarget } from "./review-tagging";
import { SidePill } from "./trade-bits";
import { SortHead } from "./sort-head";
import type { TradesView } from "./use-trade-filters";

const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const WEEKDAYS = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

/** «Чт, 15 окт» (+ year when it is not the current one). */
export function fmtDayLong(d: string, withWeekday = true): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  if (!m) return d;
  const wd = WEEKDAYS[new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00Z`).getUTCDay()];
  const year = Number(m[1]) !== new Date().getFullYear() ? ` ${m[1]}` : "";
  return `${withWeekday ? `${wd}, ` : ""}${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}${year}`;
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
  const s = summary;
  const closed = s ? s.wins + s.losses + s.be : 0;
  const useR = !!s && closed > 0 && s.rCount / closed >= 0.5;
  const gross = s?.gross ?? null;
  const fees = s?.fees ?? null;
  const feeShare = gross != null && gross > 0 && fees != null ? fees / gross : null;
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
        label="Нетто"
        term="net"
        loading={loading}
        value={fmtMoney(s?.net ?? null)}
        tone={toneOf(s?.net ?? null)}
        hint={s ? `${s.total} ${plural(s.total, ["сделка", "сделки", "сделок"])}${perTrade != null ? ` · ${fmtMoney(perTrade)} на сделку` : ""}` : undefined}
        spark={dayCurve.length > 1 ? dayCurve : undefined}
      />
      <StatCard
        label="Win rate"
        term="winrate"
        loading={loading}
        value={fmtPct(s?.winRate ?? null)}
        hint={s ? `${s.wins} W · ${s.losses} L${s.be ? ` · ${s.be} в ноль` : ""}` : undefined}
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
            ? `ср. ${fmtR(s?.avgWinR ?? null, 2)} / ${fmtR(s?.avgLossR ?? null, 2)}`
            : `ср. ${fmtMoney(s?.avgWinNet ?? null)} / ${fmtMoney(s?.avgLossNet ?? null)}`
        }
      />
      <StatCard
        label={useR ? "Profit factor, R" : "Profit factor"}
        term="pf"
        loading={loading}
        value={pf != null ? pf.toFixed(2) : "—"}
        tone={pfTone}
        hint={useR ? undefined : s?.posNet != null ? `${fmtMoney(s.posNet)} / ${fmtMoney(-(s.negNet ?? 0))}` : undefined}
      />
      <StatCard
        label="Комиссии"
        term="fees"
        loading={loading}
        value={fees != null ? fmtMoney(-Math.abs(fees)).replace("−", "") : "—"}
        delta={feeShare != null ? `${Math.round(feeShare * 100)}% брутто` : undefined}
        deltaTone={feeShare != null && feeShare > 0.5 ? "warn" : "neutral"}
        hint={gross != null ? `брутто ${fmtMoney(gross)}` : undefined}
        onClick={() => onPreset("fees")}
      />
      <StatCard
        label="Без разбора"
        loading={loading}
        value={untagged}
        tone={untagged > 0 ? "warn" : "neutral"}
        hint={s ? (untagged ? `из ${closed} закрытых · разобрать →` : "все сделки размечены") : undefined}
        onClick={untagged ? () => onPreset("review") : undefined}
      />
    </StatGrid>
  );
}

// ── Preset bar ────────────────────────────────────────────────────────────────

const SORT_OPTIONS: { col: SortConfig["col"]; label: string }[] = [
  { col: "date", label: "По времени" },
  { col: "impact", label: "По сумме |$|" },
  { col: "pnl", label: "По нетто" },
  { col: "fees", label: "По комиссиям" },
  { col: "hold", label: "По удержанию" },
  { col: "ticker", label: "По тикеру" },
  { col: "entry", label: "По цене входа" },
  { col: "exitEff", label: "По захвату" },
  { col: "setup", label: "По сетапу" },
];

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
  const meta = preset ? PRESET_META[preset] : null;
  const listLike = view === "list" || !!preset;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          ariaLabel="Вид списка"
          size="sm"
          value={preset ? "list" : view}
          onChange={(v) => onView(v as TradesView)}
          options={[{ value: "days", label: "По дням" }, { value: "list", label: "Списком" }]}
        />
        <span className="mx-1 h-5 w-px bg-[var(--glass-border)]" aria-hidden="true" />
        <div role="group" aria-label="Умные подборки" className="flex flex-wrap items-center gap-1.5">
          {PRESETS.map((k) => {
            const n = counts?.[k];
            return (
              <FilterChip key={k} active={preset === k} onClick={() => onPreset(preset === k ? null : k)} count={n ?? undefined} className="min-h-7 px-2.5 text-xs">
                {PRESET_META[k].label}
              </FilterChip>
            );
          })}
        </div>
        {listLike && (
          <div className="ml-auto flex items-center gap-1">
            <Select value={sort.col} onValueChange={(v) => onSort({ col: v as SortConfig["col"], dir: sort.dir })}>
              <SelectTrigger className="h-8 w-[160px] text-xs" aria-label="Сортировка">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((o) => <SelectItem key={o.col} value={o.col}>{o.label}</SelectItem>)}
                {!SORT_OPTIONS.some((o) => o.col === sort.col) && <SelectItem value={sort.col}>{sort.col}</SelectItem>}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label={sort.dir === "desc" ? "По убыванию" : "По возрастанию"}
              title={sort.dir === "desc" ? "По убыванию" : "По возрастанию"}
              onClick={() => onSort({ col: sort.col, dir: sort.dir === "desc" ? "asc" : "desc" })}
            >
              {sort.dir === "desc" ? <ArrowDownWideNarrow className="h-4 w-4" /> : <ArrowUpNarrowWide className="h-4 w-4" />}
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
              <> <Link href={behaviorHref(trader)} className="whitespace-nowrap text-primary hover:underline">Паттерны в «Поведении» →</Link></>
            )}
          </p>
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="Закрыть подборку" onClick={() => onPreset(null)}><X className="h-4 w-4" /></Button>
        </div>
      )}
    </div>
  );
}

// ── Trade row ─────────────────────────────────────────────────────────────────

export const ROW_GRID = "grid grid-cols-[20px_116px_minmax(96px,0.6fr)_104px_140px_92px_minmax(200px,1.7fr)_20px] items-center gap-x-3";

function CaptureCell({ q, pending }: { q: TradeQualityLite | undefined; pending: boolean }) {
  if (!q) return <span className="text-xs text-muted-foreground">{pending ? "…" : "—"}</span>;
  if (q.status === "unavailable" || q.exitEfficiency == null) return <span className="text-xs text-muted-foreground" title="Нет баров для расчёта MFE">—</span>;
  const mfe = q.mfeR != null ? fmtR(q.mfeR, 1) : q.mfeUsd != null ? fmtMoney(q.mfeUsd) : null;
  return (
    <span className="flex flex-col leading-tight" title="Захвачено от максимального хода в вашу сторону (MFE). ≥ 60% — хороший выход.">
      <span className={cn("text-sm font-medium tabular-nums", toneText(exitEffTone(q.exitEfficiency)))}>{Math.round(q.exitEfficiency * 100)}%</span>
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
  const w = tradeWall(t);
  const hold = holdSeconds(t);
  const net = t.pnl != null ? netPnl(t) : null;
  const open = wallHm(w.open);
  return (
    <div
      role="row"
      data-trade-id={t.id}
      data-active={active || undefined}
      aria-selected={selected || undefined}
      onClick={() => { onFocusRow(t.id); onOpen(t); }}
      className={cn(
        ROW_GRID,
        "group relative min-h-[52px] cursor-pointer border-t border-[var(--glass-border)] px-3 py-1.5 transition-colors first:border-t-0 hover:bg-[var(--glass-hover-bg)]",
        active && "bg-[var(--glass-hover-bg)] shadow-[inset_2px_0_0_hsl(var(--primary))]",
        selected && "bg-primary/[0.07]",
        highlight && "animate-pulse",
      )}
    >
      <span onClick={(e) => e.stopPropagation()} className="flex items-center">
        <Checkbox
          checked={selected}
          aria-label={`Выбрать ${t.ticker}`}
          onClick={(e) => { e.stopPropagation(); onToggle(t.id, e.shiftKey); }}
          onCheckedChange={() => { /* handled in onClick (shift-range) */ }}
        />
      </span>
      <span className="flex flex-col leading-tight">
        <span className="text-sm tabular-nums text-foreground">
          {showDate ? fmtDayLong(t.date.slice(0, 10), false) : open ?? "—"}
        </span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {showDate ? (open ? `${open} · ${fmtHold(hold)}` : fmtHold(hold)) : fmtHold(hold)}
        </span>
      </span>
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="flex min-w-0 items-center gap-1.5">
          <button type="button" onClick={(e) => { e.stopPropagation(); onFocusRow(t.id); onOpen(t); }} className="truncate text-sm font-semibold text-foreground hover:underline">
            {t.ticker}
          </button>
          <SidePill side={t.side} compact />
        </span>
        {showTrader && t.trader && <span className="truncate text-xs text-muted-foreground">{t.trader}</span>}
        {!showTrader && t.qty != null && <span className="truncate text-xs tabular-nums text-muted-foreground">{t.qty.toLocaleString("en-US")} шт.</span>}
      </span>
      <span className="flex items-center" aria-hidden="true">
        <TradeSparkline trade={t} width={100} height={30} />
      </span>
      <span className="flex flex-col items-end leading-tight">
        <span className={cn("text-sm font-semibold tabular-nums", net == null ? "text-muted-foreground" : toneText(toneOf(net)))}>{fmtMoney(net)}</span>
        {t.fees ? <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground" title="Брутто · комиссии">{fmtMoney(t.pnl)} · ком. {fmtMoney(Math.abs(t.fees)).replace("+", "")}</span> : null}
      </span>
      <span className="flex justify-end">
        <CaptureCell q={quality[t.id]} pending={qualityPending} />
      </span>
      <ReviewChips trade={t} canTag={canTag} picker={picker} setPicker={setPicker} onPick={onPick} setupOptions={setupOptions} />
      {onAddToPlaybook ? (
        <button
          type="button"
          aria-label={`${t.ticker}: добавить в плейбук`}
          title="В плейбук — эталон сетапа"
          onClick={(e) => { e.stopPropagation(); onFocusRow(t.id); onAddToPlaybook(t); }}
          className={cn(
            "-mx-1.5 grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-opacity hover:bg-[var(--glass-hover-bg)] hover:text-primary focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:opacity-0 md:group-hover:opacity-100",
            active && "md:opacity-100",
          )}
        >
          <BookOpen className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : (
        <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
      )}
    </div>
  );
}

/**
 * Column headers. With `sort`/`onSort` (list mode, server-side sort) the headers are clickable and stay in sync with
 * the sort select in the preset bar; the day view keeps plain headers (trades go in time order within a day).
 */
export function RowsHeader({ showDate, sort, onSort }: { showDate: boolean; sort?: SortConfig; onSort?: (col: SortConfig["col"]) => void }) {
  const head = (col: SortConfig["col"], label: React.ReactNode, opts: { align?: "left" | "right"; title?: string } = {}) =>
    sort && onSort ? (
      <SortHead active={sort.col === col} dir={sort.dir} onSort={() => onSort(col)} align={opts.align} title={opts.title}>{label}</SortHead>
    ) : (
      <span role="columnheader" className={cn(opts.align === "right" && "text-right")} title={opts.title}>{label}</span>
    );
  return (
    <div role="row" className={cn(ROW_GRID, "border-b border-[var(--glass-border)] px-3 py-1.5 text-xs text-muted-foreground")}>
      <span />
      {sort && onSort && showDate ? (
        <span className="flex min-w-0 items-center gap-1">
          {head("date", "Дата")}
          {head("hold", "удерж.", { title: "Время удержания" })}
        </span>
      ) : (
        head("date", showDate ? "Дата" : "Вход · удержание")
      )}
      {head("ticker", "Тикер")}
      {head("entry", "Цена", { title: "Цена входа" })}
      {head("pnl", "Нетто", { align: "right" })}
      {head("exitEff", "Захват", { align: "right", title: "Эффективность выхода: захвачено / MFE" })}
      {head("setup", "Сетап · ошибки · эмоции")}
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
  const feeShare = day.gross != null && day.gross > 0 && day.fees != null ? day.fees / day.gross : null;
  const closed = day.wins + day.losses + day.be;
  return (
    <section className="glass-panel overflow-hidden rounded-2xl" aria-label={`Торговый день ${fmtDayLong(day.date)}`}>
      <div className="flex items-center gap-4 px-4 py-3">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-4 text-left"
        >
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", !expanded && "-rotate-90")} aria-hidden="true" />
          <span className="w-[112px] shrink-0">
            <span className="block text-sm font-semibold text-foreground">{fmtDayLong(day.date)}</span>
            <span className="block text-xs tabular-nums text-muted-foreground">{day.firstAt && day.lastAt ? `${day.firstAt}–${day.lastAt}` : "время неизвестно"}</span>
          </span>
          <span className={cn("w-[96px] shrink-0 text-right text-lg font-semibold tabular-nums", day.net == null ? "text-muted-foreground" : toneText(toneOf(day.net)))}>
            {fmtMoney(day.net)}
          </span>
          <Sparkline data={curve} baseline={0} tone={toneOf(day.net)} width={120} height={30} className="shrink-0" ariaLabel="Кривая дня по сделкам" />
          <span className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span className="tabular-nums"><span className="text-foreground">{day.count}</span> {plural(day.count, ["сделка", "сделки", "сделок"])}</span>
            <span className="tabular-nums">WR <span className="text-foreground">{fmtPct(day.winRate)}</span>{closed ? ` · ${day.wins}/${day.losses}` : ""}</span>
            {day.fees != null && day.fees > 0 && (
              <span className="tabular-nums" title="Комиссии дня и их доля в брутто">
                ком. <span className="text-foreground">{fmtMoney(day.fees).replace("+", "")}</span>
                {feeShare != null && <span className={cn(feeShare > 0.5 && "text-warn")}> · {Math.round(feeShare * 100)}%</span>}
              </span>
            )}
            {day.rCount > 0 && <span className="tabular-nums">{fmtR(day.totalR, 1)}</span>}
          </span>
        </button>
        {day.untagged > 0 && <Pill tone="warn" title="Закрытые сделки без сетапа, тегов и заметок">{day.untagged} без разбора</Pill>}
        <Button asChild variant="ghost" size="sm" className="shrink-0 gap-1.5 text-muted-foreground">
          <Link href={links.dayReport(day.date, trader ?? undefined)}><FileText className="h-3.5 w-3.5" /> Отчёт дня</Link>
        </Button>
      </div>
      {expanded && <div className="border-t border-[var(--glass-border)]">{children}</div>}
    </section>
  );
}
