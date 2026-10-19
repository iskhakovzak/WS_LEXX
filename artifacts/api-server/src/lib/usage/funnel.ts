/**
 * Usage view — pure math (lib/usage/stats.ts feeds it rows; tests cover it):
 *
 *   activitySeries    DAU per day by role + WAU (distinct users in the 7 days ending that day) from (day, user, role)
 *   funnelRow         the daily loop of one trader over the given trading days:
 *                       visit     any sign of presence that day (a tracked view/action, a plan save, a review, a game)
 *                       plan      personal plan of that day first saved before 09:30 NY (on that day or earlier)
 *                       today     playbook «Сегодня» opened that day before 09:30 NY (tracked action only)
 *                       traded    closed own trades that NY close day
 *                       reviewed  evening card of that day reviewed (daily_reviews.reviewed_at, any time later)
 *                       tagged    "all" | "part" | "none" of that day's trades linked to a setup; null = no trades
 *                       trainer   a trainer game started or a «Найди вход» answer that day
 *   missedTradingDays trading days strictly between the last visit and today (today itself never counts)
 *   inactiveFrom      «Не заходят 3+ торговых дня» — the ONE rule for Использование and the Обзор card (OWNER-04):
 *                     only trading days since tracking started count; under INACTIVE_AFTER of them → lowData
 *   parsePilot        the comma / newline separated pilot list → stored names (matched case-insensitively against
 *                     stored or Latin names), unknown entries kept apart for the admin
 */

import { addDays, nyDate, nyMinutes } from "../tradingDate";

export const OPEN_MINUTES = 9 * 60 + 30;

export type RoleName = "trader" | "curator" | "admin";
export type ActivityPoint = { day: string; dau: number; wau: number; byRole: Record<RoleName, number> };

const ROLES: readonly RoleName[] = ["trader", "curator", "admin"];
const asRole = (r: string): RoleName => (ROLES.includes(r as RoleName) ? (r as RoleName) : "trader");

/** `days` ascending; rows = distinct (day, user, role) of the window plus 6 days before its first day. */
export function activitySeries(days: readonly string[], rows: readonly { day: string; userId: number; role: string }[]): ActivityPoint[] {
  const byDay = new Map<string, Map<number, RoleName>>();
  for (const r of rows) {
    const m = byDay.get(r.day) ?? new Map<number, RoleName>();
    m.set(r.userId, asRole(r.role));
    byDay.set(r.day, m);
  }
  return days.map((day) => {
    const today = byDay.get(day) ?? new Map<number, RoleName>();
    const byRole: Record<RoleName, number> = { trader: 0, curator: 0, admin: 0 };
    for (const role of today.values()) byRole[role]++;
    const week = new Set<number>();
    for (let i = 0; i < 7; i++) for (const u of byDay.get(addDays(day, -i))?.keys() ?? []) week.add(u);
    return { day, dau: today.size, wau: week.size, byRole };
  });
}

/** New York calendar day and minute of an instant. */
function nyParts(at: Date): { day: string; minutes: number } {
  return { day: nyDate(at), minutes: nyMinutes(at) };
}

/** Was `at` before the 09:30 NY open of `day` (the day before counts too)? */
export function beforeOpen(at: Date, day: string): boolean {
  const p = nyParts(at);
  return p.day < day || (p.day === day && p.minutes < OPEN_MINUTES);
}

export type TagState = "all" | "part" | "none";
export type FunnelStep = "visit" | "plan" | "today" | "traded" | "reviewed" | "tagged" | "trainer";
export const FUNNEL_STEPS: readonly FunnelStep[] = ["visit", "plan", "today", "traded", "reviewed", "tagged", "trainer"];

/** Raw facts of ONE trader (from lib/usage/stats.ts). Days are NY "YYYY-MM-DD". */
export type TraderFacts = {
  visitDays: ReadonlySet<string>;
  /** plan date → first save instant */
  plans: ReadonlyMap<string, Date>;
  /** tracked «Сегодня» opens */
  todayOpens: readonly Date[];
  /** close day → { trades, tagged } */
  tags: ReadonlyMap<string, { trades: number; tagged: number }>;
  reviewedDays: ReadonlySet<string>;
  trainerDays: ReadonlySet<string>;
};

export type FunnelCells = {
  visit: boolean[];
  plan: boolean[];
  today: boolean[];
  traded: boolean[];
  reviewed: boolean[];
  tagged: (TagState | null)[];
  trainer: boolean[];
};

