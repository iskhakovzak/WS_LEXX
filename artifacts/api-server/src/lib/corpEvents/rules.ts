/**
 * Corporate and index events — codes and the deterministic dates (pure, no DB). Every date is a New York trading day
 * (YYYY-MM-DD); `closed` = full-day market holidays (holiday_calendar «Market closed…», lib/marketDays).
 *
 *   quad witching            third Friday of Mar / Jun / Sep / Dec; a holiday moves it to the session before
 *   S&P quarterly rebalance  effective after the close of the same third Friday (S&P DJI quarterly schedule)
 *   MSCI index reviews       effective as of the close of the last business day of Feb / May / Aug / Nov
 *                            (quarterly: Feb, Aug; semi-annual: May, Nov)
 *   Nasdaq-100 reconstitution  annual, effective after the close of the third Friday of December
 *   lock-up expiry           IPO day + the stated lock-up days (else the desk default), rolled to the next session
 *
 * Announced adds / removals, spin-offs, pricings and offerings are data (desk entries, the offerings feed), not rules.
 */

export const CORP_TYPES = ["lockup_expiry", "sp_add", "sp_remove", "index_rebalance", "quad_witching", "spinoff", "pricing", "offering", "ipo"] as const;
export type CorpType = (typeof CORP_TYPES)[number];
export const INDEX_CODES = ["sp500", "sp400", "sp600", "msci", "russell", "nasdaq100", "other"] as const;
export type IndexCode = (typeof INDEX_CODES)[number];

export type RuleEvent = { day: string; type: CorpType; indexCode: IndexCode | null; rule: "quad_witching" | "sp_quarterly" | "msci_quarterly" | "msci_semiannual" | "ndx_annual" };

const ymd = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const dow = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();
function shift(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const isSession = (day: string, closed: ReadonlySet<string>) => dow(day) !== 0 && dow(day) !== 6 && !closed.has(day);

/** The third Friday of a month (1–12). */
export function thirdFriday(year: number, month: number): string {
  const first = ymd(year, month, 1);
  const offset = (5 - dow(first) + 7) % 7; // days to the first Friday
  return shift(first, offset + 14);
}

/** The session on or before `day`. */
export function sessionOnOrBefore(day: string, closed: ReadonlySet<string>): string {
  let d = day;
  for (let i = 0; i < 10 && !isSession(d, closed); i++) d = shift(d, -1);
  return d;
}

/** The session on or after `day`. */
export function sessionOnOrAfter(day: string, closed: ReadonlySet<string>): string {
  let d = day;
  for (let i = 0; i < 10 && !isSession(d, closed); i++) d = shift(d, 1);
  return d;
}

/** The last business day of a month. */
export function lastBusinessDay(year: number, month: number, closed: ReadonlySet<string>): string {
  const last = shift(month === 12 ? ymd(year + 1, 1, 1) : ymd(year, month + 1, 1), -1);
  return sessionOnOrBefore(last, closed);
}

/** Quad witching days of a year (holiday-adjusted). */
export function quadWitchingDays(year: number, closed: ReadonlySet<string> = new Set()): string[] {
  return [3, 6, 9, 12].map((m) => sessionOnOrBefore(thirdFriday(year, m), closed));
}

/** Every rule-based index date of [from, to] (inclusive), sorted. */
export function ruleEvents(from: string, to: string, closed: ReadonlySet<string> = new Set()): RuleEvent[] {
  const out: RuleEvent[] = [];
  const y0 = Number(from.slice(0, 4));
  const y1 = Number(to.slice(0, 4));
  for (let y = y0; y <= y1; y++) {
    for (const m of [3, 6, 9, 12]) {
      const qw = sessionOnOrBefore(thirdFriday(y, m), closed);
      out.push({ day: qw, type: "quad_witching", indexCode: null, rule: "quad_witching" });
      out.push({ day: qw, type: "index_rebalance", indexCode: "sp500", rule: "sp_quarterly" });
      if (m === 12) out.push({ day: qw, type: "index_rebalance", indexCode: "nasdaq100", rule: "ndx_annual" });
    }
    for (const m of [2, 5, 8, 11]) {
      out.push({ day: lastBusinessDay(y, m, closed), type: "index_rebalance", indexCode: "msci", rule: m === 5 || m === 11 ? "msci_semiannual" : "msci_quarterly" });
    }
  }
  return out.filter((e) => e.day >= from && e.day <= to).sort((a, b) => a.day.localeCompare(b.day) || a.rule.localeCompare(b.rule));
}

/** Lock-up expiry of an IPO: `ipoDay` + lock-up days (calendar), on the next session; `estimated` = the default was used. */
export function lockupExpiry(ipoDay: string, lockupDays: number | null | undefined, defaultDays: number, closed: ReadonlySet<string> = new Set()): { day: string; estimated: boolean } {
  const stated = lockupDays != null && Number.isFinite(lockupDays) && lockupDays > 0 && lockupDays <= 1100;
  return { day: sessionOnOrAfter(shift(ipoDay, stated ? Math.round(lockupDays) : defaultDays), closed), estimated: !stated };
}

/** An S&P index change in a news headline («… set to join S&P 500», «… to replace X in the S&P SmallCap 600»). */
const SP_INDEX: { re: RegExp; code: IndexCode }[] = [
  { re: /S&P\s*500/i, code: "sp500" },
  { re: /S&P\s*(MidCap\s*)?400/i, code: "sp400" },
  { re: /S&P\s*(SmallCap\s*)?600/i, code: "sp600" },
];
const ADD_RE = /\b(set to join|to join|will join|added to|to be added to|joins|to replace .+ in)\b/i;
const REMOVE_RE = /\b(removed from|to be removed from|to exit|dropped from|leaves|to leave)\b/i;
export function spChangeOf(headline: string): { type: "sp_add" | "sp_remove"; indexCode: IndexCode } | null {
  const idx = SP_INDEX.find((x) => x.re.test(headline));
  if (!idx) return null;
  if (REMOVE_RE.test(headline)) return { type: "sp_remove", indexCode: idx.code };
  if (ADD_RE.test(headline)) return { type: "sp_add", indexCode: idx.code };
  return null;
}

/** Offerings-feed row → the calendar type (an IPO, a priced follow-on / bought deal, anything else filed). */
export function offeringType(o: { type?: string | null; kind?: string | null }): "ipo" | "pricing" | "offering" {
  const t = String(o.type ?? "").toLowerCase();
  const k = String(o.kind ?? "").toUpperCase();
  if (t === "ipo" || k === "IPO") return "ipo";
  if (k === "424B" || t === "follow-on" || t === "bought deal") return "pricing";
  return "offering";
}
