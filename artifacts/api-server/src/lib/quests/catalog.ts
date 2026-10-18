/**
 * Quest catalog — PURE templates (no I/O), unit-tested through lib/quests/engine.ts. Every quest's progress is read
 * from stored data (QuestData, loaded by lib/quests/load.ts): nobody types anything to make progress, and nothing
 * rewards P&L, trade count or time in the app. Numbers are desk settings (`quests.*`).
 *
 *   onboarding (in order, each unlocks the next; no deadline)   set_pin → link_telegram → first_plan_stop →
 *              first_review → open_desk_day → replay_own_day → set_own_rule          quests.onboardingPoints (10) each
 *   daily      plan_before_open (only offered before 09:30 NY), review_yesterday (the last finished traded day, until
 *              the next trading day ends), keep_contract (a contract set today or in the last two weeks) — 3 points;
 *              tag_yesterday (playbook setups on that day's own trades, offered while some are untagged; target = the
 *              day's trades up to quests.tagYesterdayMax) — quests.tagYesterdayPoints
 *   weekly     Monday → Friday, quests.weeklyCount (3) of: contract_days (4 of 5), focus_absent_days (3),
 *              replay_own_days (2), review_traded_days (every traded day on time), read_game_plan (3) — 10 points
 *   monthly    clean_month_progress (the daily stop never reached, ≥ rewards.cleanMonthMinDays traded days),
 *              review_month (≥ quests.monthlyReviewPct % of traded days reviewed on time) — 25 points
 *   curator    assigned from CURATOR_TEMPLATES with the curator's target / deadline / points / note (counted over the
 *              quest's own days), or curator_task — done when the curator marks it
 */
import { addDays, isWeekend } from "../tradingDate";
import { OPEN_MINUTES } from "../curatorLogic";
import { reviewedOnTime, type FocusDay, type OwnGame, type ReviewDay, type StopDay } from "../daily/badges";
import type { LedgerDay } from "../daily/discipline";
import { setting } from "../settings/registry";
import type { QuestScope, QuestStatus } from "./types";

/** Everything the quest rules read for one trader at one moment. */
export type QuestData = {
  today: string;
  /** NY minutes from midnight now. */
  minutes: number;
  /** The last finished trading day (today after the close). */
  lastFinished: string;
  /** Today is a weekday that is not a market holiday. */
  tradingDay: boolean;
  user: { mustChangeSecret: boolean; telegram: boolean };
  /** Personal plans by day: created before the open (09:30 NY), sets a daily stop / own rule / any contract field. */
  plans: ReadonlyMap<string, { beforeOpen: boolean; stop: boolean; ownRule: boolean; contract: boolean }>;
  ledger: readonly LedgerDay[];
  /** Traded days (all time) with the day each was reviewed. */
  reviews: readonly ReviewDay[];
  focus: readonly FocusDay[];
  games: readonly OwnGame[];
  /** Desk game plans of the last weeks: the plan's day and the day the trader last opened it (null = never). */
  gamePlans: readonly { date: string; readOn: string | null }[];
  /** Days the trader opened «Деск на тикере» for a ticker-day they traded. */
  deskDayOpens: readonly string[];
  /** This month's traded days: worst running net and the daily stop. */
  monthStops: readonly StopDay[];
  /** A daily stop is known for the trader (risk limits or a recent plan). */
  stopKnown: boolean;
  /** Prefill for links: the trader's last traded ticker-day and a recent losing trade to replay. */
  lastTickerDay: { ticker: string; date: string } | null;
  replayTradeId: number | null;
  /** Own closed trades per NY close day of the last two weeks and how many carry a live setup (lib/playbookToday/untagged). */
  tagDays?: ReadonlyMap<string, { trades: number; tagged: number }>;
};

export type StoredQuest = {
  id: number;
  trader: string;
  scope: QuestScope;
  template: string;
  period: string;
  params: Record<string, unknown>;
  progress: number;
  target: number;
  status: QuestStatus | "cancelled";
  rewardPoints: number;
  startsOn: string;
  endsOn: string | null;
  completedOn: string | null;
  assignedBy: string | null;
  note: string | null;
};

/** A quest's state from the data: progress, target (may grow with the period) and a final status when reached. */
export type Eval = { progress: number; target: number; status: QuestStatus };

