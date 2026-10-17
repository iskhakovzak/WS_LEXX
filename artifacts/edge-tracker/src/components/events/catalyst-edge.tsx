// «Катализаторы» → «Как я торгую»: the trader's results on macro days vs ordinary days, and on the earnings
// reaction days of their most traded tickers. Everything is computed from the trader's own closed trades.
import * as React from "react";
import { Link } from "wouter";
import { ChevronDown, Info, Megaphone, Scale } from "lucide-react";
import { EmptyState, Panel, Pill, SortableTh, StatCard, StatGrid, toneOf, toneText, useTableSort } from "@/components/ds";
import { Skeleton } from "@/components/ui/skeleton";
import { links } from "@/lib/links";
import { cn } from "@/lib/utils";
import { pooledEarnings, takeaway, type CategoryEdge, type EarningsEdge } from "./catalyst-math";
import { fmtUsd } from "@/lib/format";
import { commonI18n } from "@/i18n/ns/common";
import { edgesFrom, useHistories, type CatalystData, type MyEarnings } from "./use-catalysts";
import { verdictLabel, verdictTone } from "./catalyst-today";
import { fmtDay } from "./event-meta";

const EARNINGS_TICKERS = 8;

type EdgeKey = "label" | "days" | "net" | "delta" | "green" | "wr" | "tpd";
const EDGE_ACCESSORS: Record<EdgeKey, (r: CategoryEdge) => number | string | null> = {
  label: (r) => r.label,
  days: (r) => r.agg.days,
  net: (r) => r.agg.avgNetDay,
  delta: (r) => r.delta,
  green: (r) => r.agg.greenPct,
  wr: (r) => r.agg.winRate,
  tpd: (r) => r.agg.avgTradesDay,
};

type EarnKey = "ticker" | "gap" | "range" | "up" | "event" | "other";
const EARN_ACCESSORS: Record<EarnKey, (e: EarningsEdge) => number | string | null> = {
  ticker: (e) => e.ticker,
  gap: (e) => e.avgAbsGap,
  range: (e) => e.avgRange,
  up: (e) => e.upShare,
  event: (e) => (e.event.trades ? e.event.net : null),
  other: (e) => (e.other.trades ? e.other.avgNetTrade : null),
};

