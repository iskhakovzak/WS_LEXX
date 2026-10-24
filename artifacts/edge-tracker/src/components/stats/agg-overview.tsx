/**
 * «Обзор» of /analytics for staff (whole desk / another trader) from server sums — GET /api/stats/aggregate
 * (Волна 2 п. 2.5): the page does not download the raw trades of the desk for it. Same cards as OverviewTab (counts,
 * win rate with its 95% interval, expectancy, PF, average win / loss, total, max drawdown by day close, streaks), the
 * daily equity curve, the R distribution, the horizon split and the breakdown table of /stats. The per-trade tabs
 * (Edge, Что если, Монте-Карло, Психология, Pro) still load the trades when opened.
 */
import { useMemo } from "react";
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { ArrowRight, BarChart3 } from "lucide-react";
import { Panel, StatCard, StatGrid, EmptyState, toneOf, type Tone } from "@/components/ds";
import { EquityPanel } from "./equity-panel";
import { BAR_RADIUS, CHART, GRID, GlassTooltip, MARGIN, X_AXIS, Y_AXIS, tooltipProps, useChartMotion } from "@/components/shared/charts";
import { BreakdownPanel, type Dimension } from "./breakdown-panel";
import { HorizonPanel } from "./horizon-fees";
import {
  dailyEquity, daysOf, feesOf, field, groupStat, groupsOf, kpisFromAggregate, monthlyOf, type StatsAggregate,
} from "./aggregate";
import type { Horizon, HorizonFilter as StatsHorizon, Metric } from "./metrics";
import { commonI18n } from "@/i18n/ns/common";
import { analyticsI18n } from "@/i18n/ns/analytics";
import { fmtCount, fmtNum, fmtR, fmtRate, fmtRatio, fmtUsd } from "@/lib/format";

const HIST_MIN = -3;
/** /analytics units: signed R or net $. */
type Unit = "r" | "usd";

/** Wilson 95% interval for a proportion (analytics-page/metrics wilson). */
function wilson(wins: number, n: number): [number, number] {
  if (n === 0) return [0, 0];
  const z = 1.96;
  const p = wins / n;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (centre - margin) / denom), Math.min(1, (centre + margin) / denom)];
}

/** Sample label (analytics-page/metrics reliability): under 5 trades low, under 20 medium. */
const reliabilityLabel = (n: number): string => analyticsI18n.t(n < 5 ? "reliability.low" : n < 20 ? "reliability.medium" : "reliability.high");

