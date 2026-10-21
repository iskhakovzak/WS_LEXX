/**
 * Gamification — entry points (routes/gamification.ts, the nightly job «gamification.nightly»). Shapes:
 * lib/gamification/types.ts. Rewards discipline, reviewing, planning and learning — never P&L, trade count or time in
 * the app. Every number is a desk setting (`gamification.*`).
 *
 *   seasonState(viewer, key?)      season points ranking: top N (points > 0) + the subject's own place; aliases «t<n>»
 *                                  for traders when names are hidden from their stage (lib/access/names), names for staff;
 *                                  a risk-halted trader is left out of the top (no season lead while halted); a trader
 *                                  sees no place while fewer than 5 have points (2.14, season.withRankThreshold)
 *   leagueState(viewer, key?)      curator teams by average season points per active member (no teams while fewer than
 *                                  LEAGUE_MIN_TEAMS are ranked); the curator's own team members (real names — staff only)
 *   gamificationMe(subject, …)     GamificationMe: season, league, mastery (stored → level-up recognition), freeze,
 *                                  titles (titlesPaused while risk-halted: shown nowhere else), rewards (eligibility synced on read: stale
 *                                  eligibility revoked, inactive items hidden)
 *   runGamificationNightly()       every active trader evaluated (season scores), the finished season finalized once
 *                                  (top-3 recognition), mastery and reward eligibility synced. Idempotent.
 */
import { logger } from "../logger";
import { SETTINGS, setting, type SettingKey } from "../settings/registry";
import { addDays, nyDate } from "../tradingDate";
import { deskAliases } from "../deskAliases";
import { namesVisible } from "../access/names";
import { evaluationFor, type Evaluation } from "../quests/service";
import { achievementsOf } from "../quests/store";
import { haltedTraders } from "./halted";
import { LEAGUE_MIN_TEAMS, leagueTeams, visibleTeams } from "./league";
import { computeMastery, syncMastery } from "./mastery";
import { chosenTitles, participants, type Participant } from "./people";
import { recordRecognition } from "./recognition";
import type { EligibilityInput } from "./rewards";
import { syncRewards } from "./rewardsService";
import { grantsOf, listItems } from "./rewardsStore";
import { endsInDays, previousSeason, rankRows, SEASON_MIN_RANKED, seasonKeyOf, seasonRange, topFor, withRankThreshold, type Ranked } from "./season";
import { finalizeSeason, finalRanking, seasonPlaces, seasonRows } from "./seasonStore";
import { activeTitleOf } from "./titles";
import { activeTitles, earnedTitles } from "./titlesStore";
import type { GamificationMe, LeagueState, RewardItem, SeasonState, SetupMastery, StreakFreeze } from "./types";

/** Whose view: `subject` = the trader the numbers are about (the viewer, or a trader staff opened); staff see names. */
export type GView = { subject: string; staff: boolean };

/** Names hidden from this view (lib/access/names.ts: per stage; staff always see them). */
const hideNames = async (v: GView) => !(await namesVisible({ name: v.subject, staff: v.staff }));

/** A numeric desk setting that may not be registered yet (lib/settings is another area's file): the fallback until then. */
export function settingOr(key: string, fallback: number): number {
  if (!(key in SETTINGS)) return fallback;
  const v = Number(setting(key as SettingKey));
  return Number.isFinite(v) ? v : fallback;
}

const BACKFILL_EVERY_MS = 30 * 60_000;
let backfill: { at: number; running: boolean } = { at: 0, running: false };

/**
 * The current season lacks scores for some participants (never evaluated this month — e.g. right after the rollout or
 * a quiet trader): evaluate them in the background (cached evaluations; at most once per BACKFILL_EVERY_MS per process),
 * so rankings and the league fill in on the next read instead of after the nightly job.
 */
function backfillSeason(missing: readonly string[], now: Date): void {
  if (!missing.length || backfill.running || Date.now() - backfill.at < BACKFILL_EVERY_MS) return;
  backfill = { at: Date.now(), running: true };
  void (async () => {
    for (const t of missing) await evaluationFor(t, now).catch(() => null);
  })().finally(() => {
    backfill = { ...backfill, running: false };
  });
}

async function storedScores(key: string, people: readonly Participant[], now: Date) {
  const rows = await seasonRows(key);
  if (key === seasonKeyOf(nyDate(now))) {
    const have = new Set(rows.map((r) => r.trader));
    backfillSeason(people.map((p) => p.name).filter((n) => !have.has(n)), now);
  }
  return rows;
}

async function rankingOf(key: string, people: readonly Participant[], now: Date): Promise<Ranked[]> {
  const final = await finalRanking(key);
  if (final) return final;
  const stored = new Map((await storedScores(key, people, now)).map((r) => [r.trader, r.points]));
  return rankRows(people.map((p) => ({ trader: p.name, points: stored.get(p.name) ?? 0 })));
}