export function EdgeView({ data, onOpenTicker }: { data: CatalystData; onOpenTicker: (e: Pick<MyEarnings, "ticker"> & Partial<MyEarnings>) => void }) {
  const { edge, trades } = data;
  const [open, setOpen] = React.useState<string | null>(null);
  const { rows: edgeRows, thProps } = useTableSort(edge.rows, EDGE_ACCESSORS, "days");

  if (trades.isLoading || data.holidays.isLoading) {
    return (
      <div className="flex flex-col gap-[var(--grid-gap)]">
        <StatGrid cols={3}>{[0, 1, 2].map((i) => <StatCard key={i} label="…" value="" loading />)}</StatGrid>
        <Skeleton className="h-72 w-full rounded-2xl" />
      </div>
    );
  }
  if (!edge.all.days) {
    return (
      <Panel>
        <EmptyState icon={Scale} title="Пока нечего сравнивать" description="Когда появятся закрытые сделки, здесь будет видно, как вы торгуете в дни CPI, FOMC, экспираций и отчётов." />
      </Panel>
    );
  }

  const scored = edge.rows.filter((r) => r.agg.days >= 3 && r.delta != null);
  const worst = [...scored].sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0))[0];
  const best = [...scored].sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0))[0];

  return (
    <div className="flex flex-col gap-[var(--grid-gap)]">
      <StatGrid cols={3}>
        <StatCard
          label="Обычный день"
          value={`${fmtUsd(edge.baseline.avgNetDay, { signed: true })}/день`}
          tone={toneOf(edge.baseline.avgNetDay)}
          hint={`${commonI18n.t("units.days", { count: edge.baseline.days })} без макро · WR ${edge.baseline.winRate ?? "—"}%`}
        />
        <StatCard
          label="Слабее всего"
          value={worst && (worst.delta ?? 0) < 0 ? worst.label : "—"}
          hint={worst && (worst.delta ?? 0) < 0 ? `${fmtUsd(worst.delta, { signed: true })}/день к обычному · ${verdictLabel(worst.verdict)}` : "нет дней хуже обычных"}
        />
        <StatCard
          label="Сильнее всего"
          value={best && (best.delta ?? 0) > 0 ? best.label : "—"}
          hint={best && (best.delta ?? 0) > 0 ? `${fmtUsd(best.delta, { signed: true })}/день к обычному · ${verdictLabel(best.verdict)}` : "нет дней лучше обычных"}
        />
      </StatGrid>

      <Panel
        icon={Scale}
        title="Макро-дни против обычных"
        description={`Ваши закрытые сделки ${edge.from ? fmtDay(edge.from, "medium") : ""} — ${edge.to ? fmtDay(edge.to, "medium") : ""}, net после комиссий`}
        padded={false}
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-[var(--glass-border)] text-left text-xs text-muted-foreground [&>th]:whitespace-nowrap">
                <SortableTh {...thProps("label")} className="px-[var(--panel-p)] py-2 font-medium">Тип дня</SortableTh>
                <SortableTh {...thProps("days")} align="right" className="px-2 py-2 font-medium">Торговали</SortableTh>
                <SortableTh {...thProps("net")} align="right" className="px-2 py-2 font-medium">Net / день</SortableTh>
                <SortableTh {...thProps("delta")} align="right" className="px-2 py-2 font-medium">К обычному</SortableTh>
                <SortableTh {...thProps("green")} align="right" className="px-2 py-2 font-medium">Зелёных дней</SortableTh>
                <SortableTh {...thProps("wr")} align="right" className="px-2 py-2 font-medium">WR</SortableTh>
                <SortableTh {...thProps("tpd")} align="right" className="px-2 py-2 font-medium">Сделок / день</SortableTh>
                <th className="px-[var(--panel-p)] py-2 font-medium">Вывод</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-[var(--glass-border)] bg-[var(--glass-bg)]">
                <td className="px-[var(--panel-p)] py-2.5 font-medium text-foreground">Обычные дни</td>
                <td className="px-2 py-2.5 text-right tabular-nums text-muted-foreground">{edge.baseline.days}</td>
                <td className={cn("px-2 py-2.5 text-right font-medium tabular-nums", toneText(toneOf(edge.baseline.avgNetDay)))}>{fmtUsd(edge.baseline.avgNetDay, { signed: true })}</td>
                <td className="px-2 py-2.5 text-right text-muted-foreground">—</td>
                <td className="px-2 py-2.5 text-right tabular-nums">{edge.baseline.greenPct ?? "—"}%</td>
                <td className="px-2 py-2.5 text-right tabular-nums">{edge.baseline.winRate ?? "—"}%</td>
                <td className="px-2 py-2.5 text-right tabular-nums">{edge.baseline.avgTradesDay ?? "—"}</td>
                <td className="px-[var(--panel-p)] py-2.5 text-xs text-muted-foreground">база сравнения: торговые дни без событий календаря</td>
              </tr>
              {edgeRows.map((r) => (
                <EdgeRow key={r.key} r={r} base={edge.baseline} open={open === r.key} onToggle={() => setOpen((o) => (o === r.key ? null : r.key))} data={data} />
              ))}
            </tbody>
          </table>
        </div>
        <p className="flex items-start gap-1.5 px-[var(--panel-p)] py-3 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          «Устойчиво» — разница со средним обычного дня больше двух стандартных ошибок (t-тест Уэлча), «похоже» — больше 1.3, иначе это шум. Меньше 5 дней — только наблюдение.
          FOMC — только день решения. Нажмите строку, чтобы увидеть сами дни.
        </p>
      </Panel>

      <EarningsEdgePanel data={data} onOpenTicker={onOpenTicker} />
    </div>
  );
}

