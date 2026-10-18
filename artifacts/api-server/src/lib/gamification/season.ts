/**
 * Seasons — PURE (no I/O), unit-tested. A season is one New York calendar month ("2026-10"). Season points = the
 * discipline points of the month's contract days (lib/daily/discipline ledger, progressive scale) + the bonus points of
 * the quests done in the month (lib/quests); floored at 0 for the ranking (a bad month never shows a negative score to
 * anyone). The all-time level (lib/daily/discipline levelOf) is untouched — seasons only add a monthly race.
 *
 * Ranking: points desc, ties share the place (1, 1, 3); names ordered for a stable list. A ranking shows the top N and
 * the viewer's own place only (no public bottom of the table); traders see aliases when names are hidden.
 */
import { addDays } from "../tradingDate";
import type { LedgerDay } from "../daily/discipline";

export const seasonKeyOf = (date: string) => date.slice(0, 7);

/** First and last calendar day of the season. */
export function seasonRange(key: string): { from: string; to: string } {
  const x = new Date(`${key}-01T12:00:00Z`);
  x.setUTCMonth(x.getUTCMonth() + 1, 0);
  return { from: `${key}-01`, to: x.toISOString().slice(0, 10) };
}

/** The season before `key`. */
export function previousSeason(key: string): string {
  return seasonKeyOf(addDays(`${key}-01`, -1));
}

/** Calendar days left after `today` until the season ends (0 on its last day and for a past season). */
export function endsInDays(key: string, today: string): number {
  const { to } = seasonRange(key);
  if (today >= to) return 0;
  const from = today < `${key}-01` ? `${key}-01` : today;
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

export const isSeasonKey = (s: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

export type SeasonQuest = { status: string; completedOn: string | null; rewardPoints: number };

export type SeasonScore = { discipline: number; quests: number; points: number; active: boolean };

/**
 * The trader's score in season `key`: ledger points of the month + done quests' points by completion day. `active` =
 * any contract / missed / frozen day, traded day or done quest in the month (league members).
 */
export function seasonScore(key: string, i: { ledger: readonly LedgerDay[]; quests: readonly SeasonQuest[]; tradedDays?: readonly string[] }): SeasonScore {
  const inSeason = (d: string | null | undefined) => !!d && d.slice(0, 7) === key;
  const days = i.ledger.filter((d) => inSeason(d.date));
  const discipline = days.reduce((s, d) => s + d.points, 0);
  const done = i.quests.filter((q) => q.status === "done" && inSeason(q.completedOn));
  const quests = done.reduce((s, q) => s + q.rewardPoints, 0);
  const active = days.some((d) => d.outcome !== "none") || done.length > 0 || (i.tradedDays ?? []).some(inSeason);
  return { discipline, quests, points: Math.max(0, discipline + quests), active };
}

export type RankRow = { trader: string; points: number };
export type Ranked = RankRow & { rank: number };

/** Competition ranking: points desc, equal points share the place; names break ties for a stable order. */
export function rankRows(rows: readonly RankRow[]): Ranked[] {
  const sorted = [...rows].sort((a, b) => b.points - a.points || a.trader.localeCompare(b.trader));
  let rank = 0, prev: number | null = null;
  return sorted.map((r, i) => {
    if (prev === null || r.points !== prev) rank = i + 1;
    prev = r.points;
    return { ...r, rank };
  });
}

export type TopViewer = { name: string | null; staff: boolean; hideNames: boolean };

/**
 * Top N for a viewer: rows with points > 0; a trader who hides achievements (shareAchievements off) is left out for
 * everyone but himself and staff; label = stored name (staff, or names shown) or the season alias key "t<n>".
 */
export function topFor(
  ranked: readonly Ranked[], n: number, viewer: TopViewer,
  o: { hidden: ReadonlySet<string>; alias: ReadonlyMap<string, number>; titles: ReadonlyMap<string, string> },
): { label: string; me: boolean; points: number; title: string | null }[] {
  const names = viewer.staff || !viewer.hideNames;
  return ranked
    .filter((r) => r.points > 0 && (viewer.staff || r.trader === viewer.name || !o.hidden.has(r.trader)))
    .slice(0, n)
    .map((r) => ({
      label: names ? r.trader : `t${o.alias.get(r.trader) ?? 0}`,
      me: r.trader === viewer.name,
      points: r.points,
      title: o.titles.get(r.trader) ?? null,
    }));
}
