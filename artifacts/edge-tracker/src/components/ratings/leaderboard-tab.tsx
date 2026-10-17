import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Crown, Download, Flame, Medal, Trophy, Users } from "lucide-react";
import { BASE } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/query-error";
import { EmptyState, Panel, Pill, Segmented, StatCard, StatGrid, TableScroll, toneOf, toneText } from "@/components/ds";
import {
  Avatar, RankDelta, Sparkline, StreakBadge, OutcomeBar,
  downloadCsv, fetchJson, fmtPct, fmtR, fmtSigned, fmtUsd, pluralRu, useStoredState,
} from "./shared";

export type LeaderboardEntry = {
  trader: string;
  totalTrades: number; wins: number; losses: number; breakevens: number; open?: number;
  winrate: number; totalPnl: number; avgPnl: number; pnlCount?: number;
  /** null = no trade with a known R in the window (no stop, e.g. PropReports imports). */
  totalR: number | null; avgR: number | null; rCount?: number; bestR?: number | null; worstR?: number | null;
  /** W/(W+L) as a fraction; null = no decided trades (newer API builds). */
  winRate?: number | null;
  bestTrade: number; worstTrade: number;
  expectancy: number; expectancyR?: number | null;
  tradingDays?: number; sharpeDaily?: number | null; sharpeDailyR?: number | null; sharpeApprox?: number;
  currentStreak: number; bestStreak: number; worstStreak: number;
  lastTradeDate: string | null;
  sparkR?: number[];
  prev?: { totalTrades: number; winrate: number; totalPnl: number; totalR: number | null; avgR: number | null; expectancy: number; expectancyR?: number | null } | null;
};

export const PERIODS = [
  { value: "7", label: "Неделя" },
  { value: "30", label: "Месяц" },
  { value: "90", label: "Квартал" },
  { value: "all", label: "Всё" },
] as const;
export type Period = (typeof PERIODS)[number]["value"];
const PERIOD_VALUES = PERIODS.map((p) => p.value) as readonly Period[];

type Metric = "r" | "pnl" | "winrate" | "expR";
const METRICS: { value: Metric; label: string }[] = [
  { value: "r", label: "Сумма R" },
  { value: "pnl", label: "P&L" },
  { value: "winrate", label: "Винрейт" },
  { value: "expR", label: "Ожидание R" },
];
const METRIC_VALUES = ["auto", ...METRICS.map((m) => m.value)] as const;

type MetricSource = {
  totalR: number | null; totalPnl: number; winrate: number; avgR: number | null; expectancyR?: number | null; totalTrades: number;
  wins?: number; losses?: number; winRate?: number | null;
};
/** Row win rate in %, W/(W+L) — null (→ «—») when there are no decided trades. */
export function winPctOf(e: { winrate: number; wins?: number; losses?: number; winRate?: number | null }): number | null {
  if (e.winRate !== undefined) return e.winRate == null ? null : e.winRate * 100;
  if (e.wins != null && e.losses != null) return e.wins + e.losses > 0 ? (e.wins / (e.wins + e.losses)) * 100 : null;
  return e.winrate;
}
function metricOf(m: Metric, e: MetricSource): number | null {
  switch (m) {
    case "r": return e.totalR;
    case "pnl": return e.totalPnl;
    case "winrate": return winPctOf(e);
    case "expR": return e.expectancyR ?? e.avgR;
  }
}
function fmtMetric(m: Metric, v: number | null): string {
  switch (m) {
    case "r": return fmtR(v, 1);
    case "pnl": return fmtUsd(v);
    case "winrate": return fmtPct(v);
    case "expR": return fmtR(v, 2);
  }
}
function rankBy<T extends MetricSource & { trader: string }>(list: T[], m: Metric): T[] {
  const val = (e: T) => metricOf(m, e) ?? Number.NEGATIVE_INFINITY; // unknown (null) sorts last
  return [...list].sort((a, b) => (val(b) === val(a) ? 0 : val(b) - val(a)) || b.totalTrades - a.totalTrades || a.trader.localeCompare(b.trader));
}