function EdgeRow({ r, base, open, onToggle, data }: { r: CategoryEdge; base: CatalystData["edge"]["baseline"]; open: boolean; onToggle: () => void; data: CatalystData }) {
  const a = r.agg;
  const vt = verdictTone(r);
  return (
    <>
      <tr
        className={cn("cursor-pointer border-b border-[var(--glass-border)] transition-colors duration-[var(--dur-1)] hover:bg-[var(--glass-hover-bg)]", open && "bg-[var(--glass-hover-bg)]")}
        onClick={onToggle}
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
        aria-expanded={open}
      >
        <td className="px-[var(--panel-p)] py-2.5">
          <span className="flex items-center gap-1.5 whitespace-nowrap font-medium text-foreground" title={r.hint}>
            <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform duration-[var(--dur-1)]", open && "rotate-180")} aria-hidden="true" />
            {r.label}
          </span>
        </td>
        <td className="px-2 py-2.5 text-right tabular-nums text-muted-foreground">{a.days} из {r.calendarDays}</td>
        <td className={cn("px-2 py-2.5 text-right font-medium tabular-nums", toneText(toneOf(a.avgNetDay)))}>{fmtUsd(a.avgNetDay, { signed: true })}</td>
        <td className="px-2 py-2.5 text-right tabular-nums">{r.delta != null ? <span className={toneText(r.verdict === "robust" || r.verdict === "maybe" ? toneOf(r.delta) : "neutral")}>{fmtUsd(r.delta, { signed: true })}</span> : "—"}</td>
        <td className="px-2 py-2.5 text-right tabular-nums">{a.greenPct != null ? `${a.greenPct}%` : "—"}</td>
        <td className="px-2 py-2.5 text-right tabular-nums">{a.winRate != null ? `${a.winRate}%` : "—"}</td>
        <td className="px-2 py-2.5 text-right tabular-nums">{a.avgTradesDay ?? "—"}</td>
        <td className="px-[var(--panel-p)] py-2.5">
          <span className="flex items-center gap-2">
            <Pill tone={vt} className="shrink-0">{verdictLabel(r.verdict)}</Pill>
            <span className="text-xs text-muted-foreground">{takeaway(r, base)}</span>
          </span>
        </td>
      </tr>
      {open && (
        <tr className="border-b border-[var(--glass-border)]">
          <td colSpan={8} className="px-[var(--panel-p)] py-3">
            {r.dates.length ? (
              <div className="flex flex-wrap gap-1.5">
                {r.dates.map((d) => {
                  const s = data.book.get(d);
                  return (
                    <Link
                      key={d}
                      href={links.journalDay(d)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--glass-bg)] px-2 py-1 text-xs hover:bg-[var(--glass-hover-bg)]"
                      title="Открыть день в журнале"
                    >
                      <span className="tabular-nums text-muted-foreground">{fmtDay(d)}</span>
                      {s ? <span className={cn("font-medium tabular-nums", toneText(toneOf(s.net)))}>{fmtUsd(s.net, { signed: true, decimals: 0 })}</span> : <span className="text-muted-foreground">не торговали</span>}
                    </Link>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">В вашем периоде таких дней не было.</p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function EarningsEdgePanel({ data, onOpenTicker }: { data: CatalystData; onOpenTicker: (e: Pick<MyEarnings, "ticker"> & Partial<MyEarnings>) => void }) {
  const tickers = React.useMemo(() => data.frequent.slice(0, EARNINGS_TICKERS).map((f) => f.ticker), [data.frequent]);
  const hist = useHistories(tickers);
  const edges = React.useMemo(() => edgesFrom(data.tradeRows, tickers, hist.map), [data.tradeRows, tickers, hist.map]);
  const pooled = React.useMemo(() => pooledEarnings(edges), [edges]);
  const nextReport = React.useMemo(() => {
    const m = new Map<string, MyEarnings>();
    for (const [, list] of [...data.earningsByDate.entries()].sort((a, b) => a[0].localeCompare(b[0]))) for (const e of list) if (!m.has(e.ticker)) m.set(e.ticker, e);
    return m;
  }, [data.earningsByDate]);
  const missing = tickers.filter((t) => !edges.some((e) => e.ticker === t));
  const { rows: sortedEdges, thProps } = useTableSort(edges, EARN_ACCESSORS, "event");

  return (
    <Panel
      icon={Megaphone}
      title="Отчёты ваших тикеров"
      description={`${EARNINGS_TICKERS} самых торгуемых: обычная реакция цены на отчёт и ваши сделки в день реакции`}
      padded={false}
    >
      {pooled.trades > 0 && (
        <p className="px-[var(--panel-p)] pb-1 pt-3 text-sm text-foreground">
          В дни реакции на отчёт вы сделали {pooled.trades} сд. за {commonI18n.t("units.days", { count: pooled.days })}:{" "}
          <span className={cn("font-semibold tabular-nums", toneText(toneOf(pooled.net)))}>{fmtUsd(pooled.net, { signed: true })}</span>, в среднем{" "}
          <span className="tabular-nums">{fmtUsd(pooled.avgNetTrade, { signed: true })}</span> на сделку против{" "}
          <span className="tabular-nums">{fmtUsd(pooled.otherAvgNetTrade, { signed: true })}</span> в те же тикеры в обычные дни.
          {pooled.sample !== "ok" && <span className="text-muted-foreground"> Выборка маленькая — наблюдение, не правило.</span>}
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-[var(--glass-border)] text-left text-xs text-muted-foreground [&>th]:whitespace-nowrap">
              <SortableTh {...thProps("ticker")} className="px-[var(--panel-p)] py-2 font-medium">Тикер</SortableTh>
              <SortableTh {...thProps("gap")} align="right" className="px-2 py-2 font-medium">Ср. |гэп|</SortableTh>
              <SortableTh {...thProps("range")} align="right" className="px-2 py-2 font-medium">Ср. диапазон</SortableTh>
              <SortableTh {...thProps("up")} align="right" className="px-2 py-2 font-medium">Закрылся выше</SortableTh>
              <SortableTh {...thProps("event")} align="right" className="px-2 py-2 font-medium">Вы в день реакции</SortableTh>
              <SortableTh {...thProps("other")} align="right" className="px-2 py-2 font-medium">Вы в обычные дни</SortableTh>
              <th className="px-[var(--panel-p)] py-2 text-right font-medium">Следующий отчёт</th>
            </tr>
          </thead>
          <tbody>
            {sortedEdges.map((e) => {
              const nx = nextReport.get(e.ticker);
              return (
                <tr
                  key={e.ticker}
                  className="cursor-pointer border-b border-[var(--glass-border)] hover:bg-[var(--glass-hover-bg)]"
                  onClick={() => onOpenTicker(nx ?? { ticker: e.ticker })}
                >
                  <td className="px-[var(--panel-p)] py-2.5 font-semibold text-foreground">{e.ticker}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{e.avgAbsGap != null ? `${e.avgAbsGap.toFixed(1)}%` : "—"}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{e.avgRange != null ? `${e.avgRange.toFixed(1)}%` : "—"}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-muted-foreground">{e.upShare != null ? `${e.upShare}% (${e.reactions.length} кв.)` : "—"}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">
                    {e.event.trades ? (
                      <span><span className={toneText(toneOf(e.event.net))}>{fmtUsd(e.event.net, { signed: true })}</span> <span className="text-muted-foreground">· {e.event.trades} сд.{e.event.winRate != null ? ` · WR ${e.event.winRate}%` : ""}</span></span>
                    ) : <span className="text-muted-foreground">не торговали</span>}
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums">
                    {e.other.trades ? <span>{fmtUsd(e.other.avgNetTrade, { signed: true })}<span className="text-muted-foreground">/сд. · {e.other.trades} сд.</span></span> : "—"}
                  </td>
                  <td className="px-[var(--panel-p)] py-2.5 text-right tabular-nums text-muted-foreground">{nx ? `${fmtDay(nx.date)} · ${nx.callType === "AMC" ? "после закрытия" : nx.callType === "BMO" ? "до открытия" : "время ?"}` : "—"}</td>
                </tr>
              );
            })}
            {hist.loading > 0 && Array.from({ length: Math.min(hist.loading, 3) }).map((_, i) => (
              <tr key={`sk-${i}`} className="border-b border-[var(--glass-border)]"><td colSpan={7} className="px-[var(--panel-p)] py-2.5"><Skeleton className="h-4 w-full" /></td></tr>
            ))}
          </tbody>
        </table>
      </div>
      {missing.length > 0 && hist.loading === 0 && (
        <p className="px-[var(--panel-p)] py-3 text-xs text-muted-foreground">
          Без истории отчётов: {missing.join(", ")} — фонды/ETF не отчитываются, либо источник недоступен.
        </p>
      )}
      {edges.length > 0 && (
        <p className="px-[var(--panel-p)] pb-3 text-xs text-muted-foreground">
          Гэп — открытие дня реакции к закрытию накануне, диапазон — high/low дня реакции. Нажмите строку — история кварталов.
        </p>
      )}
    </Panel>
  );
}
