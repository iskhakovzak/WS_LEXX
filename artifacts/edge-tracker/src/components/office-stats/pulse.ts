/**
 * Pure maths of two «Обзор» extras (tested in pulse.test.ts):
 *
 *   weeklyPulse(days, today)   «Пульс недели»: this week (Mon … today) against last week and the mean of the four
 *                              weeks before; on a week without trades yet, the last traded week is «this».
 *   paceBand(days, actual, goal, today)
 *                              the year-end projection with an honest band: the remaining weekdays of the year are filled
 *                              with this year's own trading days drawn at random (seeded day bootstrap, B draws) — the
 *                              10 / 50 / 90 % of the year-end result and the share of draws that reach the goal. Needs
 *                              ≥ PACE_MIN_DAYS traded days. A spread of the past, not a forecast.
 */
import type { DayPoint } from "./api";

export const PACE_MIN_DAYS = 20;

/** YYYY-MM-DD + n calendar days. */
export function addDaysYmd(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Monday of the week of `ymd`. */
export function mondayOf(ymd: string): string {
  const wd = new Date(`${ymd}T12:00:00Z`).getUTCDay();
  return addDaysYmd(ymd, -((wd + 6) % 7));
}

export type WeekSum = { from: string; net: number; days: number; green: number; trades: number; best: DayPoint | null; worst: DayPoint | null };

function weekSum(days: readonly DayPoint[], from: string): WeekSum {
  const to = addDaysYmd(from, 6);
  const list = days.filter((d) => d.date >= from && d.date <= to);
  let best: DayPoint | null = null, worst: DayPoint | null = null;
  for (const d of list) {
    if (!best || d.v > best.v) best = d;
    if (!worst || d.v < worst.v) worst = d;
  }
  return {
    from, net: list.reduce((s, d) => s + d.v, 0), days: list.length, green: list.filter((d) => d.v > 0).length,
    trades: list.reduce((s, d) => s + d.trades, 0), best, worst,
  };
}

export type Pulse = {
  /** "current" = the running week; "last" = the running week has no trades yet, so the last traded week is shown. */
  which: "current" | "last";
  week: WeekSum;
  prev: WeekSum;
  /** Mean net of the (up to) four traded weeks before `week`; null without any. */
  avg4: number | null;
  avg4Weeks: number;
};

export function weeklyPulse(days: readonly DayPoint[], today: string): Pulse | null {
  if (!days.length) return null;
  let start = mondayOf(today);
  let which: Pulse["which"] = "current";
  let week = weekSum(days, start);
  if (!week.days) {
    const last = [...days].filter((d) => d.date <= today).pop();
    if (!last) return null;
    start = mondayOf(last.date);
    which = "last";
    week = weekSum(days, start);
  }
  const prev = weekSum(days, addDaysYmd(start, -7));
  const before = [1, 2, 3, 4].map((k) => weekSum(days, addDaysYmd(start, -7 * k))).filter((w) => w.days > 0);
  return { which, week, prev, avg4: before.length ? before.reduce((s, w) => s + w.net, 0) / before.length : null, avg4Weeks: before.length };
}

/** Weekdays after `today` through Dec 31 of its year (holidays not excluded: the band is a little wide, not narrow). */
export function weekdaysLeft(today: string): number {
  const end = `${today.slice(0, 4)}-12-31`;
  let n = 0;
  for (let d = addDaysYmd(today, 1); d <= end; d = addDaysYmd(d, 1)) {
    const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (wd !== 0 && wd !== 6) n++;
  }
  return n;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type PaceBand = { p10: number; p50: number; p90: number; pGoal: number; daysLeft: number; sample: number };

export function paceBand(days: readonly DayPoint[], actual: number, goal: number, today: string, B = 2000, seed = 20260101): PaceBand | null {
  const vals = days.filter((d) => d.date <= today).map((d) => d.v);
  if (vals.length < PACE_MIN_DAYS) return null;
  const left = weekdaysLeft(today);
  // Not every weekday is traded: scale the remaining days by this year's traded share of weekdays so far.
  const firstDay = days[0]?.date ?? today;
  let weekdays = 0;
  for (let d = firstDay; d <= today; d = addDaysYmd(d, 1)) { const wd = new Date(`${d}T12:00:00Z`).getUTCDay(); if (wd !== 0 && wd !== 6) weekdays++; }
  const rate = weekdays > 0 ? Math.min(1, vals.length / weekdays) : 1;
  const n = Math.round(left * rate);
  if (n === 0) return { p10: actual, p50: actual, p90: actual, pGoal: actual >= goal ? 1 : 0, daysLeft: 0, sample: vals.length };
  const rnd = mulberry32(seed);
  const out = new Float64Array(B);
  let hit = 0;
  for (let b = 0; b < B; b++) {
    let s = actual;
    for (let i = 0; i < n; i++) s += vals[Math.floor(rnd() * vals.length)];
    out[b] = s;
    if (s >= goal) hit++;
  }
  out.sort();
  const q = (p: number) => out[Math.min(B - 1, Math.max(0, Math.round(p * (B - 1))))];
  return { p10: q(0.1), p50: q(0.5), p90: q(0.9), pGoal: hit / B, daysLeft: n, sample: vals.length };
}
