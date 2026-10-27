import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { Link } from "wouter";
import { useSearchParam } from "@/hooks/use-search-param";
import { Button } from "@/components/ui/button";
import { Panel, Pill, toneOf } from "@/components/ds";
import { HeatCalendar, type HeatDay, type HeatWeek } from "@/components/shared/charts";
import { cn } from "@/lib/utils";
import { PERIOD_HINT, dayHref, weekHref } from "@/lib/period-links";
import { fmtMetricCompact, fmtValue, heatBg, parseKey, rCoverage, toKey, weekdayLabel, type DayStat, type Metric } from "./metrics";
import { TradeLinkRow } from "./trade-link-row";
import { fmtDate, fmtMonth } from "@/lib/format";
import { commonI18n } from "@/i18n/ns/common";
import { statsI18n } from "@/i18n/ns/stats";
import { chartsI18n } from "@/i18n/ns/charts";

/** «Октябрь» / «October»: stand-alone month name with a capital letter (calendar header). */
const monthTitle = (m: number) => {
  const s = fmtMonth(m, "long");
  return s.charAt(0).toUpperCase() + s.slice(1);
};
/** Mon–Fri column heads in the UI language (weekdayLabel takes a Monday-first index). */
const head = () => [0, 1, 2, 3, 4].map(weekdayLabel);

type Month = { y: number; m: number };
const monthOf = (k: string): Month => ({ y: Number(k.substring(0, 4)), m: Number(k.substring(5, 7)) - 1 });
const addMonth = (a: Month, n: number): Month => {
  const d = new Date(a.y, a.m + n, 1);
  return { y: d.getFullYear(), m: d.getMonth() };
};
const cmp = (a: Month, b: Month) => a.y * 12 + a.m - (b.y * 12 + b.m);

/**
 * Month P&L calendar (TradeZella-style): Mon–Fri cells tinted by the day's result + weekly totals column.
 * Weekend trades are folded into the week total. Click a day to list its trades (and open its «Разбор дня»);
 * the week total opens the weekly review.
 */
