/**
 * Achievements — PURE (no I/O), unit-tested. Permanent lines with tiers (bronze → silver → gold → platinum) earned from
 * stored data; the 8 discipline badges (lib/daily/badges.ts) are tiers of these lines (BADGE_TIER — migration 0207
 * copied their rows with the original days). Rewards follow the rules, reviewing, planning and learning — never P&L,
 * trade count or time in the app. Tier targets are desk settings (`achievements.*`); awarding (once, idempotent) and
 * loading live in lib/quests/service.ts / load.ts.
 *
 *   contract_streak   kept-contract days in a row (lib/daily/discipline ledger streak)            5 / 10 / 20 / 50
 *   clean_month       finished months with ≥ rewards.cleanMonthMinDays traded days, the daily stop known and never
 *                     reached (total, not in a row)                                                 1 / 3 / 6
 *   comeback (secret) a kept contract day right after a broken one                                  5
 *   reviews_total     FULLY reviewed trading days, all time (journal form with a trade review)      10 / 50 / 100 / 250
 *   review_streak     traded days in a row fully reviewed on time (that day or the next trading day) 5 / 10 / 20 / 40
 *   focus_beaten      the day's focus mistake absent on judged days in a row («победил ошибку»)     5 / 10 / 20
 *   plan_before_open  days with a personal plan created before 09:30 NY                              10 / 30 / 100
 *   full_loop (secret) days with a plan before the open + kept contract + fully reviewed on time     20
 * Roadmap R3: the one-tap «Разобрал» is «seen» — the review lines read ReviewDay.fullOn (lib/daily/badges asFullReview).
 *   own_replays       own days replayed in the simulator (finished own games)                        1 / 10 / 50
 *   beat_yourself     own replays where the new decision beat the real trade (verdict «better»)      3 / 10 / 25
 *   lessons           academy lessons completed (only when the trader has academy data)             5 / 20 / 50
 *   exams             academy exams passed (lib/challengeEngine; only with academy data)            1 / 2 / 3
 *   tier_up           scaling promotions: Джун / Трейдер / Сеньор (scaling_history)
 *   onboarding        every first-steps quest done (lib/quests/catalog ONBOARDING)
 *
 * Achievements v2 (owner 2026-10-27: «сделать их намного больше … по чуть-чуть давать победу»): the process lines of
 * lib/achievements/process.ts (day / week / month horizons, personal records, the comeback after a stop), the signature
 * lines (closed leaks, setup mastery by a confirmed edge, the path steps — lib/achievements/dynamic.ts), kudos and the desk
 * top 3. Every line has a horizon and a unit; tier numbers of the new lines are the catalog's (docs/achievements/CATALOG.md);
 * an admin can switch a line off (settings achievements.disabled).
 */
import { asFullReview, reviewedOnTime, type FocusDay, type OwnGame, type ReviewDay, type StopDay } from "../daily/badges";
import type { LedgerDay } from "../daily/discipline";
import { setting, type SettingKey } from "../settings/registry";
import type { BadgeId, BadgeState } from "../daily/types";
import type { Achievement, AchievementCategory, AchievementHorizon, AchievementItem, AchievementTier, AchievementUnit } from "./types";
import { processSeries, type ProcessInput, type Series } from "../achievements/process";
import { countDates, dynamicLines, itemsOf, type DynResult, type DynamicInput } from "../achievements/dynamic";

export const TIERS: readonly AchievementTier[] = ["bronze", "silver", "gold", "platinum"];

export type LineId =
  | "contract_streak" | "clean_month" | "comeback" | "reviews_total" | "review_streak" | "focus_beaten" | "plan_before_open"
  | "full_loop" | "own_replays" | "beat_yourself" | "lessons" | "exams" | "tier_up" | "onboarding"
  // v2
  | "contract_days" | "stop_respected" | "guard_respected" | "clean_week" | "iron_week" | "stop_comeback" | "quiet_comeback"
  | "clean_quarter" | "review_week" | "review_month" | "plan_month" | "no_revenge" | "better_week" | "record_fees" | "record_r"
  | "record_discipline" | "leaks_closed" | "setups_confirmed" | "path_steps" | "kudos" | "desk_top3";