export function AggOverview({
  agg, previous, unit, horizon, dimension, onDimension, onHorizon, onPickTrader, onOpenEdge,
}: {
  agg: StatsAggregate;
  previous: StatsAggregate | null;
  unit: Unit | null;
  /** "" = every horizon. */
  horizon: "" | Horizon;
  dimension: Dimension;
  onDimension: (d: Dimension) => void;
  onHorizon: (h: "" | Horizon) => void;
  onPickTrader?: (name: string) => void;
  /** Open the per-trade «Edge» tab. */
  onOpenEdge: () => void;
}) {
  const { t } = analyticsI18n.useT();
  const isR = unit === "r";
  const metric: Metric = isR ? "r" : "net";
  const motion = useChartMotion();
  const k = useMemo(() => kpisFromAggregate(agg, metric), [agg, metric]);
  const p = useMemo(() => (previous && field(previous.total, "n") ? kpisFromAggregate(previous, metric) : null), [previous, metric]);
  const days = useMemo(() => daysOf(agg, metric), [agg, metric]);
  const equity = useMemo(() => dailyEquity(days), [days]);
  const monthly = useMemo(() => monthlyOf(agg, metric), [agg, metric]);
  const fees = useMemo(() => feesOf(agg).fees, [agg]);
  const decided = k.wins + k.losses;
  const [lo, hi] = wilson(k.wins, decided);
  const relLabel = reliabilityLabel(k.total);
  const fmt = (v: number | null | undefined) => (isR ? fmtR(v) : fmtUsd(v, { signed: true, decimals: "auto" }));
  const unitText = isR ? t("unit.r") : t("unit.usd");
  const bins = agg.rHist?.bins ?? [];
  const rN = field(agg.total, "rN");
  const hist = bins.map((count, i) => {
    const b = i + HIST_MIN;
    const label = b === HIST_MIN ? `≤${fmtNum(HIST_MIN + 1, { decimals: 0, signed: true })}` : i === bins.length - 1 ? `≥+${b}` : `${fmtNum(b, { decimals: 0, signed: true })}…${fmtNum(b + 1, { decimals: 0, signed: true })}`;
    return { label, count, tone: b < 0 ? "down" : "up" };
  });

  const delta = (cur: number | null | undefined, prev: number | null | undefined, kind: "pp" | "unit" | "count") => {
    if (cur == null || prev == null || !p) return {};
    const d = kind === "pp" ? Math.round((cur - prev) * 100) : cur - prev;
    if (kind !== "count" && Math.abs(d) < (kind === "pp" ? 1 : 0.01)) return { delta: t("overview.noChange"), deltaTone: "neutral" as Tone };
    const text = kind === "pp" ? commonI18n.t("units.percentPoints", { value: fmtNum(d, { decimals: 0, signed: true }) }) : kind === "count" ? fmtNum(d, { decimals: 0, signed: true }) : fmt(d);
    return { delta: text, deltaTone: (kind === "count" ? "neutral" : toneOf(d)) as Tone };
  };
  const tradesHint = [
    t("overview.tradesHint", { wins: k.wins, losses: k.losses }),
    k.breakeven ? t("overview.beHint", { count: k.breakeven }) : "",
    k.open ? t("overview.openHint", { count: k.open }) : "",
  ].filter(Boolean).join(" · ");
  const pf = k.profitFactor;

  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      <StatGrid>
        <StatCard label={t("overview.trades")} value={fmtCount(k.total)} hint={tradesHint} {...delta(k.total, p?.total, "count")} />
        <StatCard
          label={commonI18n.t("trading.winRate")}
          value={decided ? fmtRate(k.winRate) : "—"}
          tone={decided ? ((k.winRate ?? 0) >= 0.5 ? "up" : "down") : "neutral"}
          hint={decided ? t("overview.winRateHint", { lo: fmtRate(lo), hi: fmtRate(hi) }) : t("overview.noClosed")}
          {...delta(decided ? k.winRate : null, p && p.wins + p.losses ? p.winRate : null, "pp")}
        />
        <StatCard
          label={isR ? t("overview.expectancyR") : t("overview.expectancyUsd")}
          value={unit ? fmt(k.expectancy) : "—"}
          tone={toneOf(k.expectancy)}
          hint={!unit ? t("overview.noUnit") : t("overview.perTrade", { reliability: relLabel.toLowerCase() })}
          {...delta(k.expectancy, p?.expectancy, "unit")}
        />
        <StatCard
          label={t("overview.pf")}
          value={unit ? fmtRatio(pf) : "—"}
          tone={pf == null ? "neutral" : pf >= 1 ? "up" : "down"}
          hint={pf != null ? (pf >= 1.5 ? t("overview.pfStrong") : pf >= 1 ? t("overview.pfPositive") : t("overview.pfNegative")) : unit ? t("overview.pfUndefined") : undefined}
        />
        <StatCard
          label={t("overview.avgWinLoss")}
          value={
            <span>
              <span className="text-up">{k.avgWin != null ? (isR ? fmtNum(k.avgWin, { decimals: 1, signed: true }) : fmtUsd(k.avgWin, { signed: true, decimals: "auto" })) : "—"}</span>
              <span className="text-muted-foreground"> / </span>
              <span className="text-down">{k.avgLoss != null ? (isR ? fmtNum(k.avgLoss, { decimals: 1, signed: true }) : fmtUsd(k.avgLoss, { signed: true, decimals: "auto" })) : "—"}</span>
            </span>
          }
          hint={k.payoff != null ? t("overview.payoff", { unit: unitText, value: fmtNum(k.payoff) }) : unitText}
        />
        <StatCard
          label={isR ? t("overview.totalR") : t("overview.totalUsd")}
          value={unit ? fmt(k.net) : "—"}
          tone={toneOf(k.net)}
          hint={unit ? (isR ? t("overview.baseR", { n: k.valued, m: k.closed }) : t("overview.overTrades", { count: k.valued })) : undefined}
        />
        <StatCard
          label={t("overview.maxDd")}
          value={k.maxDrawdown != null ? fmt(k.maxDrawdown) : "—"}
          tone={(k.maxDrawdown ?? 0) < 0 ? "down" : "neutral"}
          hint={t("overview.fromPeak")}
        />
        <StatCard
          label={t("overview.streaks")}
          value={<span><span className="text-up">{k.longestWin}</span><span className="text-muted-foreground"> / </span><span className="text-down">{k.longestLoss}</span></span>}
          hint={!k.current.kind || !k.current.len ? t("overview.streaksHint") : k.current.kind === "win" ? t("overview.streakNowWin", { count: k.current.len }) : t("overview.streakNowLoss", { count: k.current.len })}
        />
      </StatGrid>

      <EquityPanel equity={equity} monthly={monthly} metric={metric} daily />
      {!isR && fees.gross != null && fees.fees > 0 && (
        <p className="-mt-2 px-1 text-xs text-muted-foreground tabular-nums">
          {t("overview.beforeFees", { gross: fmtUsd(fees.gross, { signed: true, decimals: "auto" }) })} <span className="text-down">{fmtUsd(-Math.abs(fees.fees), { decimals: Math.abs(fees.fees) >= 100 ? 0 : 2 })}</span>
          {fees.gross > 0 && ` ${t("overview.feesShareOfGross", { share: fmtRate(fees.fees / fees.gross) })}`} {t("overview.afterFees", { net: fmtUsd(fees.net, { signed: true, decimals: "auto" }) })}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2">
        <Panel icon={BarChart3} title={t("overview.rDist")} description={t("overview.rDistHint")}>
          {rN > 0 ? (
            <div className="flex flex-col gap-3">
              <div className="h-[190px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={hist} margin={MARGIN} barCategoryGap={2}>
                    <CartesianGrid {...GRID} />
                    <XAxis dataKey="label" {...X_AXIS} interval="preserveStartEnd" />
                    <YAxis {...Y_AXIS} width={32} allowDecimals={false} />
                    <Tooltip {...tooltipProps("bar")} content={<GlassTooltip />} formatter={(v: number) => [commonI18n.t("units.trades", { count: v }), t("overview.tradesCol")]} labelFormatter={(l) => `${l}R`} />
                    <Bar dataKey="count" radius={BAR_RADIUS} {...motion}>
                      {hist.map((b) => <Cell key={b.label} fill={b.tone === "up" ? CHART.up : CHART.down} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center text-xs tabular-nums">
                <div className="rounded-xl bg-[var(--glass-bg)] px-2 py-2"><div className="text-2xs text-muted-foreground">{t("overview.mean")}</div><div className="text-sm font-semibold">{fmtR(field(agg.total, "r") / rN)}</div></div>
                <div className="rounded-xl bg-[var(--glass-bg)] px-2 py-2"><div className="text-2xs text-muted-foreground">{t("overview.median")}</div><div className="text-sm font-semibold">{fmtR(agg.rHist?.median ?? null)}</div></div>
                <div className="rounded-xl bg-[var(--glass-bg)] px-2 py-2"><div className="text-2xs text-muted-foreground">≥ +2R</div><div className="text-sm font-semibold">{fmtRate((agg.rHist?.big ?? 0) / rN)}</div></div>
              </div>
            </div>
          ) : (
            <EmptyState icon={BarChart3} title={t("overview.noR")} description={t("overview.noRHint")} className="py-8" />
          )}
        </Panel>
        <HorizonPanel
          groupsFor={(m) => (agg.horizonAll ? agg.horizonAll.map((g) => groupStat(g.key, g.b, m)) : groupsOf(agg, "horizon", m))}
          metric={metric}
          active={(horizon || "all") as StatsHorizon}
          onPick={(h) => onHorizon(h === "all" ? "" : h)}
        />
      </div>

      <BreakdownPanel groupsFor={(d, m) => groupsOf(agg, d, m)} metric={metric} dimension={dimension} onDimension={onDimension} onPickTrader={onPickTrader} />
      <button type="button" onClick={onOpenEdge} className="inline-flex items-center gap-1 self-start rounded-full px-2 text-xs text-primary hover:underline">
        {t("deskAgg.edgeLink")} <ArrowRight className="h-3 w-3" aria-hidden="true" />
      </button>
    </div>
  );
}
