/**
 * «Цена джуна до безубытка» — GET /api/junior-cost/trader?trader= (own path, or staff) and GET /api/junior-cost/desk
 * (staff). Types mirror api lib/juniorCost/{path,cohorts,attribution,desk}.ts; definitions live in path.ts there.
 * The answers carry codes and numbers only (no text), so a language switch does not refetch them.
 */
import { queryOptions } from "@tanstack/react-query";
import { http } from "@/lib/api/http";
import { STALE } from "@/lib/api/keys";

export const JUNIOR_COST_DOMAIN = "junior-cost";

export type JuniorStatus = "reached" | "provisional" | "below" | "stopped" | "insufficient";
export type Interval = { point: number; lo: number; hi: number };

export type Projection =
  | { kind: "eta"; window: number; meanNet: Interval; days: { point: number; lo: number; hi: number | null }; eta: { from: string; point: string; to: string | null } }
  | { kind: "notImproving"; window: number; meanNet: Interval }
  | { kind: "insufficient"; window: number };

export type JuniorCost = { trading: number; fees: number; gross: number; seat: number; total: number; months: number };

export type PathBase = {
  name: string;
  start: string | null;
  startSource: "academy" | "trade" | null;
  firstTrade: string | null;
  lastTrade: string | null;
  status: JuniorStatus;
  truncated: boolean;
  activeDays: number;
  breakeven: { day: string; confirmedOn: string; calendarDays: number; tradingDays: number; activeDays: number } | null;
  provisionalDays: number;
  stableDays: number;
  relapsed: boolean;
  trough: { day: string; cum: number; fees: number; gross: number } | null;
  cost: JuniorCost;
  current: number;
  feesToDate: number;
  tenureTradingDays: number;
  projection: Projection | null;
};

export type CurvePoint = { day: string; net: number; cum: number };
export type JuniorPath = PathBase & { curve: CurvePoint[] };

export type Settings = { seatUsdMonth: number; stableDays: number };
export type DeskBenchmark = { medianCost: number | null; medianDays: number | null; reached: number; juniors: number };

export type TraderJuniorCost = { trader: string; settings: Settings; path: JuniorPath; desk: DeskBenchmark | null };

export type GroupBy = "cohort" | "month" | "curator";
export type GroupKeys = Record<GroupBy, string | null>;
export type Money = { total: number; fees: number; gross: number; seat: number; reached: number; onTheWay: number; stopped: number };
export type CohortRow = {
  key: string | null;
  juniors: number;
  reached: number;
  onTheWay: number;
  stopped: number;
  reachedShare: number;
  medianCost: number | null;
  medianDays: number | null;
  medianCalendarDays: number | null;
  maxTenure: number;
  money: Money;
};

export type FactorKey = "trainer" | "exams" | "oneOnOne" | "plans";
export type FactorStatus = "reliable" | "hypothesis" | "low";
export type GroupStat = { juniors: number; reached: number; reachedShare: number; medianCost: number | null; medianDays: number | null };
export type FactorResult = {
  factor: FactorKey;
  threshold: number;
  yes: GroupStat;
  no: GroupStat;
  excluded: number;
  costDiff: Interval | null;
  daysDiff: Interval | null;
  q: number | null;
  status: FactorStatus;
  verdict: "pays" | "costs" | "unclear";
};

export type JuniorRow = PathBase & { keys: GroupKeys };

export type DeskJuniorCost = {
  asOf: string;
  settings: Settings;
  deskFirstDay: string | null;
  counts: { juniors: number; countable: number; truncated: number };
  juniors: JuniorRow[];
  cohorts: Record<GroupBy, { desk: CohortRow; rows: CohortRow[] }>;
  attribution: FactorResult[];
};

/** Mirrors api lib/juniorCost: STOP_DAYS_DEFAULT, EXPOSURE_DAYS, PROJ_MIN_DAYS (for the method texts). */
export const STOP_DAYS = 30;
export const EXPOSURE_DAYS = 60;

export const traderJuniorCostQuery = (trader: string | null) =>
  queryOptions({
    queryKey: [JUNIOR_COST_DOMAIN, "trader", trader] as const,
    queryFn: ({ signal }) => http.get<TraderJuniorCost>("/api/junior-cost/trader", { query: trader ? { trader } : {}, signal }),
    staleTime: STALE.long,
    meta: { i18n: false },
  });

export const deskJuniorCostQuery = () =>
  queryOptions({
    queryKey: [JUNIOR_COST_DOMAIN, "desk"] as const,
    queryFn: ({ signal }) => http.get<DeskJuniorCost>("/api/junior-cost/desk", { signal }),
    staleTime: STALE.long,
    meta: { i18n: false },
  });