export type LineDef = {
  id: LineId;
  category: AchievementCategory;
  horizon: AchievementHorizon;
  unit: AchievementUnit;
  /** Tiers that get the ceremony ("all" = every tier); a platinum tier always does. */
  big?: "all" | readonly AchievementTier[];
  /** Counts toward the capital allocation signal (lib/achievements/signal.ts). */
  capital?: boolean;
  secret?: boolean;
  /** Only shown when the trader has academy data. */
  academy?: boolean;
  /** Tier targets: settings keys (one per tier, ascending) or fixed numbers. */
  targets: readonly SettingKey[] | ((input: AchievementInput) => number[]);
  /** Tier names when the line does not start at bronze (single-tier lines are gold). */
  tiers?: readonly AchievementTier[];
};

const keys = (base: string, n: number) => Array.from({ length: n }, (_, i) => `achievements.${base}${i + 1}` as SettingKey);

const fixed = (...n: number[]) => () => n;

export const LINES: readonly LineDef[] = [
  // discipline
  { id: "contract_streak", category: "discipline", horizon: "day", unit: "days", targets: keys("contractStreak", 4) },
  { id: "contract_days", category: "discipline", horizon: "day", unit: "days", targets: fixed(20, 60, 150, 400) },
  { id: "guard_respected", category: "discipline", horizon: "day", unit: "count", targets: fixed(5, 25, 100) },
  { id: "clean_week", category: "discipline", horizon: "week", unit: "weeks", targets: fixed(1, 4, 12, 26) },
  { id: "comeback", category: "discipline", horizon: "day", unit: "count", secret: true, targets: ["achievements.comebackCount"], tiers: ["gold"] },
  { id: "iron_week", category: "discipline", horizon: "week", unit: "weeks", secret: true, targets: fixed(1), tiers: ["gold"], big: "all" },
  // risk
  { id: "stop_respected", category: "risk", horizon: "day", unit: "days", targets: fixed(10, 50, 150, 400) },
  { id: "clean_month", category: "risk", horizon: "month", unit: "months", targets: keys("cleanMonth", 3), capital: true },
  { id: "stop_comeback", category: "risk", horizon: "signature", unit: "comebacks", targets: fixed(1, 3, 5), big: "all", capital: true },
  { id: "quiet_comeback", category: "risk", horizon: "signature", unit: "comebacks", secret: true, targets: fixed(1), tiers: ["gold"], big: "all" },
  { id: "clean_quarter", category: "risk", horizon: "month", unit: "count", secret: true, targets: fixed(1), tiers: ["gold"], big: "all" },
  // review
  { id: "reviews_total", category: "review", horizon: "day", unit: "days", targets: keys("reviewsTotal", 4) },
  { id: "review_streak", category: "review", horizon: "day", unit: "days", targets: keys("reviewStreak", 4) },
  { id: "review_week", category: "review", horizon: "week", unit: "weeks", targets: fixed(1, 4, 12, 26) },
  { id: "review_month", category: "review", horizon: "month", unit: "months", targets: fixed(1, 3, 6, 12) },
  // focus
  { id: "focus_beaten", category: "focus", horizon: "day", unit: "days", targets: keys("focusBeaten", 3) },
  // planning
  { id: "plan_before_open", category: "planning", horizon: "day", unit: "days", targets: keys("planBeforeOpen", 3) },
  { id: "plan_month", category: "planning", horizon: "month", unit: "months", targets: fixed(1, 3, 6, 12) },
  { id: "full_loop", category: "planning", horizon: "day", unit: "days", secret: true, targets: ["achievements.fullLoopDays"], tiers: ["gold"] },
  // personal records: beat yourself on process numbers
  { id: "no_revenge", category: "records", horizon: "month", unit: "losses", targets: fixed(10, 25, 50, 100) },
  { id: "better_week", category: "records", horizon: "week", unit: "weeks", targets: fixed(1, 5, 15) },
  { id: "record_fees", category: "records", horizon: "month", unit: "months", targets: fixed(1, 3, 6) },
  { id: "record_r", category: "records", horizon: "month", unit: "months", targets: fixed(1, 3, 6) },
  { id: "record_discipline", category: "records", horizon: "month", unit: "months", targets: fixed(1, 3, 6) },
  // signature: closed leaks and confirmed setups (their per-leak / per-setup lines are dynamic)
  { id: "leaks_closed", category: "leaks", horizon: "signature", unit: "leaks", targets: fixed(1, 3, 6, 10), big: "all", capital: true },
  { id: "setups_confirmed", category: "mastery", horizon: "signature", unit: "setups", targets: fixed(1, 2, 3, 5), capital: true },
  // learning
  { id: "own_replays", category: "learning", horizon: "day", unit: "games", targets: keys("ownReplays", 3) },
  { id: "beat_yourself", category: "learning", horizon: "day", unit: "games", targets: keys("beatYourself", 3) },
  { id: "lessons", category: "learning", horizon: "career", unit: "lessons", academy: true, targets: keys("lessons", 3) },
  { id: "exams", category: "growth", horizon: "career", unit: "exams", academy: true, targets: keys("exams", 3) },
  // growth: ranks of the scaling ladder above the trainee (1 Джун, 2 Трейдер, 3 Сеньор), the path steps, first steps
  { id: "tier_up", category: "growth", horizon: "career", unit: "ranks", targets: () => [1, 2, 3], big: "all" },
  { id: "path_steps", category: "growth", horizon: "path", unit: "steps", targets: fixed(1, 5, 14, 28) },
  { id: "onboarding", category: "growth", horizon: "career", unit: "steps", targets: (i) => [Math.max(1, i.onboarding.total)], tiers: ["gold"] },
  // social
  { id: "kudos", category: "social", horizon: "social", unit: "kudos", targets: fixed(1, 5, 20, 50) },
  { id: "desk_top3", category: "social", horizon: "social", unit: "seasons", targets: fixed(1, 3, 6), big: "all" },
];

