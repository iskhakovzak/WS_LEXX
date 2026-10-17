import type { CSSProperties, ReactNode } from "react";
import { Link } from "wouter";
import { Area, AreaChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, ArrowUpRight, Lightbulb, ListChecks, ShieldAlert, Sparkles, Tag } from "lucide-react";
import { Panel, toneOf, toneText } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { links } from "@/lib/links";
import { useDayReport, type DayReport } from "@/components/day-report/api";
import { dayHints, type DayHint, type HintTone } from "./day-hints";
import { netPnl, type DayStats } from "./utils";
import { fmtR, fmtRate, fmtUsd } from "@/lib/format";
import { commonI18n } from "@/i18n/ns/common";
import { dayHref } from "@/lib/period-links";

const TOOLTIP_STYLE: CSSProperties = {
  backgroundColor: "hsl(var(--popover) / 0.92)",
  border: "1px solid hsl(var(--border))",
  color: "hsl(var(--popover-foreground))",
  borderRadius: 12,
  fontSize: 12,
  backdropFilter: "blur(24px)",
  fontVariantNumeric: "tabular-nums",
};

/** «Разбор дня» page (/day-report) for this trader + date. */
export function dayReportHref(date: string, trader?: string | null): string {
  return dayHref(date, trader);
}

/**
 * Top of the day: net P&L, trades / win rate / fees / best / worst, intraday curve and auto-hints.
 * Curve and hints come from GET /api/day-report (one source for leaks and timing) — nothing is recomputed here.
 */
export function DaySummary({
  trader,
  date,
  stats,
  isLoading,
  violations,
  untaggedIds,
  status,
  empty,
}: {
  /** "" = whole team (no curve / hints: the day report is per trader). */
  trader: string;
  date: string;
  stats: DayStats;
  isLoading: boolean;
  violations: number;
  /** Broker trades of the day without a setup (soft reminder, links to quick tagging on /trades). */
  untaggedIds: number[];
  /** EOD status pill + actions, rendered in the panel header. */
  status?: ReactNode;
  /** Shown instead of the body when the day has no trades. */
  empty?: ReactNode;
}) {
  const hasTrades = stats.trades > 0;
  const report = useDayReport(trader || null, date, !!trader && hasTrades);
  const doc = report.data && report.data.date === date ? report.data : null;
  const hints = dayHints(doc, { violations, untagged: untaggedIds.length });
  const decided = stats.wins + stats.losses;
  const net = stats.pnl;
  const best = stats.best ? netPnl(stats.best) : null;
  const worst = stats.worst && stats.worst !== stats.best ? netPnl(stats.worst) : null;

  return (
    <Panel
      title="Итог дня"
      icon={ListChecks}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {status}
          {trader && hasTrades && (
            <Button asChild variant="outline" size="sm">
              <Link href={dayReportHref(date, trader)}>
                Разбор дня<ArrowUpRight aria-hidden="true" />
              </Link>
            </Button>
          )}
        </div>
      }
    >
      {isLoading ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-28 w-full rounded-xl" />
        </div>
      ) : !hasTrades ? (
        empty ?? null
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <div className="min-w-0 space-y-3">
              <div>
                <div className="text-xs text-muted-foreground">P&L нетто</div>
                <div className={cn("text-3xl font-semibold tabular-nums tracking-tight", toneText(toneOf(net)))}>
                  {net != null ? fmtUsd(net, { signed: true, decimals: "auto" }) : stats.r != null ? fmtR(stats.r) : "—"}
                </div>
                {stats.gross != null && (
                  <div className="text-xs text-muted-foreground tabular-nums">
                    брутто {fmtUsd(stats.gross, { signed: true, decimals: "auto" })} · комиссии {stats.fees != null ? fmtUsd(-stats.fees, { signed: true, decimals: "auto" }) : "—"}
                  </div>
                )}
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                <Mini label="Сделки" value={stats.trades} hint={`${stats.wins} в плюс · ${stats.losses} в минус${stats.open ? ` · ${stats.open} откр.` : ""}`} />
                <Mini label="Винрейт" value={decided ? fmtRate(stats.wins / decided) : "—"} hint={decided ? `${stats.wins} из ${decided}` : undefined} />
                <Mini
                  label="Лучшая"
                  value={best != null ? fmtUsd(best, { signed: true, decimals: "auto" }) : "—"}
                  tone={toneOf(best)}
                  hint={stats.best?.ticker}
                />
                <Mini
                  label="Худшая"
                  value={worst != null ? fmtUsd(worst, { signed: true, decimals: "auto" }) : "—"}
                  tone={toneOf(worst)}
                  hint={worst != null ? stats.worst?.ticker : undefined}
                />
              </dl>
              {stats.r != null && (
                <p className="text-xs text-muted-foreground tabular-nums">
                  Сумма R {fmtR(stats.r)}{stats.expectancyR != null ? ` · в среднем ${fmtR(stats.expectancyR)} на сделку` : ""}
                </p>
              )}
            </div>
            <IntradayCurve doc={doc} loading={report.isLoading} team={!trader} />
          </div>

          {report.isLoading && !doc && trader ? (
            <div className="grid gap-2 md:grid-cols-2" aria-hidden="true">
              <Skeleton className="h-14 w-full rounded-xl" />
              <Skeleton className="h-14 w-full rounded-xl" />
            </div>
          ) : hints.length > 0 && (
            <ul className="grid gap-2 md:grid-cols-2" aria-label="Подсказки по дню">
              {hints.map((h) => (
                <HintRow key={h.id} hint={h} href={h.id === "untagged" ? links.trades({ ids: untaggedIds }) : h.tradeIds?.length ? links.trades({ ids: h.tradeIds }) : undefined} />
              ))}
            </ul>
          )}
        </div>
      )}
    </Panel>
  );
}

