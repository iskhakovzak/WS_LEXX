/**
 * Data layer of «Статистика офиса»: raw fetch helpers for /api/office-stats* (no orval codegen for new endpoints)
 * and response types mirrored from api-server/src/lib/officeStats.ts + routes/officeStats.ts.
 *
 * Admin (partner) responses carry both views (`usd`, `pct`) + capital; member responses carry `pct` only —
 * the server strips $, absolute volume and per-trader rows before sending.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiUrl } from "@/lib/api";

export const STRATEGIES = ["OPG", "OPGtoDAY", "Day", "MOC", "AfterMarket", "Overnight", "OPT"] as const;
export type Strategy = (typeof STRATEGIES)[number];
export type Unit = "usd" | "pct";

export type DayValue = { date: string; v: number };

export type Totals = {
  net: number; trades: number; wins: number; losses: number; winRate: number | null; profitFactor: number | null;
  avgR: number | null; volume?: number; tradingDays: number; greenDays: number; redDays: number; avgDay: number | null;
  bestDay: DayValue | null; worstDay: DayValue | null;
};

export type StrategyRow = {
  key: Strategy; trades: number; wins: number; losses: number; winRate: number | null; net: number;
  profitFactor: number | null; avgR: number | null; netShare: number | null; volumeShare: number | null; volume?: number;
};
export type YearStrategyRow = StrategyRow & { cum: number[]; monthly: (number | null)[] };

export type DayPoint = { date: string; doy: number; v: number; cum: number; trades: number; s: Partial<Record<Strategy, number>> };
export type MonthRow = { month: number; v: number | null; trades: number; days: number; green: number; red: number };

export type DrawdownInfo = {
  max: number; peakDate: string | null; troughDate: string | null; recoveredDate: string | null;
  recoveryDays: number | null; lengthDays: number | null; current: number; currentDays: number;
};
export type Pace = {
  goal: number; expected: number; actual: number; gap: number; needPerMonth: number; monthsLeft: number;
  projected: number | null; elapsed: number; status: "done" | "ahead" | "behind";
};

export type YearView = {
  year: number; goalPct: number; goal: number | null; capitalMissing: boolean; hasData: boolean;
  totals: Totals; days: DayPoint[]; strategies: YearStrategyRow[]; months: MonthRow[];
  drawdown: DrawdownInfo; streaks: { maxGreen: number; maxRed: number; current: number }; pace: Pace | null;
};

export type TimeBucket = { key: string; label: string; fromSec: number | null; v: number; trades: number; wins: number; losses: number; winRate: number | null };
export type WeekdayRow = { weekday: number; label: string; v: number; days: number; green: number; avg: number | null };
export type TickerRow = { ticker: string; trades: number; v: number; winRate: number | null; share: number | null; strategy: Strategy };
export type TraderRow = {
  trader: string; trades: number; net: number; share: number | null; winRate: number | null; profitFactor: number | null;
  volume: number; volumeShare: number | null; activeDays: number; greenDays: number; consistency: number | null;
  bestDay: DayValue | null; worstDay: DayValue | null; maxDrawdown: number; topStrategy: Strategy | null; spark: number[];
};

export type PeriodView = {
  from: string; to: string; totals: Totals; strategies: StrategyRow[]; timeOfDay: TimeBucket[]; weekday: WeekdayRow[];
  tickers: { top: TickerRow[]; bottom: TickerRow[] }; traders?: TraderRow[];
};
export type PrevPeriod = { from: string; to: string; totals: Totals; strategies: { key: Strategy; net: number }[] };
export type Insight = { key: string; tone: "up" | "down" | "warn" | "neutral"; text: string };

export type OfficeView = { unit: Unit; years: YearView[]; period: PeriodView; prev: PrevPeriod | null; insights: Insight[] };

export type Rules = {
  strategies: { key: Strategy; text: string }[];
  order: string;
  thresholds: { openAuctionUntil: string; opgExitBy: string; mocFrom: string; closeCross: string };
  notes: string[];
};

type Base = { years: number[]; period: { from: string; to: string }; today: string; rules: Rules };
export type AdminSetting = { year: number; capital: number | null; goalPct: number; updatedBy: string | null; updatedAt: string | null };
export type AdminResponse = Base & { role: "admin"; settings: AdminSetting[]; usd: OfficeView; pct: OfficeView };
export type MemberResponse = Base & { role: "member"; settings: { year: number; goalPct: number; hasCapital: boolean }[]; pct: OfficeView };
export type OfficeStatsResponse = AdminResponse | MemberResponse;

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function readError(res: Response): Promise<never> {
  let msg = `HTTP ${res.status}`;
  try { const b = (await res.json()) as { error?: string }; if (b?.error) msg = b.error; } catch { /* not json */ }
  throw new HttpError(res.status, msg);
}