/** A tier gets the ceremony (stage steps, setup gold, closed leaks, comebacks, platinum). */
export function isBigTier(def: Pick<LineDef, "big"> | null | undefined, id: string, tier: AchievementTier): boolean {
  if (tier === "platinum") return true;
  if (id.startsWith("path:") || id.startsWith("leak:")) return true;
  if (id.startsWith("setup:")) return tier === "gold";
  const b = def?.big;
  return b === "all" || (Array.isArray(b) && b.includes(tier));
}

export const lineDef = (id: string): LineDef | undefined => LINES.find((l) => l.id === id);

/** The discipline badges as tiers of the lines (index into the line's tiers). Same map as migration 0207. */
export const BADGE_TIER: Readonly<Record<BadgeId, readonly [LineId, number]>> = {
  streak_1: ["contract_streak", 0], streak_2: ["contract_streak", 1], streak_3: ["contract_streak", 2],
  reviews: ["review_streak", 1], focus: ["focus_beaten", 0], clean_month: ["clean_month", 0],
  sim_first: ["own_replays", 0], sim_beat: ["beat_yourself", 0],
};

export type AchievementInput = {
  /** The last finished trading day. */
  asOf: string;
  ledger: readonly LedgerDay[];
  /** Traded days (all time) and the NY day each was reviewed. */
  reviews: readonly ReviewDay[];
  focus: readonly FocusDay[];
  /** Traded days with the worst running net and the daily stop (as far back as loaded). */
  stops: readonly StopDay[];
  cleanMonthMinDays: number;
  games: readonly OwnGame[];
  /** Days whose personal plan was created before 09:30 NY. */
  plansBeforeOpen: readonly string[];
  /** Promotions: the NY day and the ladder rank reached (1 Джун, 2 Трейдер, 3 Сеньор). */
  promotions: readonly { date: string; rank: number }[];
  /** Academy: lesson completion days, exam pass days; `academy` = the trader has any academy data. */
  lessons: readonly string[];
  exams: readonly string[];
  academy: boolean;
  onboarding: { done: number; total: number; doneOn: string | null };
  // ─── v2 (optional: an older caller / a test without them gets empty lines) ───
  process?: Omit<ProcessInput, "asOf" | "ledger" | "reviews" | "stops" | "plansBeforeOpen" | "cleanMonths">;
  dynamic?: Omit<DynamicInput, "asOf">;
  /** Stored awards (setup / leak / path lines) — the count lines count them first. */
  awarded?: Awarded;
  /** NY days of curator kudos, and of the desk top-3 seasons (recognition season_top). */
  kudos?: readonly string[];
  seasonTop?: readonly string[];
  masteryTargets?: readonly [number, number, number];
  /** Line ids an admin switched off (settings achievements.disabled). */
  disabled?: ReadonlySet<string>;
};