type Ctx = { d: QuestData; q: Pick<StoredQuest, "startsOn" | "endsOn" | "target" | "period"> };

export type Template = {
  key: string;
  scope: QuestScope;
  points: () => number;
  /** Is it worth offering in this period (catalog scopes)? */
  relevant?: (d: QuestData, period: Period) => boolean;
  /** Initial target for the period. */
  target: (d: QuestData, period: Period) => number;
  evaluate: (c: Ctx) => Eval;
  href: (d: QuestData, q: Pick<StoredQuest, "startsOn" | "period">) => string | null;
};

export type Period = { key: string; startsOn: string; endsOn: string | null };

// ─── dates ──────────────────────────────────────────────────────────────────

export function nextWeekday(d: string): string {
  let x = addDays(d, 1);
  for (let i = 0; i < 7 && isWeekend(x); i++) x = addDays(x, 1);
  return x;
}

/** Monday of the week of `d` (a weekend day belongs to the week before it ends — Saturday/Sunday → that week's Monday). */
export function mondayOf(d: string): string {
  const wd = new Date(`${d}T12:00:00Z`).getUTCDay(); // 0 Sun … 6 Sat
  return addDays(d, wd === 0 ? -6 : 1 - wd);
}

export const fridayOf = (d: string) => addDays(mondayOf(d), 4);
/** The quest week of `today`: this Monday on a weekday, the coming Monday at the weekend. */
export const questWeekOf = (today: string) => (isWeekend(today) ? mondayOf(nextWeekday(today)) : mondayOf(today));
export const monthOf = (d: string) => d.slice(0, 7);
export function monthEnd(month: string): string {
  const x = new Date(`${month}-01T12:00:00Z`);
  x.setUTCMonth(x.getUTCMonth() + 1, 0);
  return x.toISOString().slice(0, 10);
}

/** Week number since 2024-01-01 (a Monday): rotates the weekly picks. */
export function weekIndex(monday: string): number {
  return Math.round((Date.parse(`${monday}T12:00:00Z`) - Date.parse("2024-01-01T12:00:00Z")) / (7 * 86_400_000));
}

export const periods = {
  once: (d: QuestData): Period => ({ key: "once", startsOn: d.today, endsOn: null }),
  day: (date: string): Period => ({ key: date, startsOn: date, endsOn: date }),
  /** Monday → Friday; at the weekend the coming week (the past one is over). */
  week: (d: QuestData): Period => {
    const m = questWeekOf(d.today);
    return { key: m, startsOn: m, endsOn: addDays(m, 4) };
  },
  month: (d: QuestData): Period => {
    const m = monthOf(d.today);
    return { key: m, startsOn: `${m}-01`, endsOn: monthEnd(m) };
  },
};

// ─── counters over [from, to] ───────────────────────────────────────────────

const inRange = (date: string, from: string, to: string) => date >= from && date <= to;
const clampTo = (c: Ctx) => (c.q.endsOn && c.q.endsOn < c.d.today ? c.q.endsOn : c.d.today);

export const count = {
  contractKept: (d: QuestData, from: string, to: string) => d.ledger.filter((x) => x.outcome === "kept" && inRange(x.date, from, to)).length,
  focusKept: (d: QuestData, from: string, to: string) => d.focus.filter((x) => !x.disputed && x.status === "kept" && inRange(x.date, from, to)).length,
  replays: (d: QuestData, from: string, to: string) => d.games.filter((g) => inRange(g.finishedOn, from, to)).length,
  beats: (d: QuestData, from: string, to: string) => d.games.filter((g) => g.verdict === "better" && inRange(g.finishedOn, from, to)).length,
  traded: (d: QuestData, from: string, to: string) => d.reviews.filter((r) => inRange(r.date, from, to)).length,
  reviewedOnTime: (d: QuestData, from: string, to: string) => d.reviews.filter((r) => inRange(r.date, from, to) && reviewedOnTime(r)).length,
  plansBeforeOpen: (d: QuestData, from: string, to: string) => [...d.plans].filter(([date, p]) => p.beforeOpen && inRange(date, from, to)).length,
  gamePlanReads: (d: QuestData, from: string, to: string) => d.gamePlans.filter((g) => inRange(g.date, from, to) && g.readOn != null).length,
};

