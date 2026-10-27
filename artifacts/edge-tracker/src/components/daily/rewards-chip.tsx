import { useId, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Award, ChevronDown, Flame, Snowflake } from "lucide-react";
import type { DisciplineSummary } from "@/lib/daily/types";
import type { GamificationMe } from "@/lib/gamification/types";
import { gamificationMeQuery, questsMeQuery } from "@/lib/api/queries";
import { cn } from "@/lib/utils";
import { dailyI18n } from "@/i18n/ns/daily";
import { gamificationI18n } from "@/i18n/ns/gamification";
import { levelName } from "@/components/shared/badges";
import { SeasonBar } from "@/components/shared/season-bar";
import { FreezeLine, freezeUsedText } from "@/components/shared/freeze-line";
import { fmtDelta } from "./daily-model";

type Earned = { earned: number; total: number } | null;

/**
 * «🔥 4 · Стабильный · 185 очк. · 🏅 6» — the kept-contract streak, level, discipline points and achievements earned,
 * next to the tier progress where the trader looks every day; the «Награды» block (level progress, streak, streak
 * freeze, the season bar) opens in place. Badges are tiers of the achievements now (one award system) — the full list
 * lives in «Квесты и достижения». Points reward the own contract only — never trading more. `defaultOpen` = the
 * rewards notification's link (/?rewards=1). Season / freeze / achievements come from their own cache entries (shared
 * with the quests tab) and simply stay hidden on an older API.
 */
export function RewardsChip({ discipline, defaultOpen = false }: { discipline: DisciplineSummary | null | undefined; defaultOpen?: boolean }) {
  const { t } = dailyI18n.useT();
  const tg = gamificationI18n.useT().t;
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  const gami = useQuery({ ...gamificationMeQuery(), enabled: !!discipline }).data ?? null;
  const quests = useQuery({ ...questsMeQuery(), enabled: !!discipline }).data ?? null;
  if (!discipline) return null;
  const earned: Earned = quests ? { earned: quests.summary.achievementsEarned, total: quests.summary.achievementsTotal } : null;
  const hot = discipline.streak > 0;
  const frozen = freezeUsedText(gami?.freeze);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={t("rewards.chipAria", { streak: discipline.streak, points: discipline.pointsTotal })}
        title={frozen ?? undefined}
        className="group inline-flex min-h-8 min-w-0 flex-wrap items-center gap-x-1.5 self-start rounded-lg px-1.5 text-sm font-medium transition-colors hover:bg-[var(--glass-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Flame className={cn("h-4 w-4 shrink-0", hot ? "text-warn" : "text-muted-foreground")} aria-hidden="true" />
        <span className="tabular-nums">{discipline.streak}</span>
        {frozen && <Snowflake className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />}
        <span className="text-muted-foreground" aria-hidden="true">·</span>
        <span className="truncate">{levelName(discipline.level)}</span>
        <span className="text-muted-foreground" aria-hidden="true">·</span>
        <span className="tabular-nums">{t("rewards.points", { points: discipline.pointsTotal })}</span>
        {earned && earned.total > 0 && (
          <span className="inline-flex items-center gap-0.5 text-muted-foreground" title={tg("chip.achievementsAria", { earned: earned.earned, total: earned.total })}>
            <Award className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="tabular-nums">{earned.earned}</span>
          </span>
        )}
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>
      {open && <RewardsPanel id={panelId} discipline={discipline} gami={gami} earned={earned} />}
    </div>
  );
}

function RewardsPanel({ id, discipline: d, gami, earned }: { id: string; discipline: DisciplineSummary; gami: GamificationMe | null; earned: Earned }) {
  const { t } = dailyI18n.useT();
  const tq = gamificationI18n.useT().t;
  const span = d.nextLevelAt != null ? d.nextLevelAt - d.levelFrom : 0;
  const pct = d.nextLevelAt == null ? 100 : span > 0 ? Math.max(0, Math.min(100, Math.round(((d.pointsTotal - d.levelFrom) / span) * 100))) : 0;
  return (
    <div id={id} className="flex w-full min-w-0 flex-col gap-3 rounded-xl bg-foreground/[0.04] p-3 lg:w-[28rem]">
      <div className="flex flex-col gap-1.5">
        <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <span className="text-sm font-semibold">{levelName(d.level)}</span>
          <span className="text-xs tabular-nums text-muted-foreground">
            {d.nextLevelAt != null ? t("rewards.levelTo", { level: levelName(d.level + 1), left: Math.max(0, d.nextLevelAt - d.pointsTotal) }) : t("rewards.levelTop")}
          </span>
        </div>
        <span className="h-1.5 w-full overflow-hidden rounded-full bg-foreground/10" aria-hidden="true">
          <span className="block h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
        </span>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs tabular-nums text-muted-foreground">
          <span>{t("rewards.window", { days: d.windowDays, points: fmtDelta(d.points30) })}</span>
          <span>{t("rewards.total", { points: d.pointsTotal })}</span>
        </div>
      </div>
      <div className="flex min-w-0 items-start gap-1.5 text-xs">
        <Flame className={cn("mt-px h-3.5 w-3.5 shrink-0", d.streak > 0 ? "text-warn" : "text-muted-foreground")} aria-hidden="true" />
        <p className="min-w-0">
          <span className="font-medium text-foreground">
            {d.streak > 0 ? t("rewards.streak", { days: t("rewards.streakDays", { count: d.streak }) }) : t("rewards.streakNone")}
          </span>
          {d.bestStreak > d.streak && <span className="text-muted-foreground"> · {t("rewards.best", { count: d.bestStreak })}</span>}
          {d.nextBonus > 0 && <span className="text-muted-foreground"> · {t("rewards.nextBonus", { bonus: d.nextBonus })}</span>}
        </p>
      </div>
      <FreezeLine freeze={gami?.freeze} />
      <SeasonBar season={gami?.season} href="/ratings?tab=season" />
      {earned && earned.total > 0 && (
        <div className="flex min-w-0 items-center gap-1.5 text-xs">
          <Award className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="tabular-nums text-foreground">{tq("chip.achievementsAria", { earned: earned.earned, total: earned.total })}</span>
        </div>
      )}
      <p className="text-2xs leading-snug text-muted-foreground">{t("rewards.hint")}</p>
      <Link href="/ratings?tab=quests" className="inline-flex min-h-8 items-center gap-1 self-start rounded-lg px-1 text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {t("rewards.allLink")}
        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
    </div>
  );
}