/** A line's answer: progress now and the day a target was first reached. */
export type LineSeries = { current: number; reach: (target: number) => string | null };

const sortDates = (a: readonly string[]) => [...a].filter(Boolean).sort();
const byDate = <T extends { date: string }>(a: readonly T[]): T[] => [...a].sort((x, y) => x.date.localeCompare(y.date));

/** Events counted one by one: the n-th event's day reaches n. */
export function countSeries(dates: readonly string[]): LineSeries {
  const d = sortDates(dates);
  return { current: d.length, reach: (n) => (n >= 1 ? (d[n - 1] ?? null) : null) };
}

/** A run that hits grow, misses reset and skips leave alone; `reach(n)` = the first day the run was ≥ n. */
export function runSeries<T extends { date: string }>(days: readonly T[], judge: (d: T) => "hit" | "miss" | "skip"): LineSeries {
  const points: { date: string; run: number }[] = [];
  let run = 0;
  for (const d of byDate(days)) {
    const j = judge(d);
    if (j === "skip") continue;
    run = j === "hit" ? run + 1 : 0;
    points.push({ date: d.date, run });
  }
  return { current: run, reach: (n) => points.find((p) => p.run >= n)?.date ?? null };
}

/** Finished months with ≥ minDays traded days, every day's stop known and never reached: the last day of each. */
export function cleanMonths(days: readonly StopDay[], minDays: number, asOf: string): string[] {
  const months = new Map<string, StopDay[]>();
  for (const d of byDate(days)) {
    const m = d.date.slice(0, 7);
    (months.get(m) ?? months.set(m, []).get(m)!).push(d);
  }
  const out: string[] = [];
  for (const [m, list] of months) {
    if (m >= asOf.slice(0, 7)) continue;
    if (list.length >= minDays && list.every((d) => d.limit != null && d.limit > 0 && d.trough > -d.limit)) out.push(list[list.length - 1]!.date);
  }
  return out;
}

/** Kept contract days right after a broken one (days without a contract are skipped). */
export function comebacks(ledger: readonly LedgerDay[]): string[] {
  const out: string[] = [];
  let prev: LedgerDay["outcome"] | null = null;
  for (const d of byDate(ledger)) {
    if (d.outcome !== "kept" && d.outcome !== "broken") continue; // none / missed / frozen
    if (d.outcome === "kept" && prev === "broken") out.push(d.date);
    prev = d.outcome;
  }
  return out;
}

/** Plan before the open + kept contract + reviewed on time, on the same day. */
export function fullLoopDays(input: Pick<AchievementInput, "ledger" | "reviews" | "plansBeforeOpen">): string[] {
  const early = new Set(input.plansBeforeOpen);
  const reviewed = new Set(input.reviews.map(asFullReview).filter(reviewedOnTime).map((r) => r.date));
  return input.ledger.filter((d) => d.outcome === "kept" && early.has(d.date) && reviewed.has(d.date)).map((d) => d.date);
}

