/**
 * «Тренажёр» home: four mode cards and the 30-day line. «Задача дня» is the focal card (one ticker-day for the whole
 * desk, played once; after the finish: the R, the place, the streak and the ranking). «Мои дни» replays an own losing
 * trade, «Найди вход» runs 10 short drills on a playbook setup (mastery per setup), «Свободная игра» is the fair random
 * game (level + bar size, prefilled from the last choice) whose main entry is «Серия из 10» (fast reps, a summary at the
 * end); «Одна игра» stays as the quiet second button. Each card continues its own unfinished game, so nothing is
 * started twice (closure).
 */
import { useQuery } from "@tanstack/react-query";
import { CalendarCheck, CalendarClock, Crosshair, Dices, Flame, Gauge, Layers, Play, RotateCcw, Shuffle, TrendingDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorState, ListSkeleton, Segmented, toneOf, toneText } from "@/components/ds";
import { MasteryChip } from "@/components/shared/mastery-chip";
import { fmtDayMonth, fmtR, fmtUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { simI18n } from "@/i18n/ns/simulator";
import { trainerI18n } from "@/i18n/ns/trainer";
import type { TrainerHome } from "@/lib/trainer/types";
import { ownCandidatesQuery, type Difficulty, type IntradayTf, type SimMode, type Snapshot } from "./api";
import { DailyRanking } from "./daily-reveal";
import { dailyCardText } from "@/lib/trainer/daily-window";
import { useSeriesChoice } from "./series-context";
import { FREE_TFS, type SeriesChoice } from "./series-model";

const LEVELS: Difficulty[] = ["easy", "medium", "hard"];

export type HomeActions = {
  starting: boolean;
  active: Snapshot | null;
  onDaily: () => void;
  /** The closed challenge as an unranked game (weekend / after the close). Absent ⇒ no button. */
  onDailyPractice?: () => void;
  onOpenGame: (id: number) => void;
  onResume: () => void;
  onMyDays: (pick: "worst" | "random") => void;
  onFindEntry: (setupId: number | null) => void;
  onFree: (mode: SimMode, level: Difficulty, tf: IntradayTf | null) => void;
  /** «Серия из 10» with the chosen level / bar size. Absent ⇒ the card offers the single game only. */
  onSeries?: (choice: SeriesChoice) => void;
  /** An unfinished series whose game is the active one: «Продолжить серию · 3 / 10». */
  series?: { n: number; size: number } | null;
};

function Card({ title, icon: Icon, children, className, accent }: { title: string; icon: typeof Play; children: React.ReactNode; className?: string; accent?: boolean }) {
  return (
    <section className={cn("glass-panel flex min-w-0 flex-col gap-3 rounded-2xl p-[var(--panel-p)]", accent && "ring-1 ring-primary/40", className)}>
      <h2 className="flex items-center gap-2 text-sm font-semibold"><Icon className={cn("h-4 w-4", accent ? "text-primary" : "text-muted-foreground")} aria-hidden="true" />{title}</h2>
      {children}
    </section>
  );
}

export function TrainerStatsLine({ stats }: { stats: TrainerHome["stats"] | undefined }) {
  const { t } = trainerI18n.useT();
  if (!stats) return null;
  const parts = [
    t("stats.attempts", { count: stats.attempts30d }),
    stats.avgR30d != null ? t("stats.avgR", { value: fmtR(stats.avgR30d) }) : null,
    stats.beatReal > 0 ? t("stats.beatReal", { count: stats.beatReal }) : null,
    stats.findEntryAccuracy != null ? t("stats.accuracy", { value: Math.round(stats.findEntryAccuracy) }) : null,
  ].filter(Boolean);
  return <p className="text-xs tabular-nums text-muted-foreground">{t("stats.title")}: {parts.join(" · ")}</p>;
}

export function TrainerCards({ home, loading, error, onRetry, a }: { home: TrainerHome | undefined; loading: boolean; error: unknown; onRetry: () => void; a: HomeActions }) {
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  return (
    <div className="grid grid-cols-1 gap-[var(--grid-gap)] lg:grid-cols-2">
      <DailyCard home={home} loading={loading} a={a} />
      <FindEntryCard home={home} loading={loading} a={a} />
      <MyDaysCard home={home} loading={loading} a={a} />
      <FreeCard a={a} />
    </div>
  );
}

function DailyCard({ home, loading, a }: { home: TrainerHome | undefined; loading: boolean; a: HomeActions }) {
  const { t } = trainerI18n.useT();
  const d = home?.daily;
  // The viewer's daily game for the review (`gameId`, any status; older servers: only the active one).
  const reviewId = d ? d.gameId ?? d.activeGameId : null;
  // The ranked window is the evening (item 1.8): closed = outside it and not played — results only, the next one tonight.
  const text = d ? dailyCardText(d) : null;
  const closed = !!d && !d.played && !text?.open;
  return (
    <Card title={t("daily.title")} icon={CalendarCheck} accent>
      {loading || !d ? <ListSkeleton rows={3} /> : (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="text-xs text-muted-foreground">{text?.hint}</p>
              {text?.window && <p className="text-xs font-medium">{text.window}</p>}
            </div>
            {d.streak > 0 && <p className="flex items-center gap-1 text-xs font-medium"><Flame className="h-3.5 w-3.5 text-warn" aria-hidden="true" />{t("daily.streak", { count: d.streak })}</p>}
          </div>
          {d.played || closed ? (
            <>
              <div className="tile flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-xl p-3">
                {d.revealed && <p className="text-base font-semibold">{t("daily.revealedShort", { ticker: d.revealed.ticker, date: fmtDayMonth(d.revealed.barsDate) })}</p>}
                {d.my?.r != null && <p className={cn("text-xl font-semibold tabular-nums", toneText(toneOf(d.my.r)))}>{fmtR(d.my.r)}</p>}
                {d.my?.rank != null && <p className="text-sm text-muted-foreground">{t("daily.myPlace", { rank: d.my.rank, of: d.my.of })}</p>}
              </div>
              <DailyRanking d={d} max={3} />
              {reviewId != null && <Button variant="outline" className="self-start" onClick={() => a.onOpenGame(reviewId)}>{t("daily.review")}</Button>}
              {closed && reviewId == null && a.onDailyPractice && (
                // Weekend / after the close and not played: the same day, unranked (UMID-07) — never a dead end.
                <div className="flex flex-col gap-1.5">
                  <Button size="lg" variant="secondary" className="min-h-12 self-stretch sm:self-start sm:px-8" disabled={a.starting} onClick={a.onDailyPractice}>
                    <Play aria-hidden="true" /> {a.starting ? simI18n.t("start.starting") : t("daily.practice")}
                  </Button>
                  <p className="text-2xs text-muted-foreground">{t("daily.practiceHint")}</p>
                </div>
              )}
            </>
          ) : (
            <Button size="lg" className="min-h-12 self-stretch sm:self-start sm:px-8" disabled={a.starting} onClick={d.activeGameId != null ? () => a.onOpenGame(d.activeGameId!) : a.onDaily}>
              <Play aria-hidden="true" /> {d.activeGameId != null ? t("daily.continue") : a.starting ? simI18n.t("start.starting") : t("daily.play")}
            </Button>
          )}
        </>
      )}
    </Card>
  );
}

function MyDaysCard({ home, loading, a }: { home: TrainerHome | undefined; loading: boolean; a: HomeActions }) {
  const { t } = trainerI18n.useT();
  const own = useQuery(ownCandidatesQuery());
  const m = home?.myDays;
  const worst = own.data?.trades.find((x) => x.tradeId === own.data?.worst) ?? null;
  return (
    <Card title={t("myDays.title")} icon={RotateCcw}>
      {loading || !m ? <ListSkeleton rows={2} /> : m.active ? (
        <Button size="lg" className="self-start" onClick={() => a.onOpenGame(m.active!.gameId)}><Play aria-hidden="true" /> {t("myDays.continue", { ticker: m.active.ticker })}</Button>
      ) : m.candidates === 0 ? (
        <p className="text-sm text-muted-foreground">{t("myDays.none")}</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">{t("myDays.hint", { count: m.candidates })}</p>
          <div className="flex flex-wrap gap-2">
            <Button disabled={a.starting} onClick={() => a.onMyDays("worst")}>
              <TrendingDown aria-hidden="true" /> {worst ? t("myDays.worstWith", { ticker: worst.ticker, date: fmtDayMonth(worst.date), net: fmtUsd(worst.net, { signed: true, decimals: 0 }) }) : t("myDays.worst")}
            </Button>
            <Button variant="ghost" disabled={a.starting} onClick={() => a.onMyDays("random")}><Dices aria-hidden="true" /> {t("myDays.random")}</Button>
          </div>
        </>
      )}
    </Card>
  );
}

function FindEntryCard({ home, loading, a }: { home: TrainerHome | undefined; loading: boolean; a: HomeActions }) {
  const { t } = trainerI18n.useT();
  const f = home?.findEntry;
  const setups = (f?.setups ?? []).filter((s) => s.drills > 0);
  return (
    <Card title={t("findEntry.title")} icon={Crosshair}>
      {loading || !f ? <ListSkeleton rows={4} /> : setups.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("findEntry.none")}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-xs text-muted-foreground">{t("findEntry.hint")}</p>
            {f.streak > 0 && <p className="flex items-center gap-1 text-xs font-medium"><Flame className="h-3.5 w-3.5 text-warn" aria-hidden="true" />{t("findEntry.streak", { count: f.streak })}</p>}
          </div>
          <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto pr-1" aria-label={t("findEntry.setups")}>
            {setups.map((s) => (
              <li key={s.setupId}>
                <button
                  type="button" onClick={() => a.onFindEntry(s.setupId)}
                  className="tile flex min-h-11 w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left hover:bg-[var(--tile-hover-bg)]"
                  title={t("findEntry.startSetup", { name: s.name })}
                >
                  <span className="min-w-0 flex-1 truncate text-sm">{s.code ? <span className="mr-1.5 tabular-nums text-muted-foreground">{s.code}</span> : null}{s.name}</span>
                  <MasteryChip level={s.masteryLevel} size="xs" />
                  {s.masteryPoints != null && (
                    // Progress to the next level, so a run of drills visibly moves the card (UMID-18).
                    <span
                      className="shrink-0 text-2xs tabular-nums text-muted-foreground"
                      title={s.masteryNext != null ? t("findEntry.progressTitle", { points: s.masteryPoints, next: s.masteryNext, passed: s.drillsPassed ?? 0 }) : undefined}
                    >
                      {s.masteryNext != null ? t("findEntry.progress", { points: s.masteryPoints, next: s.masteryNext }) : t("findEntry.progressMax")}
                    </span>
                  )}
                  <span className="hidden shrink-0 text-2xs tabular-nums text-muted-foreground sm:inline">{t("findEntry.drills", { count: s.drills })}</span>
                </button>
              </li>
            ))}
          </ul>
          {f.drillsPerPoint != null && f.passScore != null && (
            <p className="text-2xs text-muted-foreground">{t("findEntry.pointsRule", { count: f.drillsPerPoint, score: f.passScore })}</p>
          )}
          <Button className="self-start" onClick={() => a.onFindEntry(null)}><Shuffle aria-hidden="true" /> {t("findEntry.mixed")}</Button>
        </>
      )}
    </Card>
  );
}

