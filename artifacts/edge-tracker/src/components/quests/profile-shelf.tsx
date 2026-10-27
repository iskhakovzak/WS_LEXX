/**
 * The achievements shelf of the profile (/profile and /people/:id): every line by category — earned with the date,
 * in progress with its bar and «ещё N …», ahead — in one place. Own profile: GET /api/quests/me; a curator looking at a
 * trader: GET /api/quests/trader/:name (journal.review); anyone else gets nothing (403 → the shelf is not shown).
 * Passed into the profile by the page (components/profile is another feature).
 */
import { Link } from "wouter";
import { ChevronRight, Trophy } from "lucide-react";
import { Panel, PanelSkeleton } from "@/components/ds";
import { questsI18n } from "@/i18n/ns/quests";
import { useQuestsMe, useTraderQuests } from "./api";
import { AchievementsGrid } from "./achievements-grid";
import { PROGRESS_HREF } from "./quest-strip";

export function ProfileAchievements({ trader, self }: { trader: string; self: boolean }) {
  const { t } = questsI18n.useT();
  const mine = useQuestsMe(self);
  const theirs = useTraderQuests(self ? null : trader);
  const q = self ? mine : theirs;
  if (q.isLoading) return <PanelSkeleton />;
  const data = q.data;
  if (!data || !data.achievements.length) return null;
  return (
    <Panel
      title={t("profile.title")}
      icon={Trophy}
      actions={
        <span className="flex items-center gap-2">
          <span className="text-xs tabular-nums text-muted-foreground">{t("achievements.earned", { earned: data.summary.achievementsEarned, total: data.summary.achievementsTotal })}</span>
          {self && (
            <Link href={PROGRESS_HREF} className="inline-flex min-h-8 items-center gap-0.5 rounded-lg px-1.5 text-xs font-medium text-primary hover:underline">
              {t("profile.all")}
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          )}
        </span>
      }
    >
      <AchievementsGrid list={data.achievements} />
    </Panel>
  );
}