/** Every line's series. */
export function lineSeries(input: AchievementInput, dyn: readonly DynResult[] = []): Record<LineId, LineSeries> {
  const ledger = byDate(input.ledger);
  const promotions = byDate(input.promotions);
  const full = input.reviews.map(asFullReview);
  const reviewedOn = full.map((r) => r.reviewedOn).filter((d): d is string => !!d);
  return {
    contract_streak: {
      current: ledger.length ? ledger[ledger.length - 1]!.streak : 0,
      reach: (n) => ledger.find((d) => d.streak >= n)?.date ?? null,
    },
    clean_month: countSeries(cleanMonths(input.stops, input.cleanMonthMinDays, input.asOf)),
    comeback: countSeries(comebacks(ledger)),
    reviews_total: countSeries(reviewedOn),
    // The last finished day can still be reviewed tomorrow: not reviewed yet = skipped, not a miss.
    review_streak: runSeries(full, (d) => (reviewedOnTime(d) ? "hit" : d.date >= input.asOf && d.reviewedOn == null ? "skip" : "miss")),
    focus_beaten: runSeries(input.focus, (d) => (d.disputed ? "skip" : d.status === "kept" ? "hit" : d.status === "broken" ? "miss" : "skip")),
    plan_before_open: countSeries(input.plansBeforeOpen),
    full_loop: countSeries(fullLoopDays(input)),
    own_replays: countSeries(input.games.map((g) => g.finishedOn)),
    beat_yourself: countSeries(input.games.filter((g) => g.verdict === "better").map((g) => g.finishedOn)),
    lessons: countSeries(input.lessons),
    exams: countSeries(input.exams),
    tier_up: {
      current: promotions.reduce((m, p) => Math.max(m, p.rank), 0),
      reach: (n) => promotions.find((p) => p.rank >= n)?.date ?? null,
    },
    onboarding: { current: input.onboarding.done, reach: (n) => (input.onboarding.done >= n ? input.onboarding.doneOn : null) },
    ...(v2Series(input, dyn) as Record<string, LineSeries>),
  } as Record<LineId, LineSeries>;
}

const EMPTY_PROCESS: NonNullable<AchievementInput["process"]> = {
  violationDays: [], breachDays: [], guardComplied: [], trades: [], disciplineDays: [], rules: { cleanWeekMinDays: 3, revengeMinutes: 10, comebackDays: 5 },
};

const processOf = (input: AchievementInput, cleanMonthDays: readonly string[]) => processSeries({
  ...(input.process ?? EMPTY_PROCESS), asOf: input.asOf, ledger: input.ledger, reviews: input.reviews, stops: input.stops,
  plansBeforeOpen: input.plansBeforeOpen, cleanMonths: cleanMonthDays,
});

/** The v2 lines' series (process lines from lib/achievements/process, count lines over the dynamic ones). */
function v2Series(input: AchievementInput, dyn: readonly DynResult[]): Record<string, Series> {
  const { series } = processOf(input, cleanMonths(input.stops, input.cleanMonthMinDays, input.asOf));
  const awarded = input.awarded ?? new Map();
  return {
    ...series,
    leaks_closed: countSeries(countDates(dyn, awarded, "leak", "gold", "leak:")),
    setups_confirmed: countSeries(countDates(dyn, awarded, "setup", "bronze", "setup:")),
    path_steps: countSeries(countDates(dyn, awarded, "path", "gold", "path:")),
    kudos: countSeries(input.kudos ?? []),
    desk_top3: countSeries(input.seasonTop ?? []),
  };
}

/** The comeback after a stop in progress (clean days since the latest stop), for the stopped dashboard. */
export function comebackOpen(input: AchievementInput): { since: string; days: number; need: number } | null {
  return processOf(input, []).comebackOpen;
}

export type TierResult = { tier: AchievementTier; target: number; earnedOn: string | null };
export type LineResult = { id: LineId | string; current: number; tiers: TierResult[]; dyn?: DynResult };

/** Tier targets of a line now (settings), ascending (targets an admin typed out of order still give bronze the smallest). */
export function lineTargets(def: LineDef, input: AchievementInput): number[] {
  const raw = typeof def.targets === "function" ? def.targets(input) : def.targets.map((k) => Number(setting(k)));
  return raw.map((v) => Math.max(1, Math.round(v))).sort((a, b) => a - b);
}