/** Whether any trade in the row has a P&L value (older API builds lack pnlCount). */
function hasPnlOf(l: LeaderboardEntry): boolean {
  return (l.pnlCount ?? (l.totalPnl !== 0 ? 1 : 0)) > 0;
}

export type RankedEntry = LeaderboardEntry & { rank: number; rankDelta: number | null; isNew: boolean };

/** Shared hook: leaderboard for a period, ranked by metric, with rank change vs previous period. */
export function useLeaderboard(period: Period, metric: Metric | "auto") {
  const q = useQuery<LeaderboardEntry[]>({
    queryKey: ["leaderboard", period],
    queryFn: () => fetchJson<LeaderboardEntry[]>(period === "all" ? `${BASE}/api/leaderboard` : `${BASE}/api/leaderboard?days=${period}`),
    staleTime: 30_000,
  });
  const leaders = q.data ?? [];
  const hasPnl = leaders.some(hasPnlOf);
  const effective: Metric = metric === "auto" ? (hasPnl ? "pnl" : "r") : metric;
  const ranked = useMemo<RankedEntry[]>(() => {
    const cur = rankBy(leaders, effective);
    const withPrev = leaders.filter((l) => l.prev && l.prev.totalTrades > 0);
    const prevRanked = rankBy(withPrev.map((l) => ({ ...l.prev!, trader: l.trader })), effective);
    const prevRank = new Map(prevRanked.map((p, i) => [p.trader, i + 1]));
    return cur.map((l, i) => {
      const pr = prevRank.get(l.trader);
      return { ...l, rank: i + 1, rankDelta: pr != null ? pr - (i + 1) : null, isNew: pr == null };
    });
  }, [leaders, effective]);
  return { ...q, ranked, metric: effective, hasPnl };
}

function sharpeOf(l: LeaderboardEntry): { value: number | null; basis: "$" | "R" | null } {
  if (l.sharpeDaily != null) return { value: l.sharpeDaily, basis: "$" };
  if (l.sharpeDailyR != null) return { value: l.sharpeDailyR, basis: "R" };
  return { value: null, basis: null };
}

const MEDAL = ["text-[hsl(var(--chart-3))]", "text-muted-foreground", "text-[hsl(var(--chart-5))]"];