export async function seasonState(v: GView, key: string | null = null, now = new Date()): Promise<SeasonState> {
  const today = nyDate(now);
  const season = key ?? seasonKeyOf(today);
  const people = await participants();
  const ranked = await rankingOf(season, people, now);
  const mine = ranked.find((r) => r.trader === v.subject);
  const n = setting("gamification.seasonTopN");
  const hidden = new Set(people.filter((p) => !p.share).map((p) => p.name));
  // Candidates for the shown top: room for the hidden and for a few halted traders left out of it.
  const candidates = ranked.filter((r) => r.points > 0).slice(0, n + hidden.size + 5).map((r) => r.trader);
  const [titles, halted] = await Promise.all([activeTitles(candidates), haltedTraders(candidates, now)]);
  const top = topFor(ranked, n, { name: v.subject, staff: v.staff, hideNames: await hideNames(v) }, {
    hidden, alias: deskAliases(ranked.map((r) => r.trader), season), titles, excluded: halted,
  });
  const { from, to } = seasonRange(season);
  return withRankThreshold({
    key: season, from, to, endsInDays: endsInDays(season, today), myPoints: mine?.points ?? 0,
    myRank: mine && mine.points > 0 ? mine.rank : null, of: ranked.length, top,
  }, ranked, v.staff, settingOr("gamification.seasonMinRanked", SEASON_MIN_RANKED));
}

export async function leagueState(v: GView, key: string | null = null, now = new Date()): Promise<LeagueState | null> {
  const season = key ?? seasonKeyOf(nyDate(now));
  const people = await participants();
  if (!people.some((p) => p.curator)) return null;
  const stored = new Map((await storedScores(season, people, now)).map((r) => [r.trader, r]));
  const members = people.map((p) => ({ trader: p.name, curator: p.curator, points: stored.get(p.name)?.points ?? 0, active: !!stored.get(p.name)?.active }));
  const teams = visibleTeams(leagueTeams(members, setting("gamification.leagueMinMembers")), settingOr("gamification.leagueMinTeams", LEAGUE_MIN_TEAMS));
  const myTeam = v.staff ? v.subject : (people.find((p) => p.name === v.subject)?.curator ?? null);
  const out: LeagueState = { season, teams: teams.map((t) => ({ ...t, mine: t.curator === myTeam })) };
  if (v.staff) {
    const own = members.filter((m) => m.curator === v.subject && m.active).sort((a, b) => b.points - a.points || a.trader.localeCompare(b.trader));
    if (own.length) {
      const titles = await activeTitles(own.map((m) => m.trader));
      out.members = own.map((m) => ({ trader: m.trader, points: m.points, title: titles.get(m.trader) ?? null }));
    }
  }
  return out;
}

/** Freeze state from the ledger: used = frozen days of this NY month; history = frozen days of the last 90 days (newest first). */
export function freezeOf(ledger: Evaluation["data"]["ledger"], today: string): StreakFreeze {
  const perMonth = setting("gamification.enabled") ? setting("gamification.freezePerMonth") : 0;
  const frozen = ledger.filter((d) => d.outcome === "frozen").map((d) => d.date);
  const used = frozen.filter((d) => d.slice(0, 7) === today.slice(0, 7)).length;
  return { available: Math.max(0, perMonth - used), perMonth, usedOn: frozen.filter((d) => d >= addDays(today, -90)).sort().reverse() };
}

/** Mastery now (stored; level-ups recognised once). */
async function masteryWithRecognition(trader: string, now: Date): Promise<SetupMastery[]> {
  const { mastery, ups } = await syncMastery(trader, now);
  for (const u of ups) {
    const m = mastery.find((x) => x.setupId === u.setupId)!;
    await recordRecognition({
      trader, kind: "mastery", ref: `${u.setupId}:${u.to}`, params: { setupId: u.setupId, code: m.code, name: m.name, level: u.to }, day: nyDate(now),
    }, now);
  }
  return mastery;
}

async function syncTraderRewards(trader: string, e: Evaluation, mastery: readonly SetupMastery[], items: readonly RewardItem[]): Promise<void> {
  const [achievements, seasons] = await Promise.all([achievementsOf(trader), seasonPlaces(trader)]);
  // The whole catalog: active items make new eligibility, inactive ones get their open grants revoked.
  await syncRewards(trader, { achievements, level: e.discipline.level, seasons, mastery }, items);
}

/** Everything a reward condition reads for one trader now (an admin's item edit re-checks open eligibility with it). */
export async function eligibilityInputOf(trader: string, now = new Date()): Promise<EligibilityInput> {
  const [e, achievements, seasons, mastery] = await Promise.all([evaluationFor(trader, now), achievementsOf(trader), seasonPlaces(trader), computeMastery(trader)]);
  return { achievements, level: e.discipline.level, seasons, mastery };
}