function FreeCard({ a }: { a: HomeActions }) {
  const { t } = trainerI18n.useT();
  const { t: ts } = simI18n.useT();
  const { choice, level, tf, setLevel, setTf } = useSeriesChoice();
  const act = a.active;
  const freeActive = act && !act.own && !act.trainer ? act : null;
  const single = () => a.onFree(choice.mode, choice.difficulty, choice.tf);
  return (
    <Card title={t("free.title")} icon={Gauge}>
      <p className="text-xs text-muted-foreground">{a.onSeries ? t("series.hint") : t("free.hint")}</p>
      {freeActive && (
        <div className="tile flex flex-wrap items-center gap-2 rounded-xl p-2.5">
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">{ts("start.resumeHint", { played: freeActive.cursor - freeActive.startIdx, total: freeActive.endIdx - freeActive.startIdx })}</p>
          <Button size="sm" onClick={a.onResume}>{a.series ? t("series.continue", { n: a.series.n, size: a.series.size }) : ts("start.resume")}</Button>
        </div>
      )}
      <div className="flex flex-col gap-2">
        <Segmented ariaLabel={ts("start.levelLabel")} value={level} onChange={setLevel} options={LEVELS.map((d) => ({ value: d, label: ts(`difficulty.${d}`) }))} />
        <Segmented
          ariaLabel={ts("start.tfLabel")} value={tf} onChange={setTf}
          options={FREE_TFS.map((x) => ({ value: x, label: x === "1d" ? <><CalendarClock aria-hidden="true" />{t("free.daily")}</> : x }))}
        />
        <p className="text-2xs text-muted-foreground">{tf === "1d" ? ts(`levelHint.swing.${level}`) : ts(`levelHint.intraday.${level}`)}</p>
      </div>
      {a.onSeries ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="lg" className="min-h-12 flex-1 sm:flex-none sm:px-8" disabled={a.starting} onClick={() => a.onSeries?.(choice)}>
            <Layers aria-hidden="true" /> {a.starting ? ts("start.starting") : t("series.start")}
          </Button>
          <Button variant="ghost" disabled={a.starting} onClick={single}><Play aria-hidden="true" /> {t("series.single")}</Button>
        </div>
      ) : (
        <Button size="lg" className="self-stretch sm:self-start sm:px-8" disabled={a.starting} onClick={single}>
          <Play aria-hidden="true" /> {a.starting ? ts("start.starting") : ts("start.play")}
        </Button>
      )}
    </Card>
  );
}
