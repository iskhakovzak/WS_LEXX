import { useMemo } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Check, Crosshair, Flame, Lightbulb, MessageSquareQuote, Star, Trophy, UserRound } from "lucide-react";
import { BASE } from "@/lib/api";
import { links } from "@/lib/links";
import { PeriodHint, usePeriodNav } from "@/lib/period-links";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { EmptyState, Panel, Pill, StatCard, StatGrid, StatRow, toneOf, toneText } from "@/components/ds";
import { CHART_TOOLTIP, OutcomeBar, RankDelta, fetchJson, fmtPct, fmtR, fmtUsd, pluralRu } from "./shared";
import { useLeaderboard, winPctOf } from "./leaderboard-tab";
import { ScorecardCard } from "./scorecards-tab";
import { CRITERIA, buildScorecards, criterionLabel, tierLabel, weekLabel, type Rating } from "./scorecard-model";
import { bucketOf, calibVerdict, calibrationOf, enrichIdea, type TradeIdea } from "./idea-metrics";

export function MyProgressTab({ me, ratings, ratingsLoading }: { me: string | null; ratings: Rating[]; ratingsLoading: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const month = useLeaderboard("30", "auto");
  const ideasQ = useQuery<TradeIdea[]>({
    queryKey: ["trade-ideas", "stats-list"],
    queryFn: () => fetchJson<TradeIdea[]>(`${BASE}/api/trade-ideas`),
    staleTime: 30_000,
    enabled: !!me,
  });

  const mine = month.ranked.find((l) => l.trader === me) ?? null;
  const card = useMemo(() => (me ? buildScorecards(ratings.filter((r) => r.trader === me))[0] ?? null : null), [ratings, me]);
  const myRatings = useMemo(
    () => ratings.filter((r) => r.trader === me && r.comment?.trim()).sort((a, b) => b.week.localeCompare(a.week) || b.createdAt.localeCompare(a.createdAt)).slice(0, 4),
    [ratings, me],
  );
  const ideas = useMemo(() => (ideasQ.data ?? []).filter((i) => i.trader === me).map(enrichIdea), [ideasQ.data, me]);
  const ideaB = useMemo(() => bucketOf(ideas), [ideas]);
  const ideaCalib = useMemo(() => calibrationOf(ideas), [ideas]);
  const team = useMemo(() => {
    // Team win rate = W / (W + L): break-even trades are excluded, same as the leaderboard rows.
    const decided = month.ranked.reduce((s, l) => s + l.wins + l.losses, 0);
    const wins = month.ranked.reduce((s, l) => s + l.wins, 0);
    return { winrate: decided ? (wins / decided) * 100 : null };
  }, [month.ranked]);

  // Feedback loop: the trader confirms they have read the curator's focus → curator sees it on the scorecard.
  const ack = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`${BASE}/api/ratings/${id}/ack`, { method: "POST" });
      const body = await r.json().catch(() => null);
      if (!r.ok) throw new Error(body?.error ?? "Не удалось отметить");
      return body as Rating;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ratings"] }); toast({ title: "Фокус принят", description: "Куратор увидит отметку на карточке" }); },
    onError: (e: Error) => toast({ title: "Ошибка", description: e.message, variant: "destructive" }),
  });

  const chartData = card?.series.map((s) => ({ date: s.week, week: weekLabel(s.week).split(" – ")[0], composite: s.composite, overall: s.overall })) ?? [];
  // Each point is a week: click / Enter opens that week's review.
  const weekNav = usePeriodNav({
    kind: "week",
    dates: chartData.map((d) => d.date),
    trader: me,
    label: "Оценки по неделям",
    describe: (i) => `Неделя ${weekLabel(chartData[i].date)} · критерии ${chartData[i].composite?.toFixed(1) ?? "—"}`,
  });

  if (!me) {
    return (
      <Panel>
        <EmptyState icon={UserRound} title="Войдите как трейдер" description="Личный прогресс доступен трейдерам: место в рейтинге, оценки кураторов и статистика ваших идей." />
      </Panel>
    );
  }

  const weakest = card?.weakest && card.latest ? { key: card.weakest, now: card.latest[card.weakest] } : null;
  const curatorFocus = card?.lastFocus ?? null;

  return (
    <div className="flex flex-col gap-4">
      {month.isLoading ? (
        <StatGrid>{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</StatGrid>
      ) : (
        <StatGrid>
          <StatCard
            label="Место за месяц"
            icon={Trophy}
            value={mine ? `#${mine.rank}` : "—"}
            hint={mine ? <span className="inline-flex items-center gap-1.5">из {month.ranked.length} <RankDelta delta={mine.rankDelta} isNew={mine.isNew} /></span> : "нет сделок за 30 дней"}
            tone={mine && mine.rank <= 3 ? "accent" : "neutral"}
          />
          <StatCard
            label="Текущая серия"
            icon={Flame}
            value={mine?.currentStreak ? (mine.currentStreak > 0 ? `W${mine.currentStreak}` : `L${-mine.currentStreak}`) : "—"}
            tone={toneOf(mine?.currentStreak)}
            hint={mine ? `лучшая W${mine.bestStreak} · худшая L${-mine.worstStreak}` : undefined}
          />
          {mine && mine.totalR == null && (mine.pnlCount ?? 0) > 0 ? (
            // R unknown (no stop on the trades, e.g. broker imports) → show net $ instead of a fake 0R.
            <StatCard
              label="P&L за месяц · нетто"
              value={fmtUsd(mine.totalPnl)}
              tone={toneOf(mine.totalPnl)}
              hint={mine.prev ? `прошлый месяц ${fmtUsd(mine.prev.totalPnl)} · R неизвестен` : "R неизвестен — нет стопа"}
            />
          ) : (
            <StatCard
              label="Сумма R за месяц"
              value={mine ? fmtR(mine.totalR, 1) : "—"}
              tone={toneOf(mine?.totalR)}
              hint={mine?.prev ? `прошлый месяц ${fmtR(mine.prev.totalR, 1)}` : undefined}
            />
          )}
          <StatCard
            label="Винрейт за месяц"
            value={mine ? fmtPct(winPctOf(mine)) : "—"}
            tone={mine && team.winrate != null && winPctOf(mine) != null ? toneOf(winPctOf(mine)! - team.winrate) : "neutral"}
            hint={team.winrate != null ? `команда ${fmtPct(team.winrate)}` : undefined}
          />
        </StatGrid>
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="flex flex-col gap-4 lg:col-span-2">
          {ratingsLoading ? <Skeleton className="h-80 rounded-2xl" /> : card ? (
            <ScorecardCard card={card} />
          ) : (
            <Panel>
              <EmptyState icon={Star} title="Оценок кураторов пока нет" description="Кураторы выставляют оценки раз в неделю по пяти критериям — здесь появится ваша карточка и тренд." />
            </Panel>
          )}
          {(curatorFocus || weakest) && (
            <Panel
              icon={Crosshair}
              title="Фокус на неделю"
              actions={card?.tier ? <Link href={links.scaling(me)} className="focus-visible:outline-none"><Pill tone="purple">{tierLabel(card.tier)}</Pill></Link> : undefined}
            >
              {curatorFocus ? (
                <>
                  <p className="text-sm text-foreground">{curatorFocus.text}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{curatorFocus.curator} · нед. {weekLabel(curatorFocus.week)}</span>
                    {curatorFocus.acknowledged ? (
                      <Pill tone="up" className="ml-auto"><Check className="h-3 w-3" aria-hidden="true" />Принято</Pill>
                    ) : (
                      <Button size="sm" variant="secondary" className="ml-auto h-7 gap-1 px-2 text-xs" onClick={() => ack.mutate(curatorFocus.ratingId)} disabled={ack.isPending}>
                        <Check className="h-3 w-3" aria-hidden="true" /> {ack.isPending ? "Отмечаем…" : "Прочитал, беру в работу"}
                      </Button>
                    )}
                  </div>
                  {weakest && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Слабее всего по оценкам — {criterionLabel(weakest.key).toLowerCase()}: {weakest.now.toFixed(1)} из 10.
                    </p>
                  )}
                </>
              ) : weakest ? (
                <>
                  <p className="text-sm text-foreground">
                    Подтяните <span className="font-semibold">{criterionLabel(weakest.key)}</span>: сейчас{" "}
                    <span className="font-semibold tabular-nums">{weakest.now.toFixed(1)}</span>, цель —{" "}
                    <span className="font-semibold tabular-nums text-up">{Math.min(10, Math.floor(weakest.now) + 1)}</span>.
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">{CRITERIA.find((c) => c.key === weakest.key)?.hint}</p>
                </>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-x-2 gap-y-1 text-xs">
                <Link href={links.risk(me)} className="text-primary hover:underline">Мои лимиты риска</Link>
                <span className="text-muted-foreground" aria-hidden="true">·</span>
                <Link href={links.scaling(me)} className="text-primary hover:underline">Масштабирование</Link>
                <span className="text-muted-foreground" aria-hidden="true">·</span>
                <Link href={links.weeklyReview({ trader: me })} className="text-primary hover:underline">Разбор недели</Link>
              </div>
            </Panel>
          )}
        </div>

        <div className="flex flex-col gap-4 lg:col-span-3">
          <Panel title="Динамика оценок" description="Средний балл по критериям и общая оценка куратора, по неделям">
            {chartData.length >= 2 ? (
              <>
              <div {...weekNav.wrapperProps} className={cn("h-56 w-full", weekNav.wrapperProps.className)}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -20 }} {...weekNav.chartProps}>
                    <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="week" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                    <YAxis domain={[0, 10]} ticks={[0, 2, 4, 6, 8, 10]} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={CHART_TOOLTIP} labelFormatter={(l) => <>{String(l)}<PeriodHint kind="week" /></>} formatter={(v: number, n: string) => [v.toFixed(1), n === "overall" ? "Общая" : "Критерии"]} />
                    <Legend formatter={(v: string) => <span className="text-xs text-muted-foreground">{v === "overall" ? "Общая оценка" : "Среднее критериев"}</span>} />
                    <Line dataKey="composite" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={{ r: 3 }} />
                    <Line dataKey="overall" stroke="hsl(var(--chart-3))" strokeWidth={2} strokeDasharray="4 3" dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              {weekNav.caption}
              </>
            ) : (
              <p className="rounded-xl bg-[var(--glass-bg)] p-4 text-sm text-muted-foreground">График появится после двух недель оценок.</p>
            )}
          </Panel>

          <Panel icon={MessageSquareQuote} title="Комментарии кураторов">
            {myRatings.length === 0 ? (
              <p className="text-sm text-muted-foreground">Пока без комментариев.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {myRatings.map((r) => (
                  <li key={r.id} className="rounded-xl bg-[var(--glass-bg)] p-3">
                    <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{r.curator}</span>
                      <span>нед. {weekLabel(r.week)}</span>
                      {r.tier && <Pill tone="purple">{tierLabel(r.tier)}</Pill>}
                      <Pill tone={r.overall >= 8 ? "up" : r.overall >= 5 ? "warn" : "down"} className="ml-auto">{r.overall}/10</Pill>
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-foreground/90 [overflow-wrap:anywhere]">{r.comment}</p>
                    {r.focus?.trim() && (
                      <p className="mt-1.5 flex items-start gap-1.5 text-xs text-muted-foreground">
                        <Crosshair className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                        <span>Фокус: <span className="text-foreground">{r.focus}</span></span>
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            icon={Lightbulb}
            title="Мои идеи"
            actions={<Link href="/trade-idea-stats" className="text-xs text-primary hover:underline">Подробная статистика →</Link>}
          >
            {ideasQ.isLoading ? <Skeleton className="h-20 rounded-xl" /> : ideas.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                У вас пока нет идей. <Link href={links.newIdea()} className="text-primary hover:underline">Опубликуйте первую</Link> — и отслеживайте, как часто они срабатывают.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                <OutcomeBar wins={ideaB.wins} losses={ideaB.losses} be={ideaB.be} open={ideaB.open} />
                <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
                  <StatRow label="Идей / в сделках" value={`${ideaB.ideas} / ${ideaB.converted}`} />
                  <StatRow label="Hit rate" value={ideaB.hitRate == null ? "—" : `${Math.round(ideaB.hitRate * 100)}%`} tone={ideaB.hitRate == null ? "neutral" : ideaB.hitRate >= 0.5 ? "up" : "down"} />
                  <StatRow label="Средний R" value={fmtR(ideaB.avgR)} tone={toneOf(ideaB.avgR)} />
                  <StatRow
                    label="Калибровка скора"
                    value={<span className={cn(toneText(calibVerdict(ideaCalib).tone))}>{calibVerdict(ideaCalib).text}</span>}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {ideaB.converted} из {ideaB.ideas} {pluralRu(ideaB.ideas, "идеи", "идей", "идей")} взяты в сделку.
                </p>
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
