/**
 * Агрегаты по сетапу: ожидание $ на сделку с 95% бутстрап-интервалом, win rate с интервалом Уилсона, PF, n.
 * n < 20 помечается — выводы ненадёжны. Вердикт учитывает интервал: «edge» только если весь интервал > 0.
 */
import * as React from "react";
import { Link } from "wouter";
import { ChevronDown, ChevronRight, ExternalLink, Layers } from "lucide-react";
import { DataTable, EmptyState, Pill, SortableTh, toneOf, toneText, useTableSort, type Tone } from "@/components/ds";
import { links } from "@/lib/links";
import { cn } from "@/lib/utils";
import { winRateTone, type SetupAggregate, type SetupTradeRef } from "./api";
import { fmtDate, fmtRate, fmtRatio, fmtUsd } from "@/lib/format";
import { commonI18n } from "@/i18n/ns/common";
import { behaviorI18n } from "@/i18n/ns/behavior";

const ACCESSORS = {
  setup: (r: SetupAggregate) => r.setup,
  n: (r: SetupAggregate) => r.n,
  winRate: (r: SetupAggregate) => r.winRate,
  net: (r: SetupAggregate) => r.net,
  expectancy: (r: SetupAggregate) => r.expectancy,
  profitFactor: (r: SetupAggregate) => r.profitFactor,
  avgConfidence: (r: SetupAggregate) => r.avgConfidence,
} as const;

function verdict(g: SetupAggregate, smallN: number): { label: string; tone: Tone; title: string } {
  const t = behaviorI18n.t;
  if (g.n < 5) return { label: t("aggregates.few"), tone: "neutral", title: t("aggregates.fewTitle") };
  const ci = g.expectancyCI;
  if (ci && ci.low > 0) return { label: t("aggregates.edge"), tone: "up", title: t("aggregates.edgeTitle") };
  if (ci && ci.high < 0) return { label: t("aggregates.leak"), tone: "down", title: t("aggregates.leakTitle") };
  if (g.expectancy != null && g.expectancy > 0) return { label: g.n < smallN ? t("aggregates.plusFew") : t("aggregates.plusNs"), tone: "neutral", title: t("aggregates.plusTitle") };
  if (g.expectancy != null && g.expectancy < 0) return { label: g.n < smallN ? t("aggregates.minusFew") : t("aggregates.minusNs"), tone: "neutral", title: t("aggregates.minusTitle") };
  return { label: t("aggregates.zero"), tone: "neutral", title: "" };
}

/** Горизонтальная шкала интервала: точка — оценка, полоса — 95% интервал, вертикаль — ноль. */
function CiBar({ value, ci, lo, hi }: { value: number | null; ci: { low: number; high: number } | null | undefined; lo: number; hi: number }) {
  if (value == null) return null;
  const span = hi - lo || 1;
  const pos = (v: number) => `${((Math.min(hi, Math.max(lo, v)) - lo) / span) * 100}%`;
  const tone = ci ? (ci.low > 0 ? "bg-up" : ci.high < 0 ? "bg-down" : "bg-muted-foreground") : "bg-muted-foreground";
  return (
    <span className="relative mt-1 block h-2 w-full min-w-[6rem]" aria-hidden="true">
      <span className="absolute inset-y-0 w-px bg-border" style={{ left: pos(0) }} />
      {ci && <span className={cn("absolute top-[3px] h-0.5 rounded-full opacity-60", tone)} style={{ left: pos(ci.low), right: `calc(100% - ${pos(ci.high)})` }} />}
      <span className={cn("absolute top-0 h-2 w-2 -translate-x-1/2 rounded-full", tone)} style={{ left: pos(value) }} />
    </span>
  );
}

/** /trades with exactly these trades (the server caps ?ids= at 4000 characters: no link past it). */
function allTradesHref(trades: readonly SetupTradeRef[], trader: string | null | undefined): string | null {
  const ids = trades.map((x) => x.id);
  return ids.length && ids.join(",").length <= 4000 ? links.trades({ ids, trader: trader || undefined }) : null;
}

