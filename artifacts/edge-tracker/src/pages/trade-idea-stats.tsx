import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowLeft, Award, BarChart3, Download, Lightbulb, MinusCircle, ThumbsDown, ThumbsUp, Users, X,
} from "lucide-react";
import { BASE } from "@/lib/api";
import { links } from "@/lib/links";
import { addDays, nyDate } from "@/lib/trading-date";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { QueryError } from "@/components/query-error";
import { EmptyState, Page, PageHeader, Panel, Pill, Segmented, SortableTh, StatCard, StatGrid, toneOf, toneText, useTableSort, type Tone } from "@/components/ds";
import { OutcomeBar, Sparkline, downloadCsv, fetchJson, fmtR, pluralRu, useStoredState } from "@/components/ratings/shared";
import { IdeaCalibration } from "@/components/ratings/idea-calibration";
import {
  authorStats, bucketOf, calibVerdict, calibrationOf, enrichIdea,
  type AuthorStats, type EnrichedIdea, type TradeIdea,
} from "@/components/ratings/idea-metrics";

const PERIODS = [
  { value: "30", label: "30 дней" },
  { value: "90", label: "90 дней" },
  { value: "365", label: "Год" },
  { value: "all", label: "Всё" },
] as const;
type Period = (typeof PERIODS)[number]["value"];

type SortKey = "ideas" | "conversion" | "hitRate" | "avgR" | "sumR" | "avgScore" | "calib";
const SORTS: { key: SortKey; label: string; title?: string }[] = [
  { key: "ideas", label: "Идей" },
  { key: "conversion", label: "Конверсия", title: "Доля опубликованных идей, взятых в сделку" },
  { key: "hitRate", label: "Hit rate", title: "Прибыльные / (прибыльные + убыточные) сделки из идей; безубыток не считается" },
  { key: "avgR", label: "Ср. R" },
  { key: "sumR", label: "Σ R" },
  { key: "avgScore", label: "Ср. скор" },
  { key: "calib", label: "Калибровка", title: "Корреляция скора идеи с итоговым R (нужно ≥ 5 сделок)" },
];

/** Column accessors for the authors table; empty values sink to the bottom (useTableSort). */
const AUTHOR_ACCESSORS: Record<SortKey | "trader" | "best", (a: AuthorStats) => number | string | null> = {
  trader: (a) => a.trader,
  ideas: (a) => a.ideas,
  conversion: (a) => a.conversion,
  hitRate: (a) => a.hitRate,
  avgR: (a) => a.avgR,
  sumR: (a) => (a.rCount ? a.sumR : null),
  avgScore: (a) => a.avgScore,
  calib: (a) => a.calib.r,
  best: (a) => a.best?.r ?? null,
};

const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);

/** Period start on the NY trading calendar (idea dates are NY dates, so a local-midnight cutoff would drift by a day). */
function cutoff(period: Period): string | null {
  if (period === "all") return null;
  return addDays(nyDate(), -Number(period));
}

type Majority = "thumbs_up" | "warning" | "thumbs_down" | "none";
function majorityOf(i: TradeIdea): Majority {
  const rx = i.reactions ?? [];
  if (rx.length === 0) return "none";
  for (const k of ["thumbs_up", "warning", "thumbs_down"] as const) {
    if (rx.filter((r) => r.reaction === k).length > rx.length / 2) return k;
  }
  return "none";
}
const MAJORITY_META: Record<Majority, { label: string; icon: typeof ThumbsUp; tone: Tone }> = {
  thumbs_up: { label: "Команда одобрила", icon: ThumbsUp, tone: "up" },
  warning: { label: "Команда сомневалась", icon: AlertTriangle, tone: "warn" },
  thumbs_down: { label: "Команда против", icon: ThumbsDown, tone: "down" },
  none: { label: "Без явного мнения", icon: MinusCircle, tone: "neutral" },
};