function tierNames(def: LineDef, n: number): AchievementTier[] {
  return (def.tiers ?? TIERS).slice(0, n) as AchievementTier[];
}

/** Lines that apply to this trader (academy lines only with academy data). */
export function visibleLines(input: Pick<AchievementInput, "academy" | "disabled">): LineDef[] {
  return LINES.filter((l) => (!l.academy || input.academy) && !input.disabled?.has(l.id));
}

/** The dynamic lines (setups, leaks, path steps) of this input. */
export function dynamicOf(input: AchievementInput): DynResult[] {
  if (!input.dynamic) return [];
  const off = (id: string) => !!input.disabled?.has(id);
  return dynamicLines({ ...input.dynamic, asOf: input.asOf }, input.awarded ?? new Map(), input.masteryTargets ?? [30, 60, 100], off);
}

/** Every visible line with the day each tier was reached (null = not yet). */
export function evaluateAchievements(input: AchievementInput): LineResult[] {
  const dyn = dynamicOf(input);
  const series = lineSeries(input, dyn);
  const lines = visibleLines(input).map((def): LineResult => {
    const s = series[def.id];
    const targets = lineTargets(def, input);
    const tiers = tierNames(def, targets.length).map((tier, i) => ({ tier, target: targets[i]!, earnedOn: s.reach(targets[i]!) }));
    return { id: def.id, current: s.current, tiers };
  });
  const extra = dyn.map((d): LineResult => ({ id: d.id, current: d.tiers.filter((t) => t.earnedOn).length, tiers: d.tiers, dyn: d }));
  return [...lines, ...extra];
}

export type Awarded = ReadonlyMap<string, { date: string; target: number }>;
export const awardKey = (line: string, tier: string) => `${line}|${tier}`;
export type NewAward = { line: LineId | string; tier: AchievementTier; date: string; target: number; detail?: Record<string, unknown> | null };

/**
 * Tiers to store now: reached and not stored yet, each on the day ITS OWN target was reached. A stored or reached higher
 * tier implies the lower ones — a lower tier the data no longer shows (settings raised, history trimmed) is awarded on
 * the higher one's day, so a line never has a gold without a bronze.
 */
export function newAwards(results: readonly LineResult[], awarded: Awarded): NewAward[] {
  const out: NewAward[] = [];
  for (const r of results) {
    let impliedOn: string | null = null;
    for (let i = r.tiers.length - 1; i >= 0; i--) {
      const t = r.tiers[i]!;
      const stored = awarded.get(awardKey(r.id, t.tier));
      if (stored) {
        impliedOn ??= stored.date;
        continue;
      }
      const date: string | null = t.earnedOn ?? impliedOn;
      if (date) {
        const day = impliedOn && t.earnedOn && t.earnedOn > impliedOn ? impliedOn : date;
        out.push({ line: r.id, tier: t.tier, date: day, target: t.target, ...(r.dyn ? { detail: r.dyn.detail } : {}) });
        impliedOn ??= date;
      }
    }
  }
  return out.reverse();
}

/**
 * Stored tiers dated on another day than the one the data shows their own target reached (same target as stored): the
 * day to store instead. Repairs tiers copied from the old badges (the clean month was looked for in the last 3 months
 * only; «reviews» gave the review streak's bronze the silver's day) and tiers an older build dated on a lower tier's
 * day. A tier the data no longer shows, or whose number changed since, keeps its stored day.
 */
/** Lines whose rule changed (R3: full reviews only): stored tiers keep their day — the new rule never re-dates history. */
const KEEP_STORED_DATE: ReadonlySet<LineId> = new Set(["reviews_total", "review_streak", "full_loop"]);

