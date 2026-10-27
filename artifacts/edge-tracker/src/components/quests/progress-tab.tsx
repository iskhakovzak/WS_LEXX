import { useEffect, useRef, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearch } from "wouter";
import { Flame, Swords, Trophy } from "lucide-react";
import { EmptyState, Panel, PanelSkeleton, Pill } from "@/components/ds";
import { levelName } from "@/components/shared/badges";
import { cn } from "@/lib/utils";
import { fmtNum } from "@/lib/format";
import { dailyMeQuery } from "@/lib/api/queries";
import type { DisciplineSummary } from "@/lib/daily/types";
import type { QuestsMe } from "@/lib/quests/types";
import { nyDate } from "@/lib/trading-date";
import { dailyI18n } from "@/i18n/ns/daily";
import { questsI18n } from "@/i18n/ns/quests";
import { useQuestsMe } from "./api";
import { AchievementsGrid } from "./achievements-grid";
import { QuestsBoard } from "./quests-board";
import { AchievementCeremony } from "./ceremony";

/** Level and points (the same discipline summary as the dashboard «Награды» block) + quest / achievement totals. */
function ProgressHeader({ data, discipline: d, extra }: { data: QuestsMe; discipline: DisciplineSummary | null | undefined; extra?: ReactNode }) {
  const { t } = questsI18n.useT();
  const td = dailyI18n.useT().t;
  const s = data.summary;
  const span = d && d.nextLevelAt != null ? d.nextLevelAt - d.levelFrom : 0;
  const pct = !d ? 0 : d.nextLevelAt == null ? 100 : span > 0 ? Math.max(0, Math.min(100, Math.round(((d.pointsTotal - d.levelFrom) / span) * 100))) : 0;
  return (
    <Panel aria-label={t("header.aria")}>
      <div className="flex flex-col gap-3">
        {d && (
          <div className="flex flex-col gap-1.5">
            <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <span className="flex items-baseline gap-2">
                <span className="text-xl font-semibold text-foreground">{levelName(d.level)}</span>
                <span className="text-sm tabular-nums text-muted-foreground">{td("rewards.points", { points: d.pointsTotal })}</span>
              </span>
              <span className="text-xs tabular-nums text-muted-foreground">
                {d.nextLevelAt != null ? td("rewards.levelTo", { level: levelName(d.level + 1), left: Math.max(0, d.nextLevelAt - d.pointsTotal) }) : td("rewards.levelTop")}
              </span>
            </div>
            <span className="h-2 w-full overflow-hidden rounded-full bg-foreground/10" aria-hidden="true">
              <span className="block h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
            </span>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Flame className={cn("h-3.5 w-3.5", d.streak > 0 ? "text-warn" : "text-muted-foreground")} aria-hidden="true" />
                {d.streak > 0 ? td("rewards.streak", { days: td("rewards.streakDays", { count: d.streak }) }) : td("rewards.streakNone")}
              </span>
              <span>{td("rewards.window", { days: d.windowDays, points: fmtNum(d.points30, { signed: true, decimals: 0 }) })}</span>
            </div>
          </div>
        )}
        <div className={cn("flex flex-wrap gap-1.5", d && "border-t border-[var(--glass-border)] pt-3")}>
          {s.onboarding && s.onboarding.done < s.onboarding.total && <Pill tone="purple">{t("header.onboarding", { done: s.onboarding.done, total: s.onboarding.total })}</Pill>}
          {s.weekTotal > 0 && <Pill tone="accent">{t("header.weekDone", { done: s.weekDone, total: s.weekTotal })}</Pill>}
          <Pill tone="neutral">{t("header.achievements", { earned: s.achievementsEarned, total: s.achievementsTotal })}</Pill>
        </div>
        {extra}
        <p className="text-xs leading-snug text-muted-foreground">{t("header.rules")}</p>
      </div>
    </Panel>
  );
}

/**
 * Presentational: header, quests by scope, achievements grid. `focus` — a deep link (?quest= / ?ach=). Slots composed by
 * the page (components/gamification is another feature): `header` — season bar, freeze, title under the level;
 * `extra` — mastery and the rewards catalog under the achievements.
 */
export function QuestsProgressView({ data, discipline, focus, header, extra }: { data: QuestsMe; discipline?: DisciplineSummary | null; focus?: { quest?: number | null; ach?: string | null }; header?: ReactNode; extra?: ReactNode }) {
  const { t } = questsI18n.useT();
  const focusQuest = focus?.quest != null ? data.quests.find((q) => q.id === focus.quest) ?? null : null;
  const focusId = focusQuest?.id ?? null;
  const focusAch = focus?.ach ?? null;
  useEffect(() => {
    const id = focusId != null ? `quest-${focusId}` : focusAch ? `ach-${focusAch}` : null;
    if (!id) return;
    const timer = window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: "center" }), 450);
    return () => window.clearTimeout(timer);
  }, [focusId, focusAch]);
  return (
    <div className="flex flex-col gap-[var(--grid-gap)]">
      <ProgressHeader data={data} discipline={discipline} extra={header} />
      <Panel title={t("board.title")} icon={Swords} description={t("board.description")}>
        <QuestsBoard quests={data.quests} today={data.today} historyOpen={!!focusQuest && focusQuest.status !== "active"} highlight={focusQuest?.id ?? null} />
      </Panel>
      <Panel
        title={t("achievements.title")}
        icon={Trophy}
        description={t("achievements.description")}
        actions={<span className="text-xs tabular-nums text-muted-foreground">{t("achievements.earned", { earned: data.summary.achievementsEarned, total: data.summary.achievementsTotal })}</span>}
      >
        <AchievementsGrid list={data.achievements} highlight={focus?.ach ?? null} />
      </Panel>
      {extra}
    </div>
  );
}

function focusOf(search: string): { quest: number | null; ach: string | null } {
  const p = new URLSearchParams(search);
  const q = Number(p.get("quest"));
  return { quest: Number.isInteger(q) && q > 0 ? q : null, ach: p.get("ach") };
}

/** /ratings → «Квесты и достижения»: the viewer's own progress (one place; the dashboard strip links here). */
export function QuestsProgressTab({ header, extra }: { header?: ReactNode; extra?: ReactNode } = {}) {
  const { t } = questsI18n.useT();
  const q = useQuestsMe(true);
  const search = useSearch();
  const daily = useQuery({ ...dailyMeQuery(nyDate()), retry: false });
  const focus = focusOf(search);
  // A notification about a quest the cached list does not know yet (finished / given a moment ago): refetch once.
  const refetched = useRef<number | null>(null);
  const missing = focus.quest != null && !!q.data && !q.isFetching && !q.data.quests.some((x) => x.id === focus.quest);
  useEffect(() => {
    if (!missing || refetched.current === focus.quest) return;
    refetched.current = focus.quest;
    void q.refetch();
  }, [missing, focus.quest, q]);
  if (q.isLoading) return <PanelSkeleton />;
  if (!q.data) return <EmptyState icon={Swords} title={q.isError ? t("curator.loadFailed") : t("board.empty")} description={q.isError ? undefined : t("board.emptyHint")} />;
  return (
    <>
      <QuestsProgressView data={q.data} discipline={daily.data?.discipline} focus={focus} header={header} extra={extra} />
      <AchievementCeremony me={q.data} />
    </>
  );
}