export default function TradeIdeaStats() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const me = user?.role !== "guest" ? user?.traderName ?? null : null;
  const [period, setPeriod] = useStoredState<Period>("ideaStats.period", "90", PERIODS.map((p) => p.value));
  const [author, setAuthor] = useState<string>("all");
  const [bestMode, setBestMode] = useState<"best" | "worst">("best");

  const { data, isLoading, error, refetch } = useQuery<TradeIdea[]>({
    queryKey: ["trade-ideas", "stats-list"],
    queryFn: () => fetchJson<TradeIdea[]>(`${BASE}/api/trade-ideas`),
    staleTime: 30_000,
  });

  const all = useMemo(() => (data ?? []).map(enrichIdea), [data]);
  const inPeriod = useMemo(() => {
    const c = cutoff(period);
    return c ? all.filter((i) => i.date >= c) : all;
  }, [all, period]);
  const scoped = useMemo(() => (author === "all" ? inPeriod : inPeriod.filter((i) => (i.trader ?? "(не указан)") === author)), [inPeriod, author]);

  const overall = useMemo(() => bucketOf(scoped), [scoped]);
  const calib = useMemo(() => calibrationOf(scoped), [scoped]);
  const verdict = calibVerdict(calib);
  const authorList = useMemo(() => authorStats(inPeriod).sort((a, b) => b.ideas - a.ideas), [inPeriod]);
  const { rows: authors, thProps } = useTableSort(authorList, AUTHOR_ACCESSORS, "ideas");
  const authorNames = useMemo(() => [...new Set(all.map((i) => i.trader ?? "(не указан)"))].sort(), [all]);

  const ranked = useMemo(() => {
    const withR = scoped.filter((i) => i.r != null);
    return withR.sort((a, b) => (bestMode === "best" ? b.r! - a.r! : a.r! - b.r!)).slice(0, 6);
  }, [scoped, bestMode]);

  const cohorts = useMemo(() => {
    const by: Record<Majority, EnrichedIdea[]> = { thumbs_up: [], warning: [], thumbs_down: [], none: [] };
    for (const i of scoped) by[majorityOf(i)].push(i);
    return (Object.keys(by) as Majority[]).map((k) => ({ key: k, ...bucketOf(by[k]) }));
  }, [scoped]);

  function exportCsv() {
    downloadCsv(
      `idea-stats-${period}.csv`,
      ["Автор", "Идей", "Опубликовано", "В сделках", "Конверсия %", "Прибыль", "Убыток", "Безубыток", "Hit rate %", "Ср. R", "Σ R", "Ср. скор", "Калибровка r"],
      authors.map((a) => [
        a.trader, a.ideas, a.published, a.converted,
        a.conversion == null ? "" : Math.round(a.conversion * 100), a.wins, a.losses, a.be,
        a.hitRate == null ? "" : Math.round(a.hitRate * 100),
        a.avgR == null ? "" : a.avgR.toFixed(2), a.sumR.toFixed(2),
        a.avgScore == null ? "" : a.avgScore.toFixed(0), a.calib.r == null ? "" : a.calib.r.toFixed(2),
      ]),
    );
  }

  const periodText = period === "all" ? "за всё время" : `за ${PERIODS.find((p) => p.value === period)!.label.toLowerCase()}`;

  return (
    <Page>
      <PageHeader
        icon={BarChart3}
        title="Статистика идей"
        description="Какие идеи становятся прибыльными сделками: по авторам, скору и реакциям команды"
        actions={
          <>
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={exportCsv} disabled={authors.length === 0}>
              <Download className="h-4 w-4" aria-hidden="true" /> CSV
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setLocation("/trade-ideas")}>
              <ArrowLeft className="h-4 w-4" aria-hidden="true" /> К идеям
            </Button>
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <Segmented ariaLabel="Период" options={[...PERIODS]} value={period} onChange={setPeriod} />
          <Select value={author} onValueChange={setAuthor}>
            <SelectTrigger className="h-10 w-48" aria-label="Автор идей"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все авторы</SelectItem>
              {authorNames.map((n) => <SelectItem key={n} value={n}>{n}{n === me ? " (вы)" : ""}</SelectItem>)}
            </SelectContent>
          </Select>
          {me && authorNames.includes(me) && author !== me && (
            <button type="button" className="chip min-h-8 px-3 text-sm" onClick={() => setAuthor(me)}>Мои идеи</button>
          )}
          {author !== "all" && (
            <button type="button" className="chip inline-flex min-h-8 items-center gap-1 px-3 text-sm" aria-pressed="true" onClick={() => setAuthor("all")}>
              {author} <X className="h-3.5 w-3.5" aria-label="Сбросить автора" />
            </button>
          )}
        </div>
      </PageHeader>

      {isLoading && (
        <div className="flex flex-col gap-4" aria-busy="true" aria-label="Загрузка статистики">
          <StatGrid className="xl:grid-cols-5">{[0, 1, 2, 3, 4].map((k) => <Skeleton key={k} className="h-24 rounded-2xl" />)}</StatGrid>
          <div className="grid gap-4 lg:grid-cols-5">
            <Skeleton className="h-80 rounded-2xl lg:col-span-3" />
            <Skeleton className="h-80 rounded-2xl lg:col-span-2" />
          </div>
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      )}
      {error && !data && <QueryError error={error} onRetry={() => refetch()} />}

      {data && all.length === 0 && (
        <Panel>
          <EmptyState
            icon={Lightbulb}
            title="Идей пока нет"
            description="Публикуйте торговые идеи со скором и качеством сетапа, а при входе конвертируйте их в сделку — здесь появится hit rate, средний R и калибровка по каждому автору."
            action={<Button onClick={() => setLocation("/trade-ideas")}>Перейти к идеям</Button>}
          />
        </Panel>
      )}

      {data && all.length > 0 && (
        <>
          <StatGrid className="xl:grid-cols-5">
            <StatCard label="Идей" value={overall.ideas} hint={`${overall.published} опубликовано · ${periodText}`} icon={Lightbulb} />
            <StatCard label="Конверсия в сделку" value={pct(overall.conversion)} hint={`${overall.converted} ${pluralRu(overall.converted, "сделка", "сделки", "сделок")}`} />
            <StatCard
              label="Hit rate"
              value={pct(overall.hitRate)}
              tone={overall.hitRate == null ? "neutral" : overall.hitRate >= 0.5 ? "up" : "down"}
              hint={`${overall.wins} / ${overall.losses} / ${overall.be}${overall.open ? ` · ${overall.open} откр.` : ""}`}
            />
            <StatCard label="Средний R" value={fmtR(overall.avgR)} tone={toneOf(overall.avgR)} hint={`Σ ${fmtR(overall.sumR, 1)} по ${overall.rCount}`} />
            <StatCard
              label="Калибровка скора"
              value={calib.r == null ? "—" : `${calib.r >= 0 ? "+" : "−"}${Math.abs(calib.r).toFixed(2)}`}
              tone={verdict.tone === "warn" ? "warn" : verdict.tone}
              hint={verdict.text}
            />
          </StatGrid>

          {scoped.length === 0 ? (
            <Panel>
              <EmptyState
                icon={Lightbulb}
                title={`Нет идей ${periodText}${author !== "all" ? ` у автора ${author}` : ""}`}
                action={<Button variant="outline" size="sm" onClick={() => { setPeriod("all"); setAuthor("all"); }}>Сбросить фильтры</Button>}
              />
            </Panel>
          ) : (
            <div className="grid gap-4 lg:grid-cols-5">
              <div className="lg:col-span-3"><IdeaCalibration ideas={scoped} /></div>
              <Panel
                className="lg:col-span-2"
                icon={Award}
                title={bestMode === "best" ? "Лучшие идеи" : "Худшие идеи"}
                description="По итоговому R сделки"
                actions={
                  <Segmented<"best" | "worst"> ariaLabel="Лучшие или худшие" size="sm" value={bestMode} onChange={setBestMode}
                    options={[{ value: "best", label: "Лучшие" }, { value: "worst", label: "Худшие" }]} />
                }
              >
                {ranked.length === 0 ? (
                  <EmptyState className="py-8" title="Нет сделок с R" description="Появятся, когда идеи будут конвертированы в сделки с R-мультипликатором." />
                ) : (
                  <ol className="flex flex-col gap-1">
                    {ranked.map((i, idx) => (
                      <li key={i.id}>
                        <button
                          type="button"
                          onClick={() => i.linkedTrade && setLocation(links.trade(i.linkedTrade.id))}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-xl border-l-2 px-3 py-2 text-left transition-colors hover:bg-[var(--glass-hover-bg)]",
                            (i.r ?? 0) >= 0 ? "border-l-up/60" : "border-l-down/60",
                          )}
                          aria-label={`${i.ticker}, ${fmtR(i.r)} — открыть сделку`}
                        >
                          <span className="w-4 text-xs text-muted-foreground tabular-nums">{idx + 1}</span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="font-semibold text-foreground">{i.ticker}</span>
                              {i.side && <span className="text-xs text-muted-foreground">{i.side}</span>}
                              {i.setupQuality && <Pill tone="purple" className="px-1.5 py-0 text-2xs">{i.setupQuality}</Pill>}
                            </div>
                            <div className="truncate text-xs text-muted-foreground">
                              {i.trader ?? "—"} · {i.date}{i.score != null ? ` · скор ${i.score}` : ""}{i.setup ? ` · ${i.setup}` : ""}
                            </div>
                          </div>
                          <span className={cn("font-semibold tabular-nums", toneText(toneOf(i.r)))}>{fmtR(i.r, 1)}</span>
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
              </Panel>
            </div>
          )}

          <Panel icon={Users} title="Авторы идей" description={`Нажмите на автора, чтобы отфильтровать страницу · ${periodText}`} padded={false}>
            {authors.length === 0 ? (
              <EmptyState className="py-8" title={`Нет идей ${periodText}`} />
            ) : (
              <>
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-muted-foreground">
                      <tr className="border-b border-border">
                        <SortableTh {...thProps("trader")} className="px-5 py-2.5 font-medium">Автор</SortableTh>
                        {SORTS.map((s) => (
                          <SortableTh key={s.key} {...thProps(s.key)} align="right" className="px-2 py-2.5 font-medium">
                            <span title={s.title}>{s.label}</span>
                          </SortableTh>
                        ))}
                        <SortableTh {...thProps("best")} className="px-2 py-2.5 font-medium">Лучшая идея</SortableTh>
                        <th scope="col" className="px-5 py-2.5 text-right font-medium">Тренд R</th>
                      </tr>
                    </thead>
                    <tbody>
                      {authors.map((a) => {
                        const active = author === a.trader;
                        const v = calibVerdict(a.calib);
                        return (
                          <tr
                            key={a.trader}
                            onClick={() => setAuthor(active ? "all" : a.trader)}
                            className={cn("cursor-pointer border-b border-border/60 last:border-0 transition-colors hover:bg-[var(--glass-hover-bg)]", active && "bg-primary/5")}
                          >
                            <td className="px-5 py-2.5">
                              <button type="button" aria-pressed={active} className="flex flex-col text-left" onClick={(e) => { e.stopPropagation(); setAuthor(active ? "all" : a.trader); }}>
                                <span className="font-medium text-foreground">{a.trader}{a.trader === me && <span className="ml-1.5 text-xs text-primary">вы</span>}</span>
                                <span className="text-xs text-muted-foreground tabular-nums">{a.published} опубл. · {a.converted} в сделках</span>
                              </button>
                            </td>
                            <td className="px-2 py-2.5 text-right tabular-nums">{a.ideas}</td>
                            <td className="px-2 py-2.5 text-right tabular-nums">{pct(a.conversion)}</td>
                            <td className="px-2 py-2.5">
                              <div className="ml-auto flex w-28 flex-col items-end gap-1">
                                <span className={cn("tabular-nums", a.hitRate == null ? "text-muted-foreground" : a.hitRate >= 0.5 ? "text-up" : "text-down")}>{pct(a.hitRate)}</span>
                                <OutcomeBar wins={a.wins} losses={a.losses} be={a.be} open={a.open} className="w-full" />
                              </div>
                            </td>
                            <td className={cn("px-2 py-2.5 text-right tabular-nums", toneText(toneOf(a.avgR)))}>{fmtR(a.avgR)}</td>
                            <td className={cn("px-2 py-2.5 text-right tabular-nums", toneText(toneOf(a.sumR)))}>{a.rCount ? fmtR(a.sumR, 1) : "—"}</td>
                            <td className="px-2 py-2.5 text-right tabular-nums">{a.avgScore == null ? "—" : a.avgScore.toFixed(0)}</td>
                            <td className="px-2 py-2.5 text-right" title={v.text}>
                              {a.calib.r == null
                                ? <span className="text-xs text-muted-foreground">{a.calib.n}/5</span>
                                : <Pill tone={v.tone}>{`${a.calib.r >= 0 ? "+" : "−"}${Math.abs(a.calib.r).toFixed(2)}`}</Pill>}
                            </td>
                            <td className="px-2 py-2.5">
                              {a.best ? (
                                <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                                  <span className="font-medium text-foreground">{a.best.ticker}</span>
                                  <span className={cn("text-xs tabular-nums", toneText(toneOf(a.best.r)))}>{fmtR(a.best.r, 1)}</span>
                                </span>
                              ) : <span className="text-muted-foreground">—</span>}
                            </td>
                            <td className="px-5 py-2.5"><div className="flex justify-end"><Sparkline values={a.sparkR} width={72} height={24} label={`Кумулятивный R идей ${a.trader}`} /></div></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <ul className="flex flex-col gap-2 p-3 md:hidden">
                  {authors.map((a) => {
                    const active = author === a.trader;
                    return (
                      <li key={a.trader}>
                        <button
                          type="button"
                          aria-pressed={active}
                          onClick={() => setAuthor(active ? "all" : a.trader)}
                          className={cn("flex w-full flex-col gap-2 rounded-xl bg-[var(--glass-bg)] p-3 text-left", active && "ring-1 ring-primary/60")}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-foreground">{a.trader}</span>
                            <span className={cn("font-semibold tabular-nums", toneText(toneOf(a.avgR)))}>{fmtR(a.avgR)}</span>
                          </div>
                          <OutcomeBar wins={a.wins} losses={a.losses} be={a.be} open={a.open} />
                          <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground tabular-nums">
                            <span>{a.ideas} идей</span>
                            <span>конв. {pct(a.conversion)}</span>
                            <span>hit {pct(a.hitRate)}</span>
                            {a.best && <span>лучшая {a.best.ticker} {fmtR(a.best.r, 1)}</span>}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </Panel>

          <Panel
            title="Реакции команды и исход"
            description="Идеи сгруппированы по преобладающей реакции (больше половины голосов). Если «одобренные» не выигрывают чаще — команда плохо фильтрует идеи."
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {cohorts.map((c) => {
                const meta = MAJORITY_META[c.key];
                const Icon = meta.icon;
                return (
                  <div key={c.key} className="flex flex-col gap-3 rounded-xl bg-[var(--glass-bg)] p-3">
                    <div className="flex items-center gap-2">
                      <Icon className={cn("h-4 w-4", toneText(meta.tone === "neutral" ? "neutral" : meta.tone))} aria-hidden="true" />
                      <span className="text-sm font-medium text-foreground">{meta.label}</span>
                      <span className="ml-auto text-xs text-muted-foreground tabular-nums">{c.ideas}</span>
                    </div>
                    <OutcomeBar wins={c.wins} losses={c.losses} be={c.be} open={c.open} />
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div>
                        <div className="text-2xs text-muted-foreground">В сделках</div>
                        <div className="font-semibold tabular-nums text-foreground">{c.converted}</div>
                      </div>
                      <div>
                        <div className="text-2xs text-muted-foreground">Hit rate</div>
                        <div className={cn("font-semibold tabular-nums", c.hitRate == null ? "text-muted-foreground" : c.hitRate >= 0.5 ? "text-up" : "text-down")}>{pct(c.hitRate)}</div>
                      </div>
                      <div>
                        <div className="text-2xs text-muted-foreground">Ср. R</div>
                        <div className={cn("font-semibold tabular-nums", toneText(toneOf(c.avgR)))}>{fmtR(c.avgR, 1)}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>

          <p className="text-xs text-muted-foreground">
            Hit rate — прибыльные / (прибыльные + убыточные) сделки из идей, безубыток не входит; R и P&L — нетто, по общей формуле сделок. Калибровка — корреляция скора идеи (0–100) с итоговым R; считается при ≥ 5 сделках.
            Командный рейтинг — в разделе <Link href="/ratings" className="text-primary hover:underline">Рейтинг</Link>.
          </p>
        </>
      )}
    </Page>
  );
}