/** Counting quest: done at the target, else active (the engine expires it after its last day). */
const reach = (progress: number, target: number): Eval => ({ progress: Math.min(progress, target), target, status: progress >= target ? "done" : "active" });
const recent = (d: QuestData, days: number) => addDays(d.today, -days);

// ─── links (prefilled from the trader's data) ───────────────────────────────

const links = {
  plan: (d: QuestData) => `/game-plan?view=my&date=${encodeURIComponent(d.today)}`,
  home: () => "/",
  sim: (d: QuestData) => (d.replayTradeId ? `/trainer?own=${d.replayTradeId}` : "/trainer"),
  deskDay: (d: QuestData) => (d.lastTickerDay
    ? `/desk-day?ticker=${encodeURIComponent(d.lastTickerDay.ticker)}&date=${encodeURIComponent(d.lastTickerDay.date)}`
    : "/desk-day"),
  gamePlan: () => "/game-plan",
};

// ─── onboarding ─────────────────────────────────────────────────────────────

const onboardingStep = (key: string, done: (d: QuestData) => boolean, href: Template["href"]): Template => ({
  key, scope: "onboarding", points: () => setting("quests.onboardingPoints"), target: () => 1,
  evaluate: ({ d }) => reach(done(d) ? 1 : 0, 1), href,
});

const anyPlan = (d: QuestData, f: (p: { stop: boolean; ownRule: boolean }) => boolean) => [...d.plans.values()].some(f);

export const ONBOARDING: readonly Template[] = [
  onboardingStep("set_pin", (d) => !d.user.mustChangeSecret, () => "/settings#profile"),
  onboardingStep("link_telegram", (d) => d.user.telegram, () => "/settings#integrations"),
  onboardingStep("first_plan_stop", (d) => anyPlan(d, (p) => p.stop), (d) => links.plan(d)),
  onboardingStep("first_review", (d) => d.reviews.some((r) => r.reviewedOn != null), links.home),
  onboardingStep("open_desk_day", (d) => d.deskDayOpens.length > 0, (d) => links.deskDay(d)),
  onboardingStep("replay_own_day", (d) => d.games.length > 0, (d) => links.sim(d)),
  onboardingStep("set_own_rule", (d) => anyPlan(d, (p) => p.ownRule), (d) => links.plan(d)),
];

// ─── daily ──────────────────────────────────────────────────────────────────

const hadContract = (d: QuestData, days: number) => [...d.plans].some(([date, p]) => p.contract && date >= recent(d, days) && date <= d.today);

export const DAILY: readonly Template[] = [
  {
    key: "plan_before_open", scope: "daily", points: () => setting("quests.dailyPoints"), target: () => 1,
    relevant: (d) => d.tradingDay && d.minutes < OPEN_MINUTES,
    evaluate: ({ d, q }) => {
      if (d.plans.get(q.period)?.beforeOpen) return reach(1, 1);
      const over = d.today > q.period || d.minutes >= OPEN_MINUTES;
      return { progress: 0, target: 1, status: over ? "failed" : "active" };
    },
    href: (d) => links.plan(d),
  },
  {
    // The last finished traded day; on time = that day or the next trading day (lib/daily/badges reviewedOnTime).
    key: "review_yesterday", scope: "daily", points: () => setting("quests.dailyPoints"), target: () => 1,
    relevant: (d, p) => d.reviews.some((r) => r.date === p.key) && d.today <= nextWeekday(p.key),
    evaluate: ({ d, q }) => {
      const r = d.reviews.find((x) => x.date === q.period);
      return reach(r && reviewedOnTime(r) ? 1 : 0, 1);
    },
    href: links.home,
  },
  {
    key: "keep_contract", scope: "daily", points: () => setting("quests.dailyPoints"), target: () => 1,
    relevant: (d) => d.tradingDay && (!!d.plans.get(d.today)?.contract || hadContract(d, 14)),
    evaluate: ({ d, q }) => {
      const day = d.ledger.find((x) => x.date === q.period);
      if (day?.outcome === "kept") return reach(1, 1);
      if (day?.outcome === "broken") return { progress: 0, target: 1, status: "failed" };
      return { progress: 0, target: 1, status: "active" };
    },
    href: (d) => links.plan(d),
  },
  {
    // Setups on the last finished day's own trades (evening card «Разметь N сделок»); offered only while some are untagged.
    key: "tag_yesterday", scope: "daily", points: () => setting("quests.tagYesterdayPoints"),
    target: (d, p) => Math.min(d.tagDays?.get(p.key)?.trades ?? 1, setting("quests.tagYesterdayMax")),
    relevant: (d, p) => {
      const day = d.tagDays?.get(p.key);
      return setting("quests.tagYesterdayEnabled") && !!day && day.trades > day.tagged && d.today <= nextWeekday(p.key);
    },
    evaluate: ({ d, q }) => reach(d.tagDays?.get(q.period)?.tagged ?? 0, q.target),
    href: (_d, q) => `/?tagDay=${encodeURIComponent(q.period)}`,
  },
];

