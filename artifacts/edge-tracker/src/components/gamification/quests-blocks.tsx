import { useEffect, useState } from "react";
import { useSearch } from "wouter";
import { Target } from "lucide-react";
import { Panel } from "@/components/ds";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SeasonBar } from "@/components/shared/season-bar";
import { FreezeLine } from "@/components/shared/freeze-line";
import { SetupMasteryChip } from "@/components/shared/mastery-chip";
import { setupShortName, titleLabel } from "@/components/shared/gamification-labels";
import { useToast } from "@/hooks/use-toast";
import { humanizeApiError } from "@/lib/api/errors";
import { fmtDayMonth } from "@/lib/format";
import type { GamificationMe, SetupMastery } from "@/lib/gamification/types";
import { gamificationI18n } from "@/i18n/ns/gamification";
import { useGamificationMe, useSetTitle } from "./api";
import { RewardsCatalog } from "./rewards-catalog";

const NONE = "__none__";

/** Pick the own title (shown next to the name in rankings). */
export function TitlePicker({ titles, active }: { titles: GamificationMe["titles"]; active: string | null }) {
  const { t } = gamificationI18n.useT();
  const { toast } = useToast();
  const save = useSetTitle();
  const known = titles.filter((x) => titleLabel(x.key));
  if (known.length === 0) return <p className="text-xs text-muted-foreground">{t("titles.noneEarned")}</p>;
  return (
    <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3" title={t("titles.pickHint")}>
      <label htmlFor="gm-title" className="text-xs font-medium text-foreground sm:w-44 sm:shrink-0">{t("titles.pick")}</label>
      <Select
        value={active && known.some((x) => x.key === active) ? active : NONE}
        disabled={save.isPending}
        onValueChange={(v) =>
          save.mutate(v === NONE ? null : v, {
            onSuccess: () => toast({ title: t("titles.saved") }),
            onError: (e) => toast({ title: t("titles.failed"), description: humanizeApiError(e), variant: "destructive" }),
          })}
      >
        <SelectTrigger id="gm-title" className="h-9 w-full sm:w-64"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{t("titles.none")}</SelectItem>
          {known.map((x) => (
            <SelectItem key={x.key} value={x.key}>{titleLabel(x.key)} · {t("titles.earnedOn", { date: fmtDayMonth(x.earnedAt) })}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Season bar, streak freeze and the title picker — under the level in the «Квесты и достижения» header. */
export function QuestsHeaderView({ me }: { me: GamificationMe }) {
  const { t } = gamificationI18n.useT();
  return (
    <div className="flex flex-col gap-2 border-t border-[var(--glass-border)] pt-3" aria-label={t("season.aria")}>
      <SeasonBar season={me.season} href="/ratings?tab=season" />
      <FreezeLine freeze={me.freeze} />
      <TitlePicker titles={me.titles} active={me.activeTitle} />
    </div>
  );
}

const MASTERY_VISIBLE = 6;

/** Per-setup mastery: highest first; the rest behind «ещё N». */
export function MasteryPanel({ list }: { list: readonly SetupMastery[] }) {
  const { t } = gamificationI18n.useT();
  const [all, setAll] = useState(false);
  const sorted = [...list].sort((a, b) => b.level - a.level || b.progress.current - a.progress.current || (a.code ?? a.name).localeCompare(b.code ?? b.name));
  const shown = all ? sorted : sorted.slice(0, MASTERY_VISIBLE);
  return (
    <Panel title={t("mastery.title")} icon={Target} description={t("mastery.description")}>
      {sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("mastery.empty")}</p>
      ) : (
        <div className="flex flex-col gap-2">
          <ul className="grid grid-cols-1 gap-1.5 md:grid-cols-2 2xl:grid-cols-3">
            {shown.map((m) => (
              <li key={m.setupId} className="tile flex min-w-0 flex-col gap-1 px-3 py-2">
                <span className="flex min-w-0 items-baseline gap-2">
                  {m.code && <span className="shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">{m.code}</span>}
                  <span className="min-w-0 truncate text-sm font-medium text-foreground" title={m.name}>{setupShortName(m.code, m.name)}</span>
                </span>
                <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <SetupMasteryChip mastery={m} />
                  <span className="text-2xs tabular-nums text-muted-foreground">{t("mastery.sources", { trades: m.sources.gradeATrades, drills: m.sources.drills })}</span>
                </span>
              </li>
            ))}
          </ul>
          {sorted.length > MASTERY_VISIBLE && (
            <button type="button" onClick={() => setAll((v) => !v)} className="self-start px-1 text-xs font-medium text-primary hover:underline">
              {all ? t("mastery.less") : t("mastery.more", { count: sorted.length - MASTERY_VISIBLE })}
            </button>
          )}
        </div>
      )}
    </Panel>
  );
}

/** Mastery + the rewards catalog, under the achievements. `?rewards=1` (reward notifications) scrolls to «Награды». */
export function QuestsExtrasView({ me, focusRewards = false }: { me: GamificationMe; focusRewards?: boolean }) {
  useEffect(() => {
    if (!focusRewards) return;
    const timer = window.setTimeout(() => document.getElementById("gm-rewards")?.scrollIntoView({ block: "start" }), 450);
    return () => window.clearTimeout(timer);
  }, [focusRewards]);
  return (
    <>
      <MasteryPanel list={me.mastery} />
      <RewardsCatalog rewards={me.rewards} highlight={focusRewards} />
    </>
  );
}

/** Slot for the quests tab header (composed by pages/ratings). Renders nothing until the API has gamification. */
export function QuestsGamificationHeader() {
  const q = useGamificationMe(true);
  return q.data ? <QuestsHeaderView me={q.data} /> : null;
}

/** Slot under the achievements (composed by pages/ratings). */
export function QuestsGamificationExtras() {
  const q = useGamificationMe(true);
  const search = useSearch();
  const focus = new URLSearchParams(search).has("rewards");
  return q.data ? <QuestsExtrasView me={q.data} focusRewards={focus} /> : null;
}