export function tagState(t: { trades: number; tagged: number } | undefined): TagState | null {
  if (!t || t.trades <= 0) return null;
  if (t.tagged >= t.trades) return "all";
  return t.tagged > 0 ? "part" : "none";
}

export function funnelRow(days: readonly string[], f: TraderFacts): FunnelCells {
  const opened = new Set<string>();
  for (const at of f.todayOpens) {
    const p = nyParts(at);
    if (p.minutes < OPEN_MINUTES) opened.add(p.day);
  }
  return {
    visit: days.map((d) => f.visitDays.has(d)),
    plan: days.map((d) => { const at = f.plans.get(d); return !!at && beforeOpen(at, d); }),
    today: days.map((d) => opened.has(d)),
    traded: days.map((d) => (f.tags.get(d)?.trades ?? 0) > 0),
    reviewed: days.map((d) => f.reviewedDays.has(d)),
    tagged: days.map((d) => tagState(f.tags.get(d))),
    trainer: days.map((d) => f.trainerDays.has(d)),
  };
}

/** Days with a check per step (tagged counts only "all"); the share base is the number of days, traded days for review / tags. */
export function funnelTotals(c: FunnelCells): Record<FunnelStep, number> {
  const n = (xs: readonly boolean[]) => xs.filter(Boolean).length;
  return {
    visit: n(c.visit), plan: n(c.plan), today: n(c.today), traded: n(c.traded), reviewed: n(c.reviewed),
    tagged: c.tagged.filter((x) => x === "all").length, trainer: n(c.trainer),
  };
}

/**
 * Trading days strictly between `lastDay` and `today` (`tradingDays` = ascending trading days of the window that ends
 * at or before today). null lastDay = never seen in the window → the whole window (capped by its length).
 */
export function missedTradingDays(tradingDays: readonly string[], lastDay: string | null, today: string): number {
  return tradingDays.filter((d) => d < today && (lastDay == null || d > lastDay)).length;
}

/** Traders silent for this many trading days are «не заходят» (both admin screens). */
export const INACTIVE_AFTER = 3;

export type InactiveRow = { name: string; lastDay: string | null; missedDays: number; capped: boolean };

/**
 * Who has not come for INACTIVE_AFTER+ trading days. `window` = ascending trading days ending at or before `today`;
 * `trackedSince` = the first tracked day (usage_events). Only trading days on or after it count — a trader who traded
 * on Friday is never «30+ days without a trace» because tracking started on Sunday. Fewer than INACTIVE_AFTER counted
 * days before today → lowData (nobody is listed; the UI says «учёт с … — мало данных»). `capped` = never seen since
 * tracking started (missedDays = every counted day).
 */
export function inactiveFrom(
  names: readonly string[], lastDayOf: (name: string) => string | null, window: readonly string[], today: string,
  trackedSince: string | null,
): { lowData: boolean; trackedDays: number; rows: InactiveRow[] } {
  const counted = trackedSince ? window.filter((d) => d >= trackedSince && d < today) : [];
  if (counted.length < INACTIVE_AFTER) return { lowData: true, trackedDays: counted.length, rows: [] };
  const rows: InactiveRow[] = [];
  for (const name of names) {
    const lastDay = lastDayOf(name);
    const missed = missedTradingDays(counted, lastDay, today);
    if (missed < INACTIVE_AFTER) continue;
    rows.push({ name, lastDay, missedDays: missed, capped: !lastDay || lastDay < counted[0]! });
  }
  return { lowData: false, trackedDays: counted.length, rows };
}

export type PilotPerson = { name: string; nameLatin?: string | null };

export function parsePilot(text: string, people: readonly PilotPerson[]): { names: string[]; unknown: string[] } {
  const byKey = new Map<string, string>();
  for (const p of people) {
    byKey.set(p.name.trim().toLowerCase(), p.name);
    if (p.nameLatin) byKey.set(p.nameLatin.trim().toLowerCase(), p.name);
  }
  const names: string[] = [];
  const unknown: string[] = [];
  for (const raw of text.split(/[,;\n]/)) {
    const entry = raw.trim();
    if (!entry) continue;
    const hit = byKey.get(entry.toLowerCase());
    if (hit) { if (!names.includes(hit)) names.push(hit); } else if (!unknown.includes(entry)) unknown.push(entry);
  }
  return { names, unknown };
}

/** Ladder order for «trainees first»; unknown / missing tiers after the ladder. */
const TIER_ORDER = ["trainee", "junior", "trader", "senior", "lead"];
export function tierRank(tier: string | null | undefined): number {
  const i = tier ? TIER_ORDER.indexOf(tier) : -1;
  return i < 0 ? TIER_ORDER.length : i;
}
