/**
 * The season calendar of the market regime layer (pure, tests in __tests__/season.test.ts). A desk runs less risk when
 * the market is quiet and labels the weeks that matter:
 *
 *   off-season       season.offFrom … season.offTo (MM-DD, New York; default mid-August to early October), may wrap
 *                    the new year
 *   prime weeks      the peak of each earnings season: from season.primeStartDay of January / April / July / October
 *                    for season.primeWeeks weeks
 *   quad witching    the third Friday of March / June / September / December (stock + index options and futures expire)
 *   S&P rebalance    the quarterly S&P index rebalance, effective after the close of the same third Friday
 *   MSCI rebalance   the MSCI index review, effective after the close of the last weekday of February / May / August /
 *                    November
 *   holiday eve      an early-close session, or a weekday next to a full-day market holiday (season.holidayEves)
 *
 * A day is QUIET in the off-season or on a holiday eve — never on an event day (witching and rebalances bring volume).
 * On a quiet day the daily loss limit × season.quietFactor (applied to the stops while season.trimLimits is on, else a
 * suggestion), the brief says not trading is fine and the day goal is «do not lose the daily stop without a reason».
 */
export const SEASON_EVENTS = ["quad_witching", "sp_rebalance", "msci_rebalance"] as const;
export type SeasonEvent = (typeof SEASON_EVENTS)[number];

export type SeasonCfg = {
  enabled: boolean;
  offFrom: string;
  offTo: string;
  quietFactor: number;
  trimLimits: boolean;
  holidayEves: boolean;
  primeStartDay: number;
  primeWeeks: number;
};

export const DEFAULT_SEASON: SeasonCfg = {
  enabled: true, offFrom: "08-15", offTo: "10-05", quietFactor: 0.75, trimLimits: true, holidayEves: true, primeStartDay: 12, primeWeeks: 4,
};

/** Calendar facts of the day the pure function cannot know (lib/marketDays). */
export type DayFacts = { earlyClose?: boolean; prevClosed?: boolean; nextClosed?: boolean };

export type SeasonDay = {
  day: string;
  offSeason: boolean;
  prime: boolean;
  events: SeasonEvent[];
  holidayEve: boolean;
  quiet: boolean;
  /** Daily-limit multiplier of the day (quietFactor on a quiet day, else 1). */
  factor: number;
  /** The factor changes the stops (season.trimLimits), not only the suggestion. */
  trim: boolean;
};

const MMDD = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const parts = (day: string) => ({ y: Number(day.slice(0, 4)), m: Number(day.slice(5, 7)), d: Number(day.slice(8, 10)) });
const mmdd = (day: string) => day.slice(5, 10);
const dow = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** The third Friday of a month (day of month). */
export function thirdFriday(y: number, m: number): number {
  const first = dow(y, m, 1);
  return 1 + ((5 - first + 7) % 7) + 14;
}

/** The last weekday (Mon–Fri) of a month (day of month). */
export function lastWeekday(y: number, m: number): number {
  let d = lastDay(y, m);
  while (dow(y, m, d) === 0 || dow(y, m, d) === 6) d--;
  return d;
}

/** In the MM-DD window [from, to] (inclusive; a window may wrap past December). Bad bounds → never. */
export function inWindow(day: string, from: string, to: string): boolean {
  if (!MMDD.test(from) || !MMDD.test(to)) return false;
  const x = mmdd(day);
  return from <= to ? x >= from && x <= to : x >= from || x <= to;
}

export function isPrime(day: string, startDay: number, weeks: number): boolean {
  const { y, m, d } = parts(day);
  const qStart = [1, 4, 7, 10].filter((q) => q <= m).pop() ?? 10;
  const start = Date.UTC(qStart === 10 && m < 10 ? y - 1 : y, qStart - 1, Math.max(1, Math.min(28, Math.round(startDay))));
  const t = Date.UTC(y, m - 1, d);
  return t >= start && t < start + Math.max(1, Math.round(weeks)) * 7 * 86_400_000;
}

export function eventsOf(day: string): SeasonEvent[] {
  const { y, m, d } = parts(day);
  const out: SeasonEvent[] = [];
  if (m % 3 === 0 && d === thirdFriday(y, m)) out.push("quad_witching", "sp_rebalance");
  if ((m === 2 || m === 5 || m === 8 || m === 11) && d === lastWeekday(y, m)) out.push("msci_rebalance");
  return out;
}

export function seasonOf(day: string, cfg: SeasonCfg, facts: DayFacts = {}): SeasonDay {
  const events = eventsOf(day);
  const offSeason = cfg.enabled && inWindow(day, cfg.offFrom, cfg.offTo);
  const prime = cfg.enabled && isPrime(day, cfg.primeStartDay, cfg.primeWeeks);
  const holidayEve = cfg.enabled && cfg.holidayEves && !!(facts.earlyClose || facts.prevClosed || facts.nextClosed);
  const quiet = cfg.enabled && !events.length && (offSeason || holidayEve);
  const factor = quiet && cfg.quietFactor > 0 && cfg.quietFactor <= 1 ? cfg.quietFactor : 1;
  return { day, offSeason, prime, events: cfg.enabled ? events : [], holidayEve, quiet, factor, trim: quiet && cfg.trimLimits };
}