/** Daily periods: today for the plan / contract quests; the day to review (or tag) for review_yesterday / tag_yesterday. */
export function dailyPeriod(t: Template, d: QuestData): Period | null {
  if (t.key !== "review_yesterday" && t.key !== "tag_yesterday") return periods.day(d.today);
  const day = d.lastFinished;
  return { key: day, startsOn: day, endsOn: nextWeekday(day) };
}

// ─── weekly ─────────────────────────────────────────────────────────────────

const weekCounter = (key: string, n: () => number, c: (d: QuestData, from: string, to: string) => number,
  relevant: Template["relevant"], href: Template["href"]): Template => ({
  key, scope: "weekly", points: () => setting("quests.weeklyPoints"), target: () => n(), relevant, href,
  evaluate: ({ d, q }) => reach(c(d, q.startsOn, clampTo({ d, q })), q.target),
});

/** Every traded day of [from, to] reviewed on time: done once the period is over; failed when a day's window passed. */
function allReviewed(d: QuestData, from: string, to: string, needShare = 1): Eval {
  const traded = d.reviews.filter((r) => inRange(r.date, from, to));
  const done = traded.filter(reviewedOnTime).length;
  const target = Math.max(1, Math.ceil(traded.length * needShare - 1e-9));
  const lateDays = traded.filter((r) => !reviewedOnTime(r) && nextWeekday(r.date) < d.today).length;
  const periodOver = d.lastFinished >= to || d.today > to;
  if (periodOver && traded.length > 0 && done >= target) return { progress: done, target, status: "done" };
  if (traded.length - lateDays < target && (lateDays > 0 || periodOver)) return { progress: done, target, status: "failed" };
  return { progress: Math.min(done, target), target, status: "active" };
}

export const WEEKLY: readonly Template[] = [
  weekCounter("contract_days", () => setting("quests.weeklyContractDays"), count.contractKept, (d) => hadContract(d, 28), (d) => links.plan(d)),
  weekCounter("focus_absent_days", () => setting("quests.weeklyFocusDays"), count.focusKept,
    (d) => d.focus.some((f) => f.date >= recent(d, 14)), links.home),
  weekCounter("replay_own_days", () => setting("quests.weeklyReplays"), count.replays,
    (d) => d.reviews.some((r) => r.date >= recent(d, 30)), (d) => links.sim(d)),
  {
    key: "review_traded_days", scope: "weekly", points: () => setting("quests.weeklyPoints"), target: () => 1,
    relevant: (d) => d.reviews.some((r) => r.date >= recent(d, 14)),
    evaluate: ({ d, q }) => allReviewed(d, q.startsOn, q.endsOn ?? q.startsOn),
    href: links.home,
  },
  weekCounter("read_game_plan", () => setting("quests.weeklyGamePlanReads"), count.gamePlanReads,
    (d) => d.gamePlans.filter((g) => g.date >= recent(d, 14)).length >= setting("quests.weeklyGamePlanReads"), links.gamePlan),
];

// ─── monthly ────────────────────────────────────────────────────────────────

