import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  BAR_RADIUS, CHART, GRID, GlassTooltip, X_AXIS, Y_AXIS, ZERO_LINE, tooltipProps, useChartMotion,
} from "@/components/shared/charts";
import { Gauge } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Panel, Pill, Segmented, toneOf, toneText } from "@/components/ds";
import { OutcomeBar, useStoredState } from "./shared";
import { fmtNum, fmtR } from "@/lib/format";
import { ratingsI18n } from "@/i18n/ns/ratings";
import { calibVerdict, calibrationOf, qualityCalibration, scoreCalibration, type EnrichedIdea, type OutcomeBasis } from "./idea-metrics";

type Mode = "score" | "quality";

export function IdeaCalibration({ ideas, basis = "trades", pending = false }: { ideas: EnrichedIdea[]; basis?: OutcomeBasis; pending?: boolean }) {
  const { t } = ratingsI18n.useT();
  const motion = useChartMotion();
  const byPrice = basis === "price";
  const [mode, setMode] = useStoredState<Mode>("ideaStats.calibMode", "score", ["score", "quality"]);
  const rows = useMemo(() => (mode === "score" ? scoreCalibration(ideas) : qualityCalibration(ideas)), [ideas, mode]);
  const calib = useMemo(() => calibrationOf(ideas), [ideas]);
  const verdict = calibVerdict(calib);
  const chartRows = rows.filter((r) => r.ideas > 0).map((r) => ({
    label: r.label,
    hit: r.hitRate != null ? Math.round(r.hitRate * 100) : null,
    avgR: r.avgR != null ? Number(r.avgR.toFixed(2)) : null,
    closed: r.closed,
  }));
  const hasOutcomes = rows.some((r) => r.closed > 0);

  return (
    <Panel
      icon={Gauge}
      title={t("calib.title")}
      description={mode === "score"
        ? byPrice ? t("calib.descScorePrice") : t("calib.descScoreTrades")
        : t("calib.descQuality")}
      actions={
        <Segmented
          ariaLabel={t("calib.groupAria")}
          size="sm"
          value={mode}
          onChange={setMode}
          options={[{ value: "score", label: t("calib.byScore") }, { value: "quality", label: t("calib.byQuality") }]}
        />
      }
      className="h-full"
    >
      <div className="flex flex-col gap-4">
        {mode === "score" && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">{t("calib.correlation")}</span>
            <span className={cn("font-semibold tabular-nums", toneText(calib.r == null ? "neutral" : toneOf(calib.r)))}>
              {fmtNum(calib.r, { decimals: 2, signed: true })}
            </span>
            <Pill tone={verdict.tone}>{verdict.text}</Pill>
            <span className="text-xs text-muted-foreground">n = {calib.n}</span>
          </div>
        )}

        {pending ? (
          <Skeleton className="h-52 w-full rounded-xl" />
        ) : hasOutcomes ? (
          <div className="flex w-full flex-col gap-1" role="img" aria-label={t("calib.chartAria")}>
            {/* Two measures on different scales → two aligned charts on one x axis (never a second y axis). */}
            <span className="micro-label">{t("calib.legendHit")}</span>
            <div className="h-36 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartRows} syncId="ideaCalib" margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                  <CartesianGrid {...GRID} />
                  <XAxis dataKey="label" {...X_AXIS} hide />
                  <YAxis {...Y_AXIS} width={40} domain={[0, 100]} unit="%" />
                  <Tooltip
                    {...tooltipProps("bar")}
                    content={<GlassTooltip />}
                    formatter={(v, _name, p) => {
                      const n = v == null ? null : Number(v);
                      return [n == null ? "—" : t("calib.closed", { value: n, count: (p?.payload as { closed?: number } | undefined)?.closed ?? 0 }), t("calib.legendHit")];
                    }}
                  />
                  <Bar dataKey="hit" fill={CHART.accent} radius={BAR_RADIUS} maxBarSize={36} {...motion} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <span className="micro-label mt-1">{t("calib.avgR")}</span>
            <div className="h-24 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartRows} syncId="ideaCalib" margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                  <CartesianGrid {...GRID} />
                  <XAxis dataKey="label" {...X_AXIS} />
                  <YAxis {...Y_AXIS} width={40} tickFormatter={(v: number) => fmtR(v)} />
                  <ReferenceLine {...ZERO_LINE} />
                  <Tooltip {...tooltipProps("bar")} content={<GlassTooltip tone="pnl" />} formatter={(v) => [fmtR(v == null ? null : Number(v)), t("calib.avgR")]} />
                  <Bar dataKey="avgR" radius={BAR_RADIUS} maxBarSize={36} {...motion}>
                    {chartRows.map((r) => <Cell key={r.label} fill={(r.avgR ?? 0) >= 0 ? CHART.up : CHART.down} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : (
          <p className="rounded-xl bg-[var(--glass-bg)] p-4 text-sm text-muted-foreground">
            {byPrice
              ? t(mode === "score" ? "calib.emptyPrice" : "calib.emptyPriceQuality")
              : t(mode === "score" ? "calib.emptyTrades" : "calib.emptyTradesQuality")}
          </p>
        )}

        <table className="w-full text-sm">
          <caption className="sr-only">{t("calib.caption")}</caption>
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b border-border">
              <th scope="col" className="py-2 text-left font-medium">{mode === "score" ? t("calib.colScore") : t("calib.colQuality")}</th>
              <th scope="col" className="py-2 text-right font-medium">{t("calib.colIdeas")}</th>
              <th scope="col" className="hidden py-2 text-right font-medium sm:table-cell">{t("calib.colInTrades")}</th>
              <th scope="col" className="w-1/4 py-2 pl-3 text-left font-medium">{t("calib.colOutcomes")}</th>
              <th scope="col" className="py-2 text-right font-medium">Hit</th>
              <th scope="col" className="py-2 text-right font-medium">{t("calib.colAvgR")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className={cn("border-b border-border/50 last:border-0", r.ideas === 0 && "opacity-60")}>
                <td className="py-2 font-medium text-foreground">{r.label}</td>
                <td className="py-2 text-right tabular-nums">{r.ideas}</td>
                <td className="hidden py-2 text-right tabular-nums sm:table-cell">{r.converted}</td>
                <td className="py-2 pl-3"><OutcomeBar wins={r.wins} losses={r.losses} be={r.be} open={r.open} /></td>
                <td className="py-2 text-right tabular-nums">{r.hitRate == null ? "—" : `${Math.round(r.hitRate * 100)}%`}</td>
                <td className={cn("py-2 text-right tabular-nums", toneText(toneOf(r.avgR)))}>{fmtR(r.avgR)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
