/**
 * Pure helpers of the dashboard routes (routes/dashboard.ts): number coercion, the shared aggregate shape, NY week /
 * feed windows, streaks and the reader's violation line. No I/O.
 */
import { addDays, isWeekend, nyDate } from "./tradingDate";
import { rulesT, violationMessage } from "./rulesI18n";
import type { Lang } from "../i18n";

export const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
export const n = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
export const r2 = (v: number): number => Math.round(v * 100) / 100;
export const nullable = (v: unknown): number | null => (v == null ? null : n(v));

/** Monday of the NY trading week that contains `ymd` (Sat/Sun belong to the week just ended). */
export function mondayOf(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sun
  return addDays(ymd, -((wd + 6) % 7));
}

/**
 * Oldest date of the "fresh" market-context window: the last 3 trading days up to `today`
 * (weekends skipped; holidays aren't excluded here, so the window can only be slightly wider).
 */
export function freshFeedFrom(today: string, tradingDays = 3): string {
  let d = today;
  let seen = isWeekend(d) ? 0 : 1;
  while (seen < tradingDays) {
    d = addDays(d, -1);
    if (!isWeekend(d)) seen++;
  }
  return d;
}

/** Trading date requested by the client (only a valid YYYY-MM-DD is honoured), else today in New York. */
export function tradingDate(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim() : "";
  return YMD_RE.test(s) ? s : nyDate();
}

export type Agg = Record<string, unknown>;
export function aggOut(a: Agg | undefined) {
  const wins = n(a?.wins), losses = n(a?.losses), be = n(a?.be);
  const decided = wins + losses;
  const rCount = n(a?.r_count), rNeg = n(a?.r_neg), rPos = n(a?.r_pos);
  const hasPnl = n(a?.pnl_count) > 0;
  return {
    trades: n(a?.trades),
    closed: wins + losses + be,
    wins, losses, be,
    /** Net $ (gross − |fees|); null until broker/manual P&L exists. */
    pnl: hasPnl ? r2(n(a?.pnl_net)) : null,
    pnlNet: hasPnl ? r2(n(a?.pnl_net)) : null,
    pnlGross: hasPnl ? r2(n(a?.pnl_gross)) : null,
    fees: hasPnl ? r2(n(a?.fees)) : null,
    pnlCount: n(a?.pnl_count),
    r: r2(n(a?.r)),
    rCount,
    winRate: decided > 0 ? wins / decided : null,
    expectancyR: rCount > 0 ? r2(n(a?.r) / rCount) : null,
    profitFactorR: rNeg < 0 ? r2(rPos / Math.abs(rNeg)) : null,
  };
}

/**
 * A violation line for the reader (MAKSIM-12): the stored reason rendered from `details.msg` in `lang`; without it the
 * rule kind's label in `lang` (never the stored Russian text for an EN / UZ reader); RU keeps the stored message.
 */
export function violationLine(message: string | null | undefined, details: unknown, ruleKind: string | null | undefined, lang: Lang): string {
  const hasMsg = !!details && typeof details === "object" && !!(details as { msg?: unknown }).msg;
  if (hasMsg || lang === "ru") return violationMessage(message, details, lang);
  return (ruleKind ? rulesT.tryFor(lang, `kinds.${ruleKind}.label`) : undefined) ?? violationMessage(message, details, lang);
}

// ─── Streak helpers (results most-recent-first) ───────────────────────────────
export function streaksOf(results: ("win" | "loss" | "be")[]) {
  let current = { count: 0, type: "none" as "win" | "loss" | "none" };
  for (const r of results) {
    if (r !== "win" && r !== "loss") continue;
    if (current.type === "none") current = { count: 1, type: r };
    else if (r === current.type) current.count++;
    else break;
  }
  let bestWin = 0, bestLoss = 0, runW = 0, runL = 0;
  for (const r of [...results].reverse()) {
    if (r === "win") { runW++; runL = 0; } else if (r === "loss") { runL++; runW = 0; } else continue;
    bestWin = Math.max(bestWin, runW); bestLoss = Math.max(bestLoss, runL);
  }
  return { current, bestWin, bestLoss };
}