/** The drill-down of a setup row: exactly the trades counted in it (date, ticker, side, net → the trade card). */
function SetupTrades({ g, trader }: { g: SetupAggregate; trader?: string | null }) {
  const t = behaviorI18n.t;
  const list = g.trades ?? [];
  const all = allTradesHref(list, trader);
  return (
    <div className="flex flex-col gap-2 py-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">{t("aggregates.drillTitle", { setup: g.setup, trades: commonI18n.t("units.trades", { count: list.length }) })}</p>
        {all && (
          <Link href={all} className="inline-flex min-h-8 items-center gap-1 rounded-full px-2 text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {t("aggregates.drillAll")} <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </Link>
        )}
      </div>
      <ul className="grid max-h-72 grid-cols-1 gap-0.5 overflow-y-auto sm:grid-cols-2 xl:grid-cols-3" aria-label={t("aggregates.drillAria", { setup: g.setup })}>
        {list.map((x) => (
          <li key={x.id}>
            <Link
              href={links.trade(x.id)}
              aria-label={t("aggregates.drillOpen", { ticker: x.ticker, date: fmtDate(x.date, "medium") })}
              className="flex min-h-9 items-center gap-2 rounded-lg px-2 text-xs transition-colors hover:bg-[var(--glass-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="w-12 shrink-0 tabular-nums text-muted-foreground">{fmtDate(x.date, "dayMonthNumeric")}</span>
              <span className="min-w-0 flex-1 truncate font-medium text-foreground">{x.ticker}</span>
              <span className="w-12 shrink-0 text-muted-foreground">{x.side === "short" ? commonI18n.t("trading.short") : x.side === "long" ? commonI18n.t("trading.long") : ""}</span>
              <span className={cn("w-20 shrink-0 text-right tabular-nums", toneText(toneOf(x.net)))}>{fmtUsd(x.net, { signed: true, decimals: "auto" })}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SetupsAggregates({ groups, covered, pending, smallSample = 20, trader }: { groups: SetupAggregate[]; covered: number; pending: number; smallSample?: number; trader?: string | null }) {
  const { rows, thProps } = useTableSort(groups, ACCESSORS, "net");
  const [open, setOpen] = React.useState<string | null>(null);
  const toggle = (setup: string) => setOpen((cur) => (cur === setup ? null : setup));
  const [lo, hi] = React.useMemo(() => {
    const xs = groups.flatMap((g) => (g.expectancyCI ? [g.expectancyCI.low, g.expectancyCI.high] : g.expectancy != null ? [g.expectancy] : []));
    const m = Math.max(1, ...xs.map(Math.abs));
    return [-m, m];
  }, [groups]);

  if (!groups.length) {
    return <EmptyState icon={Layers} title={behaviorI18n.t("aggregates.empty")} description={pending > 0 ? behaviorI18n.t("aggregates.emptyPending", { trades: commonI18n.t("units.trades", { count: pending }) }) : behaviorI18n.t("aggregates.emptyNone")} />;
  }
  return (
    <div className="flex flex-col gap-2">
      <DataTable maxHeight="56vh" ariaLabel={behaviorI18n.t("aggregates.aria")}>
        <table>
          <thead>
            <tr>
              <SortableTh {...thProps("setup")}>{behaviorI18n.t("aggregates.col.setup")}</SortableTh>
              <SortableTh {...thProps("n")} align="right">n</SortableTh>
              <SortableTh {...thProps("expectancy")} align="right">{behaviorI18n.t("aggregates.col.expectancy")}</SortableTh>
              <SortableTh {...thProps("winRate")} align="right">{behaviorI18n.t("aggregates.col.winRate")}</SortableTh>
              <SortableTh {...thProps("net")} align="right">{behaviorI18n.t("aggregates.col.net")}</SortableTh>
              <SortableTh {...thProps("profitFactor")} align="right">PF</SortableTh>
              <SortableTh {...thProps("avgConfidence")} align="right">{behaviorI18n.t("aggregates.col.confidence")}</SortableTh>
              <th scope="col">{behaviorI18n.t("aggregates.col.verdict")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => {
              const v = verdict(g, smallSample);
              const small = g.small ?? g.n < smallSample;
              const decided = g.wins + g.losses;
              const drill = !!g.trades?.length;
              const isOpen = drill && open === g.setup;
              return (
                <React.Fragment key={g.setup}>
                <tr
                  tabIndex={drill ? 0 : undefined}
                  aria-expanded={drill ? isOpen : undefined}
                  title={drill ? behaviorI18n.t("aggregates.rowToggle", { setup: g.setup }) : undefined}
                  onClick={drill ? (e) => { if (!(e.target as HTMLElement).closest("a")) toggle(g.setup); } : undefined}
                  onKeyDown={drill ? (e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); toggle(g.setup); } } : undefined}
                  className={cn(drill && "cursor-pointer transition-colors hover:bg-[var(--glass-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", isOpen && "bg-[var(--glass-hover-bg)]")}
                >
                  <td className="font-medium">
                    {drill && (isOpen ? <ChevronDown className="mr-1 inline h-3.5 w-3.5 align-[-2px] text-muted-foreground" aria-hidden="true" /> : <ChevronRight className="mr-1 inline h-3.5 w-3.5 align-[-2px] text-muted-foreground" aria-hidden="true" />)}
                    {g.accepted > 0 ? (
                      <Link href={links.trades({ setup: g.setup })} className="underline-offset-2 hover:underline" title={behaviorI18n.t("aggregates.acceptedTitle", { trades: commonI18n.t("units.trades", { count: g.accepted }) })}>{g.setup}</Link>
                    ) : g.setup}
                    {g.accepted > 0 && <span className="ml-1 text-xs font-normal text-muted-foreground">{behaviorI18n.t("aggregates.accepted", { count: g.accepted })}</span>}
                  </td>
                  <td className="text-right tabular-nums">
                    {g.n}
                    {small && <Pill tone="neutral" className="ml-1" title={behaviorI18n.t("aggregates.smallTitle", { n: smallSample })}>n&lt;{smallSample}</Pill>}
                  </td>
                  <td className="text-right tabular-nums" title={g.expectancyCI ? behaviorI18n.t("aggregates.bootCi", { lo: fmtUsd(g.expectancyCI.low, { signed: true, decimals: "auto" }), hi: fmtUsd(g.expectancyCI.high, { signed: true, decimals: "auto" }) }) : behaviorI18n.t("aggregates.noCi")}>
                    <span className={toneText(toneOf(g.expectancy))}>{fmtUsd(g.expectancy, { signed: true, decimals: "auto" })}</span>
                    {g.expectancyCI && <span className="ml-1 text-xs text-muted-foreground">[{fmtUsd(g.expectancyCI.low, { signed: true, compact: true })}; {fmtUsd(g.expectancyCI.high, { signed: true, compact: true })}]</span>}
                    <CiBar value={g.expectancy} ci={g.expectancyCI} lo={lo} hi={hi} />
                  </td>
                  <td className="text-right tabular-nums" title={g.winRateCI ? behaviorI18n.t("aggregates.wilson", { lo: fmtRate(g.winRateCI.low), hi: fmtRate(g.winRateCI.high) }) : undefined}>
                    <span className={toneText(winRateTone(g.winRate, decided))}>{fmtRate(g.winRate)}</span>
                    {g.winRateCI && <span className="ml-1 text-xs text-muted-foreground">[{fmtRate(g.winRateCI.low)}–{fmtRate(g.winRateCI.high)}]</span>}
                    <div className="text-xs text-muted-foreground">{g.wins}/{g.losses}{g.be ? `/${g.be}` : ""}</div>
                  </td>
                  <td className={cn("text-right tabular-nums", toneText(toneOf(g.net)))}>{fmtUsd(g.net, { signed: true, decimals: "auto" })}</td>
                  <td className="text-right tabular-nums" title={g.profitFactor == null ? behaviorI18n.t("aggregates.pfUndefined") : undefined}>{fmtRatio(g.profitFactor)}</td>
                  <td className="text-right tabular-nums">{g.avgConfidence == null ? "—" : `${Math.round(g.avgConfidence * 100)}%`}</td>
                  <td><Pill tone={v.tone} dot title={v.title}>{v.label}</Pill></td>
                </tr>
                {isOpen && (
                  <tr>
                    <td colSpan={8} className="bg-muted/10">
                      <SetupTrades g={g} trader={trader} />
                    </td>
                  </tr>
                )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </DataTable>
      <p className="text-xs text-muted-foreground">
        {behaviorI18n.t("aggregates.covered", { trades: commonI18n.t("units.trades", { count: covered }) })}{pending > 0 ? behaviorI18n.t("aggregates.notCovered", { count: pending }) : ""}{behaviorI18n.t("aggregates.footnote")}{groups.some((g) => g.trades?.length) ? ` ${behaviorI18n.t("aggregates.drillHint")}.` : ""}

      </p>
    </div>
  );
}