function Mini({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: ReturnType<typeof toneOf> }) {
  return (
    <div className="min-w-0">
      <dt className="text-2xs text-muted-foreground">{label}</dt>
      <dd className={cn("truncate text-base font-semibold tabular-nums", tone ? toneText(tone) : "")}>{value}</dd>
      {hint && <dd className="truncate text-2xs text-muted-foreground">{hint}</dd>}
    </div>
  );
}

const HINT_ICON: Record<HintTone, typeof AlertTriangle> = { down: AlertTriangle, warn: ShieldAlert, up: Sparkles, accent: Tag };
const HINT_TONE: Record<HintTone, string> = {
  down: "text-down",
  warn: "text-warn",
  up: "text-up",
  accent: "text-primary",
};

function HintRow({ hint, href }: { hint: DayHint; href?: string }) {
  const Icon = HINT_ICON[hint.tone] ?? Lightbulb;
  const body = (
    <>
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", HINT_TONE[hint.tone])} aria-hidden="true" />
      <span className="min-w-0">
        <span className="block text-sm font-medium tabular-nums">{hint.text}</span>
        {hint.detail && <span className="block text-xs text-muted-foreground">{hint.detail}</span>}
      </span>
      {href && <ArrowUpRight className="ml-auto mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
    </>
  );
  return (
    <li>
      {href ? (
        <Link href={href} className="tile tile-interactive flex items-start gap-2.5 p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {body}
        </Link>
      ) : (
        <div className="tile flex items-start gap-2.5 p-3">{body}</div>
      )}
    </li>
  );
}

function IntradayCurve({ doc, loading, team = false }: { doc: DayReport | null; loading: boolean; team?: boolean }) {
  if (team) {
    // The intraday curve is per trader (day report); a whole-team day has none — say so instead of «no closed trades».
    return (
      <div className="tile grid h-32 place-items-center px-4 text-center text-xs text-muted-foreground">
        Кривая дня строится по одному трейдеру — выберите его в списке «Команда за день»
      </div>
    );
  }
  if (loading && !doc) return <Skeleton className="h-32 w-full rounded-xl" />;
  const e = doc?.equity;
  if (!e || e.points.length < 2) {
    return (
      <div className="tile grid h-32 place-items-center text-xs text-muted-foreground">
        Кривая появится, когда закроется хотя бы одна сделка
      </div>
    );
  }
  const timed = e.points.every((p) => p.t != null);
  const data = e.points.map((p, i) => ({ ...p, x: timed ? (p.t as number) : i }));
  const color = e.final >= 0 ? "hsl(var(--up))" : "hsl(var(--down))";
  const first = data[0], last = data[data.length - 1];
  return (
    <div className="tile min-w-0 p-3">
      <div className="flex items-center justify-between gap-2 text-2xs text-muted-foreground">
        <span>Кривая дня, нетто{timed ? ", ET" : ""}</span>
        <span className="tabular-nums">
          пик <span className="text-up">{fmtUsd(e.peak.value, { signed: true, decimals: "auto" })}</span>
          {e.maxDrawdown.value > 0 && <> · просадка <span className="text-down">{fmtUsd(-e.maxDrawdown.value, { signed: true, decimals: "auto" })}</span></>}
          {e.giveback > 0 && <> · отдано {fmtUsd(Math.abs(e.giveback), { decimals: "auto" })}</>}
        </span>
      </div>
      <div
        className="mt-1 h-24 w-full"
        role="img"
        aria-label={`Кривая нетто за день: пик ${fmtUsd(e.peak.value, { signed: true, decimals: "auto" })}, закрытие ${fmtUsd(e.final, { signed: true, decimals: "auto" })}, максимальная просадка ${fmtUsd(Math.abs(e.maxDrawdown.value), { decimals: "auto" })}`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
            <defs>
              <linearGradient id="jn-eq" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={color} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <XAxis dataKey="x" type="number" domain={["dataMin", "dataMax"]} hide />
            <YAxis hide domain={["dataMin", "dataMax"]} />
            <ReferenceLine y={0} stroke="hsl(var(--border))" strokeDasharray="2 3" />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              labelFormatter={(x: number) => {
                const p = data.find((d) => d.x === x);
                return p ? `${p.time?.slice(0, 5) ?? ""}${p.ticker ? ` · ${p.ticker}` : " · старт"}` : "";
              }}
              formatter={(v: number) => [fmtUsd(v, { signed: true, decimals: "auto" }), "Нетто нарастающим"]}
            />
            <Area type="stepAfter" dataKey="cum" stroke={color} strokeWidth={2} fill="url(#jn-eq)" isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      {timed && (
        <div className="flex justify-between text-2xs tabular-nums text-muted-foreground">
          <span>{first.time?.slice(0, 5)}</span>
          <span>{last.time?.slice(0, 5)}</span>
        </div>
      )}
    </div>
  );
}

export function untaggedCount(n: number): string {
  return `${commonI18n.t("units.trades", { count: n })} без сетапа`;
}
