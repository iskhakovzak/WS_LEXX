import { useId, useMemo, type ReactNode } from "react";
import type { Trade } from "@workspace/api-client-react";
import {
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { BAR_RADIUS, CHART, GRID, GlassTooltip, MARGIN, X_AXIS, Y_AXIS, barGradients, tooltipProps, useBarFocus, useChartMotion } from "@/components/shared/charts";
import { TrendingUp, TrendingDown, BarChart3, ArrowRight } from "lucide-react";
import { Panel, StatCard, StatGrid, EmptyState, Pill, toneOf, type Tone } from "@/components/ds";
import { type Unit, type DimensionKey, computeStats, rHistogram, realizedR, median, edgeLeaders, reliability } from "./metrics";
import { commonI18n } from "@/i18n/ns/common";
import { analyticsI18n } from "@/i18n/ns/analytics";
import { fmtCount, fmtNum, fmtR, fmtRate, fmtRatio, fmtUsd } from "@/lib/format";

export function OverviewTab({
  trades,
  previous,
  unit,
  onOpenDimension,
  reportLink,
}: {
  trades: Trade[];
  previous: Trade[] | null;
  unit: Unit | null;
  onOpenDimension: (d: DimensionKey) => void;
  /** The link card to /stats with the same slice (total, curve, calendar live there). */
  reportLink?: ReactNode;
}) {
  const { t } = analyticsI18n.useT();
  const motion = useChartMotion();
  const focus = useBarFocus();
  const gid = `ovh${useId().replace(/:/g, "")}`;
  const s = useMemo(() => computeStats(trades), [trades]);
  const p = useMemo(() => (previous && previous.length ? computeStats(previous) : null), [previous]);
  const hist = useMemo(() => rHistogram(trades), [trades]);
  const rValues = useMemo(() => trades.map(realizedR).filter((v): v is number => v != null), [trades]);
  const leaders = useMemo(() => edgeLeaders(trades, s.rN >= Math.max(3, s.n * 0.5)), [trades, s]);

  const isR = unit === "r";
  const fmt = (v: number | null | undefined) => (isR ? fmtR(v) : fmtUsd(v, { signed: true, decimals: "auto" }));
  const expectancy = isR ? s.avgR : s.avgPnl;
  const pf = isR ? s.pfR : s.pfPnl;
  const prevExp = p ? (isR ? p.avgR : p.avgPnl) : null;
  const rel = reliability(s.n);

  const delta = (cur: number | null | undefined, prev: number | null | undefined, kind: "pp" | "unit" | "count") => {
    if (cur == null || prev == null || !p) return {};
    const d = kind === "pp" ? Math.round((cur - prev) * 100) : cur - prev;
    if (kind !== "count" && Math.abs(d) < (kind === "pp" ? 1 : 0.01)) return { delta: t("overview.noChange"), deltaTone: "neutral" as Tone };
    const text = kind === "pp" ? commonI18n.t("units.percentPoints", { value: fmtNum(d, { decimals: 0, signed: true }) }) : kind === "count" ? fmtNum(d, { decimals: 0, signed: true }) : isR ? fmtR(d) : fmtUsd(d, { signed: true, decimals: "auto" });
    return { delta: text, deltaTone: (kind === "count" ? "neutral" : toneOf(d)) as Tone };
  };

  const payoff = s.avgWinR != null && s.avgLossR != null && s.avgLossR !== 0 ? s.avgWinR / Math.abs(s.avgLossR) : null;
  const rMean = rValues.length ? rValues.reduce((a, b) => a + b, 0) / rValues.length : null;
  const rMed = median(rValues);
  const bigWins = rValues.filter((v) => v >= 2).length;
  const be = s.be;
  const avgWin = isR ? s.avgWinR : s.avgWinPnl;
  const avgLoss = isR ? s.avgLossR : s.avgLossPnl;
  const payoffUnit = avgWin != null && avgLoss != null && avgLoss !== 0 ? avgWin / Math.abs(avgLoss) : payoff;
  const unitText = isR ? t("unit.r") : t("unit.usd");
  const tradesHint = [
    t("overview.tradesHint", { wins: s.wins, losses: s.losses }),
    be ? t("overview.beHint", { count: be }) : "",
    s.open ? t("overview.openHint", { count: s.open }) : "",
  ].filter(Boolean).join(" · ");

  return (
    <div className="flex flex-col gap-section">
      {/* Edge quality only: the period's total, curve, drawdown and streaks are the /stats report (the link below). */}
      <StatGrid className="grid-cols-2 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-4">
        <StatCard
          label={t("overview.trades")}
          value={fmtCount(s.n)}
          hint={tradesHint}
          {...delta(s.n, p?.n, "count")}
        />
        <StatCard
          label={commonI18n.t("trading.winRate")}
          value={s.decided ? fmtRate(s.winRate) : "—"}
          hint={s.decided ? t("overview.winRateHint", { lo: fmtRate(s.wrLow), hi: fmtRate(s.wrHigh) }) : t("overview.noClosed")}
          {...delta(s.decided ? s.winRate : null, p?.decided ? p.winRate : null, "pp")}
        />
        <StatCard
          label={isR ? t("overview.expectancyR") : t("overview.expectancyUsd")}
          value={unit ? fmt(expectancy) : "—"}
          tone={toneOf(expectancy)}
          hint={!unit ? t("overview.noUnit") : t("overview.perTrade", { reliability: rel.label.toLowerCase() })}
          {...delta(expectancy, prevExp, "unit")}
        />
        <StatCard
          label={t("overview.pf")}
          value={unit ? fmtRatio(pf) : "—"}
          tone={pf == null ? "neutral" : pf >= 1 ? "up" : "down"}
          hint={payoffUnit != null ? t("overview.payoff", { unit: unitText, value: fmtNum(payoffUnit) }) : pf != null ? (pf >= 1.5 ? t("overview.pfStrong") : pf >= 1 ? t("overview.pfPositive") : t("overview.pfNegative")) : unit ? t("overview.pfUndefined") : undefined}
        />
      </StatGrid>

      <div className="grid grid-cols-1 items-start gap-grid md:grid-cols-2 xl:grid-cols-3">
        <LeaderPanel
          title={t("overview.edgeTitle")}
          description={t("overview.edgeHint")}
          icon={TrendingUp}
          items={leaders.best}
          useR={s.rN >= Math.max(3, s.n * 0.5)}
          onOpenDimension={onOpenDimension}
          empty={t("overview.edgeEmpty")}
        />
        <LeaderPanel
          title={t("overview.weakTitle")}
          description={t("overview.weakHint")}
          icon={TrendingDown}
          items={leaders.worst}
          useR={s.rN >= Math.max(3, s.n * 0.5)}
          onOpenDimension={onOpenDimension}
          empty={t("overview.weakEmpty")}
        />
        <Panel icon={BarChart3} title={t("overview.rDist")} description={t("overview.rDistHint")} className="md:col-span-2 xl:col-span-1">
          {rValues.length > 0 ? (
            <div className="flex flex-col gap-3">
              <div className="h-[190px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={hist} margin={MARGIN} barCategoryGap={2} {...focus.chartProps}>
                    {barGradients(gid, CHART.up, CHART.down, false)}
                    <CartesianGrid {...GRID} />
                    <XAxis dataKey="label" {...X_AXIS} interval="preserveStartEnd" />
                    <YAxis {...Y_AXIS} width={32} allowDecimals={false} />
                    <Tooltip {...tooltipProps("bar")} content={<GlassTooltip />} formatter={(v: number) => [commonI18n.t("units.trades", { count: v }), t("overview.tradesCol")]} labelFormatter={(l) => `${l}R`} />
                    <Bar dataKey="count" radius={BAR_RADIUS} {...motion}>
                      {hist.map((b, i) => <Cell key={b.label} fill={`url(#${gid}-${b.tone === "up" ? "up" : "down"})`} fillOpacity={focus.opacity(i)} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <MiniStat label={t("overview.mean")} value={fmtR(rMean)} tone={toneOf(rMean)} />
                <MiniStat label={t("overview.median")} value={fmtR(rMed)} tone={toneOf(rMed)} />
                <MiniStat label="≥ +2R" value={fmtRate(rValues.length ? bigWins / rValues.length : null)} />
              </div>
            </div>
          ) : (
            <EmptyState icon={BarChart3} title={t("overview.noR")} description={t("overview.noRHint")} className="py-8" />
          )}
          <OutcomeBar wins={s.wins} losses={s.losses} be={be} />
        </Panel>
      </div>

      {reportLink}
    </div>
  );
}

function MiniStat({ label, value, tone = "neutral" }: { label: string; value: string; tone?: Tone }) {
  return (
    <div className="rounded-xl bg-[var(--glass-bg)] px-2 py-2">
      <div className="text-2xs text-muted-foreground">{label}</div>
      <div className={`text-sm font-semibold tabular-nums ${tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-foreground"}`}>{value}</div>
    </div>
  );
}

function OutcomeBar({ wins, losses, be }: { wins: number; losses: number; be: number }) {
  const { t } = analyticsI18n.useT();
  const n = wins + losses + be;
  if (!n) return null;
  const seg = [
    { k: "win", v: wins, cls: "bg-up" },
    { k: "be", v: be, cls: "bg-muted-foreground/50" },
    { k: "loss", v: losses, cls: "bg-down" },
  ].filter((x) => x.v > 0);
  return (
    <div className="mt-4 flex flex-col gap-1.5">
      <div className="micro-label">{t("overview.outcomes")}</div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-[var(--glass-bg)]" role="img" aria-label={t("overview.outcomesAria", { wins, be, losses })}>
        {seg.map((x) => <div key={x.k} className={x.cls} style={{ width: `${(x.v / n) * 100}%` }} />)}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground tabular-nums">
        <span><span className="text-up">●</span> {t("overview.win")} {wins}</span>
        {be > 0 && <span>● {t("overview.be")} {be}</span>}
        <span><span className="text-down">●</span> {t("overview.loss")} {losses}</span>
      </div>
    </div>
  );
}

type Leader = ReturnType<typeof edgeLeaders>["best"][number];

function LeaderPanel({
  title, description, icon, items, useR, onOpenDimension, empty,
}: {
  title: string;
  description: string;
  icon: typeof TrendingUp;
  items: Leader[];
  useR: boolean;
  onOpenDimension: (d: DimensionKey) => void;
  empty: string;
}) {
  return (
    <Panel title={title} description={description} icon={icon}>
      {items.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((it) => {
            const rel = reliability(it.n);
            return (
              <li key={`${it.dimKey}-${it.key}`}>
                <button
                  type="button"
                  onClick={() => onOpenDimension(it.dimKey)}
                  className="lift group flex w-full items-center gap-3 rounded-xl bg-[var(--glass-bg)] px-3 py-2.5 text-left"
                >
                  {/* The reliability pill sits on the dimension line: as a fourth column it squeezed the bucket itself to
                      «13:3…» in a half-width panel (1024 px, uz). The bucket may take two lines. */}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-2xs text-muted-foreground">{it.dim}</span>
                      <Pill tone={rel.level === "high" ? "up" : rel.level === "medium" ? "warn" : "neutral"} className="min-h-5 text-2xs">{rel.label}</Pill>
                    </div>
                    <div className="mt-0.5 line-clamp-2 text-sm font-medium leading-ui text-foreground" title={it.label}>{it.label}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className={`text-sm font-semibold tabular-nums ${useR ? (it.score >= 0 ? "text-up" : "text-down") : it.score >= 0.5 ? "text-up" : "text-down"}`}>
                      {useR ? fmtR(it.score) : fmtRate(it.score)}
                    </div>
                    <div className="text-2xs text-muted-foreground tabular-nums">
                      WR {fmtRate(it.stats.winRate)} · {commonI18n.t("units.tradesShort", { count: it.n })}
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
