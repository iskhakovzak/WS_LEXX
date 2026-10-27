/**
 * Profile analytics: key numbers, the equity curve, best / worst slices, the edge map and the style fingerprint.
 * All data comes with the profile response (one query); charts use the shared chart tokens.
 */
import * as React from "react";
import { Area, AreaChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";
import { Fingerprint, LineChart as LineIcon, Map as MapIcon, Sigma, Split, TrendingDown, TrendingUp } from "lucide-react";
import { Panel, StatCard, StatGrid, toneOf, toneText } from "@/components/ds";
import { ACTIVE_DOT, CHART, GRID, GlassTooltip, STROKE, X_AXIS, Y_AXIS, ZERO_LINE, pnlPaint, tooltipProps, useChartMotion } from "@/components/shared/charts";
import { EdgeVerdictList } from "@/components/shared/edge-map/edge-verdicts";
import { cn } from "@/lib/utils";
import { fmtDate, fmtRate, fmtRatio, fmtUsd } from "@/lib/format";
import { commonI18n } from "@/i18n/ns/common";
import { profileI18n } from "@/i18n/ns/profile";
import type { ProfileResponse, Slice, SliceSet, Style } from "./api";
import { holdText, styleGroups } from "./model";

export function KeyStats({ stats }: { stats: ProfileResponse["stats"] }) {
  const { t } = profileI18n.useT();
  const usd = (v: number | null, signed = true) => fmtUsd(v, { signed });
  return (
    <section aria-label={t("stats.title")}>
      <StatGrid min="10rem" cols={4}>
        <StatCard label={t("stats.net")} value={usd(stats.net)} tone={toneOf(stats.net)} icon={Sigma} />
        <StatCard label={t("stats.winRate")} value={fmtRate(stats.winRate)} hint={t("stats.greenDays", { green: stats.greenDays, days: stats.activeDays })} />
        <StatCard label={t("stats.profitFactor")} value={fmtRatio(stats.profitFactor)} />
        <StatCard label={t("stats.expectancy")} value={usd(stats.expectancy)} tone={toneOf(stats.expectancy)} />
        <StatCard label={t("stats.avgWin")} value={usd(stats.avgWin, false)} tone="up" />
        <StatCard label={t("stats.avgLoss")} value={usd(stats.avgLoss)} tone="down" />
        <StatCard label={t("stats.trades")} value={commonI18n.t("units.trades", { count: stats.trades })} hint={t("hero.activeDays", { count: stats.activeDays })} />
        <StatCard label={t("stats.maxDrawdown")} value={usd(stats.maxDrawdown, false)} />
      </StatGrid>
    </section>
  );
}

const shortDate = (d: string) => fmtDate(d, "dayMonthNumeric");

export function EquityPanel({ equity, className }: { equity: ProfileResponse["equity"]; className?: string }) {
  const { t } = profileI18n.useT();
  const motion = useChartMotion();
  const gid = "pe" + React.useId().replace(/[^a-zA-Z0-9]/g, "");
  const paint = pnlPaint(gid, equity.map((e) => e.cum));
  const last = equity[equity.length - 1];
  return (
    <Panel title={t("equity.title")} description={t("equity.description")} icon={LineIcon} className={className} fill>
      {equity.length < 2 ? (
        <p className="text-sm text-muted-foreground">{t("equity.empty")}</p>
      ) : (
        <div
          className="min-h-64 flex-1 sm:min-h-72"
          role="img"
          aria-label={t("equity.aria", { from: fmtDate(equity[0]!.day, "medium"), to: fmtDate(last!.day, "medium"), net: fmtUsd(last!.cum, { signed: true }) })}
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={equity} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
              {paint.defs}
              <CartesianGrid {...GRID} />
              <XAxis dataKey="day" tickFormatter={shortDate} {...X_AXIS} minTickGap={32} />
              <YAxis {...Y_AXIS} tickFormatter={(v: number) => fmtUsd(v, { decimals: 0, compact: 10_000 })} />
              <Tooltip
                {...tooltipProps("line")}
                content={<GlassTooltip tone="pnl" delta={(r) => r.net as number} deltaFormat={(v) => fmtUsd(v, { signed: true })} deltaLabel={t("equity.dayLabel")} />}
                labelFormatter={(d: string) => fmtDate(d, "medium")}
                formatter={(v: number) => [fmtUsd(v, { signed: true }), t("stats.net")]}
              />
              <ReferenceLine {...ZERO_LINE} />
              <Area type="monotone" dataKey="cum" stroke={paint.stroke} strokeWidth={STROKE} fill={paint.fill} activeDot={{ ...ACTIVE_DOT, fill: CHART.fg }} {...motion} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  );
}

function SliceList({ rows, kind }: { rows: Slice[]; kind: "best" | "worst" }) {
  const { t } = profileI18n.useT();
  if (!rows.length) return null;
  return (
    <ul className="flex flex-col gap-1" aria-label={t(kind === "best" ? "slices.best" : "slices.worst")}>
      {rows.map((r) => (
        <li key={r.key} className="flex min-h-10 items-center justify-between gap-3 rounded-lg px-2 py-1">
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-foreground" title={r.key}>{r.key}</span>
            <span className="block text-xs text-muted-foreground">
              {t("slices.meta", { trades: commonI18n.t("units.trades", { count: r.n }), wr: fmtRate(r.winRate) })}
            </span>
          </span>
          <span className={cn("shrink-0 text-sm font-semibold tabular-nums", toneText(toneOf(r.net)))}>{fmtUsd(r.net, { signed: true })}</span>
        </li>
      ))}
    </ul>
  );
}

function SliceColumn({ title, set }: { title: string; set: SliceSet }) {
  const { t } = profileI18n.useT();
  const empty = !set.best.length && !set.worst.length;
  return (
    <section className="tile flex min-w-0 flex-col gap-2 p-tile">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {empty ? (
        <p className="text-xs text-muted-foreground">{t("slices.none")}</p>
      ) : (
        <>
          <SliceList rows={set.best} kind="best" />
          {set.best.length > 0 && set.worst.length > 0 && <div className="h-px bg-[var(--glass-border)]" aria-hidden="true" />}
          <SliceList rows={set.worst} kind="worst" />
        </>
      )}
    </section>
  );
}

export function SlicesPanel({ slices, className }: { slices: ProfileResponse["slices"]; className?: string }) {
  const { t } = profileI18n.useT();
  return (
    <Panel title={t("slices.title")} description={t("slices.description")} icon={Split} className={className}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <SliceColumn title={t("slices.setups")} set={slices.setups} />
        <SliceColumn title={t("slices.tickers")} set={slices.tickers} />
        <SliceColumn title={t("slices.windows")} set={slices.windows} />
      </div>
    </Panel>
  );
}

export function EdgePanel({ edge, className }: { edge: ProfileResponse["edge"]; className?: string }) {
  const { t } = profileI18n.useT();
  return (
    <Panel title={t("edge.title")} description={t("edge.description")} icon={MapIcon} className={className} fill>
      {!edge ? (
        <p className="text-sm text-muted-foreground">{t("edge.empty")}</p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <section className="flex min-w-0 flex-col gap-1">
              <h3 className="flex items-center gap-1.5 px-2 text-sm font-semibold text-foreground"><TrendingUp className="h-4 w-4 text-up" aria-hidden="true" />{t("edge.earn")}</h3>
              <EdgeVerdictList rows={edge.earn} kind="earn" />
            </section>
            <section className="flex min-w-0 flex-col gap-1">
              <h3 className="flex items-center gap-1.5 px-2 text-sm font-semibold text-foreground"><TrendingDown className="h-4 w-4 text-down" aria-hidden="true" />{t("edge.lose")}</h3>
              <EdgeVerdictList rows={edge.lose} kind="lose" />
            </section>
          </div>
          {edge.asOf && <p className="px-2 text-xs text-muted-foreground">{t("edge.asOf", { date: fmtDate(edge.asOf, "dayMonth") })}</p>}
        </div>
      )}
    </Panel>
  );
}

export function StylePanel({ style, className }: { style: Style; className?: string }) {
  const { t } = profileI18n.useT();
  return (
    <Panel title={t("style.title")} description={t("style.description")} icon={Fingerprint} className={className} fill>
      {!style.trades ? (
        <p className="text-sm text-muted-foreground">{t("style.empty")}</p>
      ) : (
        <div className="flex flex-col gap-4">
          {styleGroups(style).map((g) => (
            <section key={g.key} className="flex flex-col gap-1.5">
              <h3 className="text-xs font-semibold text-muted-foreground">{g.title}</h3>
              {/* One stacked strip per group: the shares at a glance, with the labels underneath (never colour alone). */}
              <div className="flex h-2.5 overflow-hidden rounded-full bg-muted/60" aria-hidden="true">
                {g.rows.filter((r) => r.share > 0).map((r, i) => (
                  <span key={r.key} className="h-full border-r-2 border-[hsl(var(--card))] last:border-r-0" style={{ width: `${r.share * 100}%`, background: CHART.series[i % CHART.series.length] }} />
                ))}
              </div>
              <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                {g.rows.filter((r) => r.share > 0).map((r, i) => (
                  <li key={r.key} className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <span className="h-2 w-2 rounded-full" style={{ background: CHART.series[i % CHART.series.length] }} aria-hidden="true" />
                    <span className="text-foreground">{r.label}</span>
                    <span className="tabular-nums">{fmtRate(r.share)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>{t("style.medianHold", { value: holdText(style.medianHoldSec) })}</span>
            {style.tradesPerDay !== null && <span>{t("style.perDay", { value: style.tradesPerDay })}</span>}
          </p>
        </div>
      )}
    </Panel>
  );
}