export function LeaderboardTab({ me }: { me: string | null }) {
  const [period, setPeriod] = useStoredState<Period>("ratings.lb.period", "30", PERIOD_VALUES);
  const [metricPref, setMetricPref] = useStoredState<Metric | "auto">("ratings.lb.metric", "auto", METRIC_VALUES);
  const { ranked, metric, isLoading, isError, error, refetch, hasPnl } = useLeaderboard(period, metricPref);

  const team = useMemo(() => {
    if (ranked.length === 0) return null;
    const trades = ranked.reduce((s, l) => s + l.totalTrades, 0);
    // Win rate = W/(W+L): break-evens are excluded (same rule as the server rows).
    const wins = ranked.reduce((s, l) => s + l.wins, 0);
    const decided = ranked.reduce((s, l) => s + l.wins + l.losses, 0);
    // Σ R only over traders whose R is known; null when nobody has a stop → the card falls back to net $.
    const withR = ranked.filter((l) => l.totalR != null);
    const r = withR.length > 0 ? withR.reduce((s, l) => s + (l.totalR ?? 0), 0) : null;
    const pnlRows = ranked.filter(hasPnlOf);
    const pnl = pnlRows.length > 0 ? pnlRows.reduce((s, l) => s + l.totalPnl, 0) : null;
    const streak = [...ranked].sort((a, b) => b.bestStreak - a.bestStreak)[0];
    const hot = [...ranked].filter((l) => l.currentStreak > 0).sort((a, b) => b.currentStreak - a.currentStreak)[0];
    return { trades, winrate: decided > 0 ? (wins / decided) * 100 : null, r, pnl, streak, hot };
  }, [ranked]);

  const periodLabel = PERIODS.find((p) => p.value === period)?.label.toLowerCase();
  const prevLabel = period === "all" ? "положения неделю назад" : "прошлого периода";

  function exportCsv() {
    downloadCsv(
      `leaderboard-${period}.csv`,
      ["#", "Трейдер", "Сделок", "Винрейт %", "Сумма R", "Ожидание R", "P&L $", "Sharpe (дн.)", "Серия", "Лучшая серия"],
      ranked.map((l) => [l.rank, l.trader, l.totalTrades, winPctOf(l), l.totalR, l.expectancyR ?? l.avgR, l.totalPnl, sharpeOf(l).value, l.currentStreak, l.bestStreak]),
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented ariaLabel="Период" options={[...PERIODS]} value={period} onChange={setPeriod} />
        <Segmented
          ariaLabel="Ранжировать по"
          size="sm"
          options={METRICS.map((m) => ({ ...m, disabled: m.value === "pnl" && !hasPnl && ranked.length > 0 }))}
          value={metric}
          onChange={(v) => setMetricPref(v)}
        />
        <Button variant="ghost" size="sm" className="ml-auto gap-1.5" onClick={exportCsv} disabled={ranked.length === 0}>
          <Download className="h-4 w-4" aria-hidden="true" /> CSV
        </Button>
      </div>

      {isLoading && (
        <div className="flex flex-col gap-3" aria-busy="true" aria-label="Загрузка рейтинга">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-36 rounded-2xl" />)}
          </div>
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      )}
      {isError && <QueryError error={error} onRetry={() => refetch()} />}
      {!isLoading && !isError && ranked.length === 0 && (
        <Panel>
          <EmptyState
            icon={Trophy}
            title={`Нет сделок за ${periodLabel === "всё" ? "всё время" : `период «${periodLabel}»`}`}
            description="Рейтинг строится автоматически по журналу сделок. Выберите период побольше или добавьте сделки."
            action={period !== "all" ? <Button variant="outline" size="sm" onClick={() => setPeriod("all")}>Показать за всё время</Button> : undefined}
          />
        </Panel>
      )}

      {ranked.length > 0 && (
        <>
          {/* Podium */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {ranked.slice(0, 3).map((l, i) => {
              const v = metricOf(metric, l);
              return (
                <div
                  key={l.trader}
                  className={cn(
                    "glass-panel lift flex flex-col gap-3 rounded-2xl p-4",
                    i === 0 && "ring-1 ring-primary/60",
                  )}
                >
                  <div className="flex items-center gap-3">
                    <span className={cn("grid h-9 w-9 place-items-center rounded-full bg-[var(--glass-hover-bg)]", MEDAL[i])} aria-label={`${i + 1} место`}>
                      {i === 0 ? <Crown className="h-4 w-4" aria-hidden="true" /> : <Medal className="h-4 w-4" aria-hidden="true" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold text-foreground">{l.trader}</span>
                        {l.trader === me && <Pill tone="accent">Вы</Pill>}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="tabular-nums">#{i + 1}</span>
                        <RankDelta delta={l.rankDelta} isNew={l.isNew} />
                      </div>
                    </div>
                    <StreakBadge value={l.currentStreak} />
                  </div>
                  <div className="flex items-end justify-between gap-2">
                    <div>
                      <div className="text-xs text-muted-foreground">{METRICS.find((m) => m.value === metric)?.label}</div>
                      <div className={cn("text-2xl font-semibold tabular-nums tracking-tight", metric === "winrate" ? "text-foreground" : toneText(toneOf(v)))}>
                        {fmtMetric(metric, v)}
                      </div>
                    </div>
                    <Sparkline values={l.sparkR ?? []} width={96} height={32} label={`Кумулятивный R: ${fmtR(l.totalR, 1)}`} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <OutcomeBar wins={l.wins} losses={l.losses} be={l.breakevens} open={l.open ?? 0} />
                    <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
                      <span>{l.totalTrades} {pluralRu(l.totalTrades, "сделка", "сделки", "сделок")}</span>
                      <span>WR {fmtPct(winPctOf(l))}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {team && (
            <StatGrid>
              <StatCard label="Сделок у команды" value={team.trades} icon={Users} hint={`за ${periodLabel === "всё" ? "всё время" : periodLabel}`} />
              <StatCard label="Винрейт команды" value={fmtPct(team.winrate)} hint="W/(W+L), безубыток не в счёт" />
              {team.r != null || team.pnl == null ? (
                <StatCard label="Сумма R команды" value={fmtR(team.r, 1)} tone={toneOf(team.r)} hint={team.r == null ? "R неизвестен — нет стопов" : undefined} />
              ) : (
                <StatCard label="P&L команды · нетто" value={fmtUsd(team.pnl)} tone={toneOf(team.pnl)} hint="R неизвестен (нет стопа) — показан P&L" />
              )}
              <StatCard
                label={team.hot ? "Горячая серия" : "Лучшая серия"}
                icon={Flame}
                value={team.hot ? `W${team.hot.currentStreak}` : team.streak.bestStreak > 0 ? `W${team.streak.bestStreak}` : "—"}
                tone={team.hot || team.streak.bestStreak > 0 ? "up" : "neutral"}
                hint={team.hot ? team.hot.trader : team.streak.bestStreak > 0 ? team.streak.trader : "нет серий"}
              />
            </StatGrid>
          )}

          {/* Desktop table */}
          <Panel padded={false} className="hidden md:block" title="Таблица лидеров" description={`Стрелки — изменение места относительно ${prevLabel}`}>
            <TableScroll className="max-h-[560px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-sticky bg-[var(--sticky-bg)] text-xs text-muted-foreground">
                  <tr className="border-b border-border">
                    <th scope="col" className="w-16 px-4 py-2.5 text-left font-medium">#</th>
                    <th scope="col" className="px-2 py-2.5 text-left font-medium">Трейдер</th>
                    {METRICS.map((m) => (
                      <th key={m.value} scope="col" className="px-2 py-2.5 text-right font-medium" aria-sort={metric === m.value ? "descending" : "none"}>
                        <button
                          type="button"
                          onClick={() => setMetricPref(m.value)}
                          disabled={m.value === "pnl" && !hasPnl}
                          className={cn("rounded-full px-1.5 py-0.5 hover:text-foreground disabled:opacity-50", metric === m.value && "text-primary")}
                        >
                          {m.label}
                        </button>
                      </th>
                    ))}
                    <th scope="col" className="px-2 py-2.5 text-right font-medium" title="Sharpe по дневным итогам (P&L, иначе R) × √252; нужно ≥ 5 торговых дней">Sharpe (дн.)</th>
                    <th scope="col" className="px-2 py-2.5 text-right font-medium">Серия</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-medium">Тренд R</th>
                  </tr>
                </thead>
                <tbody>
                  {ranked.map((l) => {
                    const sh = sharpeOf(l);
                    const mine = l.trader === me;
                    return (
                      <tr key={l.trader} className={cn("border-b border-border/60 last:border-0 transition-colors hover:bg-[var(--glass-hover-bg)]", mine && "bg-primary/5")}>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className={cn("w-5 font-semibold tabular-nums", l.rank <= 3 ? MEDAL[l.rank - 1] : "text-muted-foreground")}>{l.rank}</span>
                            <RankDelta delta={l.rankDelta} isNew={l.isNew} />
                          </div>
                        </td>
                        <td className="px-2 py-2.5">
                          <div className="flex items-center gap-2">
                            <Avatar name={l.trader} highlight={mine} className="h-7 w-7" />
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="font-medium text-foreground">{l.trader}</span>
                                {mine && <Pill tone="accent">Вы</Pill>}
                              </div>
                              <div className="text-xs text-muted-foreground tabular-nums">
                                {l.totalTrades} {pluralRu(l.totalTrades, "сделка", "сделки", "сделок")} · {l.wins}/{l.losses}/{l.breakevens}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className={cn("px-2 py-2.5 text-right tabular-nums", toneText(toneOf(l.totalR)), metric === "r" && "font-semibold")}>{fmtR(l.totalR, 1)}</td>
                        <td className={cn("px-2 py-2.5 text-right tabular-nums", hasPnlOf(l) ? toneText(toneOf(l.totalPnl)) : "text-muted-foreground", metric === "pnl" && "font-semibold")}>
                          {hasPnlOf(l) ? fmtUsd(l.totalPnl) : "—"}
                        </td>
                        <td className={cn("px-2 py-2.5 text-right tabular-nums", metric === "winrate" && "font-semibold")}>{fmtPct(winPctOf(l))}</td>
                        <td className={cn("px-2 py-2.5 text-right tabular-nums", toneText(toneOf(l.expectancyR ?? l.avgR)), metric === "expR" && "font-semibold")}>{fmtR(l.expectancyR ?? l.avgR, 2)}</td>
                        <td className="px-2 py-2.5 text-right tabular-nums" title={sh.value == null ? "Нужно ≥ 5 торговых дней" : `По дневным итогам в ${sh.basis === "$" ? "$" : "R"}`}>
                          {sh.value == null ? <span className="text-muted-foreground">—</span> : (
                            <span className={toneText(toneOf(sh.value))}>{fmtSigned(sh.value, 2)}{sh.basis === "R" && <span className="ml-0.5 text-2xs text-muted-foreground">R</span>}</span>
                          )}
                        </td>
                        <td className="px-2 py-2.5 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <StreakBadge value={l.currentStreak} />
                            {l.bestStreak > 1 && <span className="text-2xs text-muted-foreground tabular-nums" title="Лучшая серия">макс W{l.bestStreak}</span>}
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex justify-end"><Sparkline values={l.sparkR ?? []} /></div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableScroll>
          </Panel>

          {/* Mobile cards */}
          <ul className="flex flex-col gap-2 md:hidden" aria-label="Таблица лидеров">
            {ranked.map((l) => {
              const v = metricOf(metric, l);
              const mine = l.trader === me;
              return (
                <li key={l.trader} className={cn("glass-panel flex items-center gap-3 rounded-2xl p-3", mine && "ring-1 ring-primary/50")}>
                  <div className="flex w-8 flex-col items-center gap-0.5">
                    <span className={cn("font-semibold tabular-nums", l.rank <= 3 ? MEDAL[l.rank - 1] : "text-muted-foreground")}>{l.rank}</span>
                    <RankDelta delta={l.rankDelta} isNew={l.isNew} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-medium text-foreground">{l.trader}</span>
                      {mine && <Pill tone="accent">Вы</Pill>}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground tabular-nums">
                      <span>{l.totalTrades} сд.</span>
                      <span>WR {fmtPct(winPctOf(l))}</span>
                      <StreakBadge value={l.currentStreak} className="px-1.5 py-0 text-2xs" />
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className={cn("font-semibold tabular-nums", metric === "winrate" ? "text-foreground" : toneText(toneOf(v)))}>{fmtMetric(metric, v)}</span>
                    <Sparkline values={l.sparkR ?? []} width={64} height={20} />
                  </div>
                </li>
              );
            })}
          </ul>

          <p className="text-xs text-muted-foreground">
            Винрейт — по закрытым сделкам. Sharpe (дн.) считается по дневным итогам трейдера (P&L, а если суммы не заполнены — по R) × √252,
            показывается при ≥ 5 торговых днях. Тренд — кумулятивный R по дням периода.
          </p>
        </>
      )}
    </div>
  );
}