export function dateFixes(results: readonly LineResult[], awarded: Awarded): NewAward[] {
  const out: NewAward[] = [];
  for (const r of results) {
    if (KEEP_STORED_DATE.has(r.id as LineId) || r.dyn) continue;
    for (const t of r.tiers) {
      const stored = awarded.get(awardKey(r.id, t.tier));
      if (stored && t.earnedOn && stored.target === t.target && stored.date !== t.earnedOn) out.push({ line: r.id, tier: t.tier, date: t.earnedOn, target: t.target });
    }
  }
  return out;
}

/** {count} picks the plural form; {target} is the same number. */
const hintParams = (target: number) => ({ target, count: target });

/** API shape: stored tiers keep their day and number (awarded once — a later rule change never takes them away). */
export function achievementStates(results: readonly LineResult[], awarded: Awarded): Achievement[] {
  const dyn = results.flatMap((r) => (r.dyn ? [r.dyn] : []));
  const items = { leaks_closed: itemsOf(dyn, awarded, "leak"), path_steps: itemsOf(dyn, awarded, "path") } as Record<string, AchievementItem[]>;
  return results
    // Leak and path-step lines are items of their count card, not cards of their own.
    .filter((r) => r.dyn?.kind !== "leak" && r.dyn?.kind !== "path")
    .map((r) => {
      const def = r.dyn ? null : lineDef(r.id) ?? null;
      const tiers = r.tiers.map((t) => {
        const a = awarded.get(awardKey(r.id, t.tier));
        return a ? { tier: t.tier, target: a.target, earnedAt: a.date } : { tier: t.tier, target: t.target, earnedAt: null };
      });
      const earned = tiers.filter((t) => t.earnedAt);
      const top = earned.length ? earned[earned.length - 1]!.tier : null;
      const next = tiers.find((t) => !t.earnedAt);
      const hidden = !!def?.secret && !top;
      const title = r.dyn ? r.dyn.title : { key: hidden ? "ach.secret.title" : `ach.${r.id}.title` };
      const hintParamsOf = hintParams(next?.target ?? tiers[tiers.length - 1]?.target ?? 0);
      const hint = hidden ? { key: "ach.secret.hint" } : r.dyn ? { ...r.dyn.hint, params: { ...r.dyn.hint.params, ...hintParamsOf } } : { key: `ach.${r.id}.hint`, params: hintParamsOf };
      return {
        id: r.id,
        category: def?.category ?? "mastery",
        title,
        hint,
        // Every tier earned: the data behind it may no longer be loaded (clean months) — never show less than the top.
        current: hidden ? 0 : next ? r.current : Math.max(r.current, tiers[tiers.length - 1]?.target ?? 0),
        tiers: hidden ? tiers.map((t) => ({ ...t, target: 0 })) : tiers,
        tier: top,
        secret: !!def?.secret,
        horizon: def?.horizon ?? "signature",
        unit: def?.unit ?? "trades",
        big: tiers.some((t) => isBigTier(def, r.id, t.tier)),
        ...(r.dyn ? { held: r.dyn.held, lostOn: r.dyn.lostOn, info: r.dyn.info } : {}),
        ...(items[r.id] ? { items: items[r.id] } : {}),
      };
    });
}

/** The legacy badge list (DailyMe.badges, the curator line) from the achievements. */
export function badgesOf(states: readonly Achievement[]): BadgeState[] {
  return (Object.keys(BADGE_TIER) as BadgeId[]).map((id) => {
    const [line, idx] = BADGE_TIER[id];
    const a = states.find((s) => s.id === line);
    const t = a?.tiers[idx];
    if (!a || !t) return { id, earnedOn: null, target: 0, progress: 0 };
    return { id, earnedOn: t.earnedAt, target: t.target, progress: t.earnedAt ? t.target : Math.min(a.current, t.target) };
  });
}

/** A stored badge row → its line tier (trader_badges written by an older process after the migration). */
export function badgeAward(badge: string): { line: LineId; tier: AchievementTier } | null {
  const m = BADGE_TIER[badge as BadgeId];
  if (!m) return null;
  const def = lineDef(m[0])!;
  return { line: m[0], tier: (def.tiers ?? TIERS)[m[1]] as AchievementTier };
}