export function CalendarPanel({ days, metric, trader, hideTrader }: {
  days: DayStat[]; metric: Metric; trader?: string | null;
  /** One person's report — the day list doesn't repeat the name (MAKSIM-37). */
  hideTrader?: boolean;
}) {
  const { t } = statsI18n.useT();
  const byKey = useMemo(() => new Map(days.map((d) => [d.key, d])), [days]);
  const latest = days.at(-1)?.key;
  const first = days[0]?.key;
  const [month, setMonth] = useState<Month>(() => (latest ? monthOf(latest) : monthOf(toKey(new Date()))));
  // The opened day rides in ?day= (kept on reload while it is in the data set).
  const [dayParam, setDayParam] = useSearchParam("day", "");
  const selected = dayParam || null;
  const setSelected = (u: string | null | ((cur: string | null) => string | null)) => setDayParam(typeof u === "function" ? u(selected) : u);

  // Jump to the latest month with trades whenever the dataset changes (period/trader switch) — or to the linked day.
  useEffect(() => {
    if (dayParam && byKey.has(dayParam)) { setMonth(monthOf(dayParam)); return; }
    setMonth(latest ? monthOf(latest) : monthOf(toKey(new Date())));
    if (days.length) setDayParam(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest, first]);

  const weeks = useMemo(() => {
    const start = new Date(month.y, month.m, 1);
    const offset = (start.getDay() + 6) % 7; // Monday-based
    const gridStart = new Date(month.y, month.m, 1 - offset);
    const rows: { days: Date[] }[] = [];
    for (let w = 0; w < 6; w++) {
      const row: Date[] = [];
      for (let i = 0; i < 7; i++) row.push(new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + w * 7 + i));
      if (w > 0 && row[0].getMonth() !== month.m) break;
      rows.push({ days: row });
    }
    return rows;
  }, [month]);

  const monthDays = days.filter((d) => d.key.startsWith(`${month.y}-${String(month.m + 1).padStart(2, "0")}`));
  const monthValue = monthDays.reduce<number | null>((s, d) => (d.value == null ? s : (s ?? 0) + d.value), null);
  const monthCount = monthDays.reduce((s, d) => s + d.count, 0);
  const max = Math.max(0, ...monthDays.map((d) => Math.abs(d.value ?? 0)));
  const sel = selected ? byKey.get(selected) : undefined;
  const rCov = rCoverage(monthDays);

  const heatWeeks: HeatWeek[] = weeks.map((w) => {
    const all = w.days.map((d) => byKey.get(toKey(d))).filter((x): x is DayStat => !!x);
    const wVal = all.reduce<number | null>((s, d) => (d.value == null ? s : (s ?? 0) + d.value), null);
    const wCnt = all.reduce((s, d) => s + d.count, 0);
    const weekLabel = `${t("calendar.weekLabel", { trades: commonI18n.t("units.trades", { count: wCnt }) })}${wVal != null ? `, ${fmtValue(wVal, metric)}` : ""}`;
    return {
      key: toKey(w.days[0]),
      days: w.days.slice(0, 5).map((d): HeatDay => {
        const k = toKey(d);
        const inMonth = d.getMonth() === month.m;
        const stat = inMonth ? byKey.get(k) : undefined;
        const label = `${fmtDate(d, "dayMonthLong")}: ${stat ? `${commonI18n.t("units.trades", { count: stat.count })}${stat.value != null ? `, ${fmtValue(stat.value, metric)}` : ""}` : t("calendar.noTrades")}`;
        const wl = stat ? stat.wins - stat.losses : 0;
        return {
          date: k,
          dayNum: d.getDate(),
          inMonth,
          traded: !!stat,
          value: stat?.value ?? null,
          fill: stat && stat.value == null ? heatBg(wl, Math.max(4, Math.abs(wl))) : undefined,
          valueText: stat ? (stat.value != null ? fmtMetricCompact(stat.value, metric) : `${stat.wins}/${stat.losses}`) : undefined,
          sub: stat ? commonI18n.t("units.tradesShort", { count: stat.count }) : undefined,
          label,
          tipTitle: fmtDate(d, "weekdayDayMonthLong"),
          tipRows: stat
            ? [
                { key: "v", name: chartsI18n.t("heat.result"), value: stat.value != null ? fmtValue(stat.value, metric) : "—", raw: stat.value },
                { key: "n", name: chartsI18n.t("heat.trades"), value: stat.count },
                { key: "wl", name: chartsI18n.t("heat.winLoss"), value: `${stat.wins} / ${stat.losses}` },
              ]
            : [{ key: "none", value: t("calendar.noTrades") }],
          active: selected === k,
          disabled: !stat,
        };
      }),
      total: {
        value: wVal,
        text: wCnt ? (wVal != null ? fmtMetricCompact(wVal, metric) : "—") : "",
        sub: wCnt > 0 ? commonI18n.t("units.tradesShort", { count: wCnt }) : undefined,
        label: wCnt > 0 ? `${weekLabel} — ${PERIOD_HINT.week.toLowerCase()}` : weekLabel,
        tipTitle: chartsI18n.t("heat.weekTotal"),
        tipRows: [
          { key: "v", name: chartsI18n.t("heat.result"), value: wVal != null ? fmtValue(wVal, metric) : "—", raw: wVal },
          { key: "n", name: chartsI18n.t("heat.trades"), value: wCnt },
        ],
        href: wCnt > 0 ? weekHref(toKey(w.days[0]), trader) : undefined,
        hrefTitle: PERIOD_HINT.week,
      },
    };
  });

  const minMonth = first ? monthOf(first) : month;
  const maxMonth = latest && cmp(monthOf(latest), monthOf(toKey(new Date()))) > 0 ? monthOf(latest) : monthOf(toKey(new Date()));

  return (
    <Panel
      title={t("calendar.title")}
      icon={CalendarDays}
      description={monthCount ? t("calendar.monthHint", { trades: commonI18n.t("units.trades", { count: monthCount }), days: t("kpi.tradingDays", { count: monthDays.length }) }) : t("calendar.noMonth")}
      actions={
        <div className="flex items-center gap-1">
          <Button
            variant="ghost" size="icon" className="h-8 w-8 rounded-full" aria-label={t("calendar.prev")}
            disabled={cmp(month, minMonth) <= 0} onClick={() => { setMonth((m) => addMonth(m, -1)); setSelected(null); }}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[7.5rem] text-center text-sm font-medium tabular-nums">{monthTitle(month.m)} {month.y}</span>
          <Button
            variant="ghost" size="icon" className="h-8 w-8 rounded-full" aria-label={t("calendar.next")}
            disabled={cmp(month, maxMonth) >= 0} onClick={() => { setMonth((m) => addMonth(m, 1)); setSelected(null); }}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      }
    >
      <HeatCalendar
        weeks={heatWeeks}
        weekdays={head()}
        max={max}
        phoneValues
        ariaLabel={t("calendar.aria", { month: `${monthTitle(month.m)} ${month.y}` })}
        onActivate={(k) => setSelected((cur) => (cur === k ? null : k))}
        legendExtra={<span>{t("calendar.clickHint")}</span>}
      />

      {metric === "r" && rCov.m > 0 && rCov.n < rCov.m && (
        <p className="mt-2 text-xs text-muted-foreground" data-testid="calendar-r-base">
          {t("calendar.rBase", { n: rCov.n, m: rCov.m })}
        </p>
      )}

      <div className="mt-3 text-xs text-muted-foreground">
        {t("calendar.monthTotal")}{" "}
        <span className={cn("font-semibold tabular-nums", toneOf(monthValue) === "up" ? "text-up" : toneOf(monthValue) === "down" ? "text-down" : "text-foreground")}>
          {fmtValue(monthValue, metric)}
        </span>
      </div>

      {sel && (
        <div className="mt-3 rounded-xl border border-[hsl(var(--border))] p-2">
          <div className="flex items-center justify-between gap-2 px-2 pb-1">
            <div className="text-sm font-medium">
              {fmtDate(parseKey(sel.key), "dayMonthLong")}
              <Pill tone={toneOf(sel.value)} className="ml-2">{sel.value != null ? fmtValue(sel.value, metric) : commonI18n.t("units.tradesShort", { count: sel.count })}</Pill>
            </div>
            <span className="flex items-center gap-1">
              <Button asChild variant="ghost" size="sm" className="h-8 rounded-full px-3 text-xs text-primary">
                <Link href={dayHref(sel.key, trader)}>{PERIOD_HINT.day} <ArrowRight aria-hidden="true" /></Link>
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" aria-label={t("calendar.closeDay")}
 onClick={() => setSelected(null)}>
                <X className="h-4 w-4" />
              </Button>
            </span>
          </div>
          <ul className="flex flex-col">
            {sel.trades.map((t) => <TradeLinkRow key={t.id} trade={t} metric={metric} showDate={false} hideTrader={hideTrader} />)}
          </ul>
        </div>
      )}
    </Panel>
  );
}
