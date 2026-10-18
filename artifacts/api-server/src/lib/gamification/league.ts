/**
 * Curator league — PURE. Teams are the curator groups (users.assigned_curator of active traders); a team's score is the
 * average season points of its ACTIVE members (a contract / traded day or a done quest in the season — someone on
 * leave does not drag the team down), rounded to 0.1. Teams with fewer active members than
 * gamification.leagueMinMembers are not ranked. Ties share the place.
 */
export type LeagueMember = { trader: string; curator: string | null; points: number; active: boolean };
export type LeagueTeam = { curator: string; members: number; score: number; rank: number };

export function leagueTeams(members: readonly LeagueMember[], minMembers: number): LeagueTeam[] {
  const teams = new Map<string, { sum: number; n: number }>();
  for (const m of members) {
    if (!m.curator || !m.active) continue;
    const t = teams.get(m.curator) ?? teams.set(m.curator, { sum: 0, n: 0 }).get(m.curator)!;
    t.sum += m.points;
    t.n += 1;
  }
  const scored = [...teams]
    .filter(([, t]) => t.n >= Math.max(1, minMembers))
    .map(([curator, t]) => ({ curator, members: t.n, score: Math.round((t.sum / t.n) * 10) / 10 }))
    .sort((a, b) => b.score - a.score || a.curator.localeCompare(b.curator));
  let rank = 0, prev: number | null = null;
  return scored.map((t, i) => {
    if (prev === null || t.score !== prev) rank = i + 1;
    prev = t.score;
    return { ...t, rank };
  });
}
