import { CalendarClock, Shield, Trophy, Users } from "lucide-react";
import { EmptyState, Panel, PanelSkeleton, Pill } from "@/components/ds";
import { SeasonBar, TitleTag } from "@/components/shared/season-bar";
import { rankingName, seasonMonth, titleLabel } from "@/components/shared/gamification-labels";
import { cn } from "@/lib/utils";
import { fmtNum } from "@/lib/format";
import type { SeasonState } from "@/lib/gamification/types";
import { gamificationI18n } from "@/i18n/ns/gamification";
import { personName } from "@/i18n";
import { useLeague, useSeason, type LeagueView } from "./api";
import { leagueTeams, seasonRows, type SeasonRow } from "./model";

function RankCell({ rank }: { rank: number }) {
  return (
    <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-lg text-xs font-semibold tabular-nums", rank <= 3 ? "bg-primary/15 text-primary" : "bg-foreground/[0.05] text-muted-foreground")}>
      {rank}
    </span>
  );
}

function SeasonLine({ row }: { row: SeasonRow }) {
  const { t } = gamificationI18n.useT();
  const name = rankingName(row.label, row.me);
  return (
    <li className={cn("flex min-h-11 min-w-0 items-center gap-3 rounded-xl px-2 py-1.5", row.me && "bg-primary/[0.08] ring-1 ring-primary/40")} aria-current={row.me ? "true" : undefined}>
      <RankCell rank={row.rank} />
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className={cn("min-w-0 truncate text-sm", row.me ? "font-semibold text-foreground" : "font-medium text-foreground")}>{name}</span>
        <TitleTag label={titleLabel(row.title)} />
      </span>
      <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground" title={t("season.pointsCol")}>{t("season.points", { count: row.points })}</span>
    </li>
  );
}

/** Season ranking: the top and the viewer's own place (a gap «…» when outside the top); aliases for traders. */
export function SeasonRanking({ season, participant = true }: { season: SeasonState; participant?: boolean }) {
  const { t } = gamificationI18n.useT();
  const { rows, own } = seasonRows(season);
  return (
    <Panel
      title={t("season.title", { month: seasonMonth(season.key) })}
      icon={CalendarClock}
      description={t("season.description")}
      actions={season.of > 0 ? <span className="text-xs tabular-nums text-muted-foreground">{t("season.of", { count: season.of })}</span> : undefined}
    >
      <div className="flex flex-col gap-3">
        {participant && <SeasonBar season={season} />}
        {rows.length === 0 ? (
          <EmptyState compact icon={Trophy} title={t("season.empty")} />
        ) : (
          <ol className="flex flex-col gap-0.5" aria-label={t("season.rankingAria")}>
            {rows.map((r) => <SeasonLine key={`${r.rank}:${r.label}`} row={r} />)}
            {own && (
              <>
                <li className="px-4 text-xs text-muted-foreground" aria-hidden="true">{t("season.gap")}</li>
                <SeasonLine row={own} />
              </>
            )}
          </ol>
        )}
        {participant && season.myRank == null && season.top.every((r) => !r.me) && season.myPoints === 0 && <p className="text-xs text-muted-foreground">{t("season.notRanked")}</p>}
      </div>
    </Panel>
  );
}

/** Curator league: teams by the average season points per active member; the viewer's team highlighted. */
export function LeaguePanel({ league }: { league: LeagueView }) {
  const { t } = gamificationI18n.useT();
  const teams = leagueTeams(league);
  const members = league.members ? [...league.members].sort((a, b) => b.points - a.points) : null;
  return (
    <Panel title={t("league.title")} icon={Shield} description={t("league.description")}>
      <div className="flex flex-col gap-4">
        {teams.length === 0 ? (
          <EmptyState compact icon={Users} title={t("league.empty")} />
        ) : (
          <ol className="flex flex-col gap-0.5" aria-label={t("league.aria")}>
            {teams.map((tm) => (
              <li key={tm.curator} className={cn("flex min-h-11 min-w-0 items-center gap-3 rounded-xl px-2 py-1.5", tm.mine && "bg-primary/[0.08] ring-1 ring-primary/40")} aria-current={tm.mine ? "true" : undefined}>
                <RankCell rank={tm.rank} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex min-w-0 flex-wrap items-center gap-x-2">
                    <span className="min-w-0 truncate text-sm font-medium text-foreground">{t("league.team", { name: personName(tm.curator) })}</span>
                    {tm.mine && <Pill tone="accent">{t("league.mine")}</Pill>}
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground">{t("league.members", { count: tm.members })}</span>
                </span>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{t("league.score", { score: fmtNum(tm.score, { decimals: 1 }) })}</span>
              </li>
            ))}
          </ol>
        )}
        {members && (
          <div className="flex flex-col gap-1.5 border-t border-[var(--glass-border)] pt-3">
            <span className="micro-label">{t("league.contributions")}</span>
            <p className="text-xs text-muted-foreground">{t("league.contributionsHint")}</p>
            {members.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("league.noMembers")}</p>
            ) : (
              <ul className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
                {members.map((m) => (
                  <li key={m.trader} className="flex min-h-9 min-w-0 items-center gap-2 border-b border-[var(--glass-border)] py-1 text-sm last:border-b-0">
                    <span className="min-w-0 flex-1 truncate text-foreground" title={personName(m.trader)}>{personName(m.trader)}</span>
                    <TitleTag label={titleLabel(m.title)} />
                    <span className="shrink-0 tabular-nums text-muted-foreground">{t("season.points", { count: m.points })}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}

/**
 * Presentational: season ranking + league side by side on wide screens, stacked on phones. `participant` = the viewer
 * is a trader in the season (staff see the ranking without an own line).
 */
export function SeasonTabView({ season, league, participant = true }: { season: SeasonState | null; league: LeagueView | null; participant?: boolean }) {
  const { t } = gamificationI18n.useT();
  if (!season && !league) return <EmptyState icon={CalendarClock} title={t("season.loadFailed")} />;
  return (
    <div className="grid grid-cols-1 gap-[var(--grid-gap)] xl:grid-cols-2 xl:items-start">
      {season && <SeasonRanking season={season} participant={participant} />}
      {league && <LeaguePanel league={league} />}
    </div>
  );
}

/** /ratings → «Сезон»: one place for the season ranking and the curator league. */
export function SeasonTab({ participant = true }: { participant?: boolean }) {
  const s = useSeason(true);
  const l = useLeague(true);
  if (s.isLoading || l.isLoading) return <PanelSkeleton />;
  return <SeasonTabView season={s.data ?? null} league={l.data ?? null} participant={participant} />;
}