export type OfficeParams = { years: number[]; from: string | null; to: string | null };

export function useOfficeStats(p: OfficeParams, enabled = true) {
  return useQuery({
    queryKey: ["office-stats", p.years.join(","), p.from, p.to],
    queryFn: async () => {
      const q = new URLSearchParams({ years: p.years.join(",") });
      if (p.from) q.set("from", p.from);
      if (p.to) q.set("to", p.to);
      const res = await fetch(apiUrl(`/api/office-stats?${q}`));
      if (!res.ok) return readError(res);
      return (await res.json()) as OfficeStatsResponse;
    },
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

export function useSaveCapital() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { year: number; capital: number | null; goalPct: number }) => {
      const res = await fetch(apiUrl("/api/office-stats/capital"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) return readError(res);
      return (await res.json()) as AdminSetting;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["office-stats"] }),
  });
}

// ─── Formatting ────────────────────────────────────────────────────────────

const MINUS = "−";

/** +1.23% / −$1,234 — signed by default. */
export function fmtV(v: number | null | undefined, unit: Unit, o: { signed?: boolean; digits?: number } = {}): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const signed = o.signed ?? true;
  const sign = v > 0 ? (signed ? "+" : "") : v < 0 ? MINUS : "";
  const a = Math.abs(v);
  if (unit === "pct") {
    const d = o.digits ?? (a >= 100 ? 0 : a >= 10 ? 1 : 2);
    return `${sign}${a.toFixed(d)}%`;
  }
  const d = o.digits ?? (a >= 1000 ? 0 : a >= 100 ? 0 : 2);
  return `${sign}$${a.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}

/** Compact axis label: +12% / −$4.5K. */
export function fmtAxis(v: number, unit: Unit): string {
  if (Math.abs(v) < 1e-9) return unit === "pct" ? "0%" : "$0";
  const sign = v < 0 ? MINUS : "";
  const a = Math.abs(v);
  if (unit === "pct") return `${sign}${a >= 10 ? a.toFixed(0) : a >= 1 ? a.toFixed(1).replace(/\.0$/, "") : a.toFixed(2).replace(/0$/, "")}%`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1000) return `${sign}$${(a / 1000).toFixed(a >= 10_000 ? 0 : 1)}K`;
  return `${sign}$${a.toFixed(0)}`;
}

/** Contribution style: 4.21% / (2.77%) — accounting parentheses for negatives. */
export function fmtParen(v: number | null | undefined, unit: Unit): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const s = fmtV(Math.abs(v), unit, { signed: false });
  return v < 0 ? `(${s})` : s;
}

export function fmtShare(x: number | null | undefined, digits = 0): string {
  if (x == null || !Number.isFinite(x)) return "—";
  const s = Math.abs(x * 100).toFixed(digits);
  // A tiny negative share rounds to "-0%": show 0% then, and the typographic minus otherwise (as fmtV).
  return x < 0 && Number(s) !== 0 ? `${MINUS}${s}%` : `${s}%`;
}

export function fmtNum(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (a >= 10_000) return `${(n / 1000).toFixed(0)}K`;
  return Math.round(n).toLocaleString("ru-RU");
}

const DAY_FMT = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: "UTC" });
const DAY_LONG = new Intl.DateTimeFormat("ru-RU", { weekday: "short", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
export const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
export const MONTHS_LONG = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

export function fmtDay(ymd: string | null | undefined): string {
  if (!ymd) return "—";
  return DAY_FMT.format(new Date(`${ymd}T00:00:00Z`)).replace(".", "");
}
export function fmtDayLong(ymd: string): string {
  return DAY_LONG.format(new Date(`${ymd}T00:00:00Z`));
}
/** Calendar date of a day-of-year (1-based) in a year. */
export function dateOfDoy(year: number, doy: number): string {
  return new Date(Date.UTC(year, 0, doy)).toISOString().slice(0, 10);
}