export const MONTHLY: readonly Template[] = [
  {
    key: "clean_month_progress", scope: "monthly", points: () => setting("quests.monthlyPoints"),
    target: () => setting("rewards.cleanMonthMinDays"),
    relevant: (d) => d.stopKnown,
    evaluate: ({ d, q }) => {
      const days = d.monthStops.filter((s) => inRange(s.date, q.startsOn, q.endsOn ?? q.startsOn));
      const target = q.target;
      if (days.some((s) => s.limit == null || s.limit <= 0 || s.trough <= -s.limit)) return { progress: 0, target, status: "failed" };
      const over = d.lastFinished >= (q.endsOn ?? q.startsOn) || d.today > (q.endsOn ?? q.startsOn);
      if (over) return { progress: Math.min(days.length, target), target, status: days.length >= target ? "done" : "expired" };
      return { progress: Math.min(days.length, target), target, status: "active" };
    },
    href: (d) => links.plan(d),
  },
  {
    key: "review_month", scope: "monthly", points: () => setting("quests.monthlyPoints"), target: () => 1,
    relevant: (d) => d.reviews.some((r) => r.date >= recent(d, 30)),
    evaluate: ({ d, q }) => allReviewed(d, q.startsOn, q.endsOn ?? q.startsOn, setting("quests.monthlyReviewPct") / 100),
    href: links.home,
  },
];

// ─── curator ────────────────────────────────────────────────────────────────

export type AssignSpec = { unit: "days" | "count"; defaultTarget: number; minTarget: number; maxTarget: number };

const curatorCounter = (key: string, spec: AssignSpec, c: (d: QuestData, from: string, to: string) => number, href: Template["href"]):
  Template & { assign: AssignSpec } => ({
  key, scope: "curator", points: () => setting("quests.curatorDefaultPoints"), target: () => spec.defaultTarget, href, assign: spec,
  evaluate: ({ d, q }) => reach(c(d, q.startsOn, clampTo({ d, q })), q.target),
});

/** Templates a curator may assign (auto-tracked over the quest's own days), plus the manual curator_task. */
export const CURATOR_TEMPLATES: readonly (Template & { assign: AssignSpec })[] = [
  curatorCounter("contract_days", { unit: "days", defaultTarget: 5, minTarget: 1, maxTarget: 60 }, count.contractKept, (d) => links.plan(d)),
  curatorCounter("focus_absent_days", { unit: "days", defaultTarget: 5, minTarget: 1, maxTarget: 60 }, count.focusKept, links.home),
  curatorCounter("review_days", { unit: "days", defaultTarget: 5, minTarget: 1, maxTarget: 60 }, count.reviewedOnTime, links.home),
  curatorCounter("plan_days", { unit: "days", defaultTarget: 5, minTarget: 1, maxTarget: 60 }, count.plansBeforeOpen, (d) => links.plan(d)),
  curatorCounter("replay_own_days", { unit: "count", defaultTarget: 3, minTarget: 1, maxTarget: 50 }, count.replays, (d) => links.sim(d)),
  curatorCounter("beat_yourself", { unit: "count", defaultTarget: 2, minTarget: 1, maxTarget: 50 }, count.beats, (d) => links.sim(d)),
  curatorCounter("read_game_plan", { unit: "days", defaultTarget: 5, minTarget: 1, maxTarget: 60 }, count.gamePlanReads, links.gamePlan),
  {
    key: "curator_task", scope: "curator", points: () => setting("quests.curatorDefaultPoints"), target: () => 1, href: () => null,
    assign: { unit: "count", defaultTarget: 1, minTarget: 1, maxTarget: 1 },
    // Done only when the curator marks it (POST /quests/:id/complete).
    evaluate: ({ q }) => ({ progress: 0, target: q.target, status: "active" }),
  },
];

export const MANUAL_TEMPLATE = "curator_task";

const ALL: readonly Template[] = [...ONBOARDING, ...DAILY, ...WEEKLY, ...MONTHLY, ...CURATOR_TEMPLATES];

export function templateOf(scope: QuestScope, key: string): Template | null {
  return ALL.find((t) => t.scope === scope && t.key === key) ?? null;
}

export function curatorTemplate(key: string): (Template & { assign: AssignSpec }) | null {
  return CURATOR_TEMPLATES.find((t) => t.key === key) ?? null;
}

/** Days after the last day a quest may still finish (an on-time review of the last day lands the next trading day). */
export function graceEnd(t: Pick<Template, "key">, endsOn: string): string {
  return t.key.startsWith("review") && t.key !== "review_yesterday" ? nextWeekday(endsOn) : endsOn;
}
