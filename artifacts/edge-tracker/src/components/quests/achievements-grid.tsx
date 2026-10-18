import { useState } from "react";
import { Trophy } from "lucide-react";
import { EmptyState, FilterChip } from "@/components/ds";
import { cn } from "@/lib/utils";
import { fmtDayMonth } from "@/lib/format";
import { questsI18n } from "@/i18n/ns/quests";
import type { Achievement, AchievementCategory } from "@/lib/quests/types";
import {
  TIER_ORDER, achievementHint, achievementPct, achievementTitle, categoriesOf, earnedTiers, isHidden, nextTier, sortAchievements, tierLabel,
} from "./model";
import { Medal, TIER_TONE, TierDot } from "./medal";

/** One line: medal in the highest tier colour, tier dots with dates, progress to the next tier and how to get it. */
export function AchievementCard({ a, highlight = false }: { a: Achievement; highlight?: boolean }) {
  const { t } = questsI18n.useT();
  const hidden = isHidden(a);
  const next = nextTier(a);
  const top = earnedTiers(a)[0] ?? null;
  const tiers = [...a.tiers].sort((x, y) => TIER_ORDER.indexOf(x.tier) - TIER_ORDER.indexOf(y.tier));
  return (
    <li id={`ach-${a.id}`} className={cn("tile flex min-w-0 items-start gap-3 px-3 py-2.5", highlight && "ring-2 ring-primary")}>
      <Medal category={a.category} tier={a.tier} hidden={hidden} size="lg" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-2">
          <span className={cn("min-w-0 text-sm font-semibold leading-snug", a.tier ? "text-foreground" : "text-muted-foreground")}>
            {hidden ? t("achievements.secret") : achievementTitle(a)}
          </span>
          {top?.earnedAt && (
            <span className={cn("shrink-0 text-xs font-medium", TIER_TONE[top.tier].text)}>
              {t("achievements.earnedOn", { tier: tierLabel(top.tier), date: fmtDayMonth(top.earnedAt) })}
            </span>
          )}
        </div>
        {hidden ? (
          <p className="text-xs text-muted-foreground">{t("achievements.secretHint")}</p>
        ) : (
          <>
            <ul className="flex items-center gap-1.5" aria-label={t("achievements.tiersAria")}>
              {tiers.map((s) => {
                const label = s.earnedAt
                  ? t("achievements.tierEarned", { tier: tierLabel(s.tier), date: fmtDayMonth(s.earnedAt) })
                  : t("achievements.tierLocked", { tier: tierLabel(s.tier), target: s.target });
                return (
                  <li key={s.tier} title={label} className="inline-flex items-center gap-1 text-2xs tabular-nums text-muted-foreground">
                    <TierDot tier={s.tier} earned={!!s.earnedAt} />
                    <span className="sr-only">{label}</span>
                    <span aria-hidden="true">{s.target}</span>
                  </li>
                );
              })}
            </ul>
            {next ? (
              <div className="flex flex-col gap-0.5">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="h-1.5 w-full overflow-hidden rounded-full bg-foreground/10" aria-hidden="true">
                    <span className={cn("block h-full rounded-full", TIER_TONE[next.tier].bar)} style={{ width: `${achievementPct(a)}%` }} />
                  </span>
                </span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {t("achievements.next", { tier: tierLabel(next.tier), current: Math.min(a.current, next.target), target: next.target })}
                </span>
                <span className="text-xs text-muted-foreground">{achievementHint(a, next.target)}</span>
              </div>
            ) : (
              <span className="text-xs text-muted-foreground">{t("achievements.maxed")}</span>
            )}
          </>
        )}
      </div>
    </li>
  );
}

/** Achievements with a category filter («Все» + the categories present). */
export function AchievementsGrid({ list, highlight }: { list: readonly Achievement[]; highlight?: string | null }) {
  const { t } = questsI18n.useT();
  const cats = categoriesOf(list);
  const initial = highlight ? list.find((a) => a.id === highlight)?.category ?? "all" : "all";
  const [cat, setCat] = useState<AchievementCategory | "all">(initial);
  const shown = sortAchievements(cat === "all" ? list : list.filter((a) => a.category === cat));
  return (
    <div className="flex flex-col gap-3">
      {cats.length > 1 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("achievements.filterAria")}>
          <FilterChip size="sm" active={cat === "all"} onClick={() => setCat("all")} count={list.length}>{t("achievements.all")}</FilterChip>
          {cats.map((c) => (
            <FilterChip key={c} size="sm" active={cat === c} onClick={() => setCat(cat === c ? "all" : c)} count={list.filter((a) => a.category === c).length}>
              {t(`category.${c}`)}
            </FilterChip>
          ))}
        </div>
      )}
      {shown.length === 0 ? (
        <EmptyState compact icon={Trophy} title={t("achievements.empty")} />
      ) : (
        <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3">
          {shown.map((a) => <AchievementCard key={a.id} a={a} highlight={a.id === highlight} />)}
        </ul>
      )}
    </div>
  );
}