const EMPTY_FREEZE = (): StreakFreeze => ({ available: 0, perMonth: setting("gamification.freezePerMonth"), usedOn: [] });

/** GET /api/gamification/me. `isTrader` = the subject is a trader (staff opening their own page get the rankings only). */
export async function gamificationMe(v: GView, o: { isTrader: boolean; now?: Date } = { isTrader: true }): Promise<GamificationMe> {
  const now = o.now ?? new Date();
  const today = nyDate(now);
  const all = await listItems();
  if (!o.isTrader) {
    const [season, league] = await Promise.all([seasonState(v, null, now), leagueState(v, null, now)]);
    const catalog = all.filter((i) => i.active);
    return { season, league, mastery: [], freeze: EMPTY_FREEZE(), titles: [], activeTitle: null, rewards: { eligible: [], requested: [], granted: [], declined: [], catalog } };
  }
  const e = await evaluationFor(v.subject, now); // season score stored, achievements awarded
  const mastery = await masteryWithRecognition(v.subject, now);
  await syncTraderRewards(v.subject, e, mastery, all).catch((err) => logger.warn({ err: (err as Error)?.message }, "gamification: rewards sync failed"));
  const [season, league, earned, chosen, grants, halted] = await Promise.all([
    seasonState(v, null, now), leagueState(v, null, now), earnedTitles([v.subject]), chosenTitles([v.subject]), grantsOf(v.subject),
    haltedTraders([v.subject], now),
  ]);
  const titles = earned.get(v.subject) ?? [];
  const active = new Set(all.filter((i) => i.active).map((i) => i.id));
  // History (requested / granted / declined) keeps its item visible after a deactivation; eligibility never does.
  const referenced = new Set(grants.filter((g) => g.status !== "eligible").map((g) => g.itemId));
  const catalog = all.filter((i) => i.active || referenced.has(i.id));
  const paused = halted.has(v.subject);
  return {
    season, league, mastery, freeze: freezeOf(e.data.ledger, today), titles, activeTitle: activeTitleOf(chosen.get(v.subject), titles),
    ...(paused ? { titlesPaused: true } : {}),
    rewards: {
      eligible: grants.filter((g) => g.status === "eligible" && active.has(g.itemId)),
      requested: grants.filter((g) => g.status === "requested"),
      granted: grants.filter((g) => g.status === "granted"),
      declined: grants.filter((g) => g.status === "declined"),
      catalog,
    },
  };
}

/**
 * Finalizes the season before today's (always over by then; the nightly run re-scored it first) once; top 3 recognised.
 * Null when it was already final.
 */
export async function finalizePreviousSeason(people: readonly Participant[], now = new Date()): Promise<string | null> {
  const prev = previousSeason(seasonKeyOf(nyDate(now)));
  const ranked = await finalizeSeason(prev, people.map((p) => p.name));
  if (!ranked) return null;
  for (const r of ranked.filter((x) => x.rank <= 3)) {
    await recordRecognition({ trader: r.trader, kind: "season_top", ref: prev, params: { season: prev, rank: r.rank, points: r.points }, day: nyDate(now) }, now);
  }
  return prev;
}

export async function runGamificationNightly(o: { now?: Date; signal?: AbortSignal } = {}): Promise<Record<string, unknown>> {
  if (!setting("gamification.enabled")) return { skipped: "disabled" };
  const now = o.now ?? new Date();
  const people = await participants();
  const evals = new Map<string, Evaluation>();
  let failed = 0;
  for (const p of people) {
    if (o.signal?.aborted) break;
    try {
      evals.set(p.name, await evaluationFor(p.name, now));
    } catch (err) {
      failed++;
      logger.warn({ err: (err as Error)?.message, trader: p.name }, "gamification.nightly: evaluation failed");
    }
  }
  const finalized = o.signal?.aborted ? null : await finalizePreviousSeason(people, now);
  let rewards = 0;
  const items = await listItems(); // inactive items too: their open eligibility is revoked
  for (const [trader, e] of evals) {
    if (o.signal?.aborted) break;
    try {
      const mastery = await masteryWithRecognition(trader, now);
      const [achievements, seasons] = await Promise.all([achievementsOf(trader), seasonPlaces(trader)]);
      rewards += (await syncRewards(trader, { achievements, level: e.discipline.level, seasons, mastery }, items)).length;
    } catch (err) {
      failed++;
      logger.warn({ err: (err as Error)?.message, trader }, "gamification.nightly: trader failed");
    }
  }
  return { traders: people.length, finalized, newEligible: rewards, failed };
}
