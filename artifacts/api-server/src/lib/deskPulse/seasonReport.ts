/**
 * «Автоотчёт за сезон» (pure; tests in __tests__/seasonReport.test.ts) — the season level of the weekly review: one
 * trader's PropReports trades of a season or period, summed up so the trader only writes the conclusions.
 *
 *   seasonOfDay(day, startDay)  the earnings season a day belongs to: from season.primeStartDay of January / April /
 *                               July / October to the day before the next one (the desk's own season calendar)
 *   seasonReport(input)         totals (the shared $ math — lib/playbookEdge computeUsdStats → lib/coreMetrics), the
 *                               playbook setup × timing rows with the robust edge (net without the top 3, «outliers»;
 *                               judged from pulse.reportMinTrades), by timing, the best / worst three trades, where the
 *                               money was by desk setup family, the re-entry and give-back totals of the session flow
 *                               and the idea-tier breakdown of the plan marks
 * Every number is derived from trades and plan marks; the only manual input is the conclusions (saved to Playbook).
 */
import { computeUsdStats, type UsdStats } from "../playbookEdge";
import { dayGiveback, entryNumbers, greenToRed, robustEdge, type GivebackCfg, type GreenToRedCfg } from "../sessionFlow/flow";
import { groupBy } from "../sessionFlow/load";
import { tierStats, type BandRow, type IdeaMark, type TierRow } from "../sessionFlow/ideas";
import { TIMINGS, timingOf, type Timing } from "../sessionFlow/timing";
import type { FlowTrade } from "../sessionFlow/types";
import { FAMILIES, type Family } from "./family";

// ─── the season of a day ──────────────────────────────────────────────────────────────────────────────────────────

const QUARTER_MONTHS = [1, 4, 7, 10] as const;
const ymd = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
const prevDay = (day: string) => new Date(Date.parse(`${day}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

export type Season = { key: string; from: string; to: string };

/** The season (key «2026-Q4») holding `day`: [start of its quarter's season, the day before the next one]. */
export function seasonOfDay(day: string, startDay: number): Season {
  const y = Number(day.slice(0, 4));
  const d = Math.max(1, Math.min(28, Math.round(startDay)));
  const starts = [...QUARTER_MONTHS.map((m) => ({ y: y - 1, m })), ...QUARTER_MONTHS.map((m) => ({ y, m })), { y: y + 1, m: 1 }]
    .map((s) => ({ ...s, day: ymd(s.y, s.m, d) }));
  let i = starts.length - 2;
  while (i > 0 && starts[i]!.day > day) i--;
  const s = starts[i]!;
  return { key: `${s.y}-Q${QUARTER_MONTHS.indexOf(s.m as 1) + 1}`, from: s.day, to: prevDay(starts[i + 1]!.day) };
}

/** The season before `s`. */
export const previousSeason = (s: Season, startDay: number): Season => seasonOfDay(prevDay(s.from), startDay);

// ─── the report ───────────────────────────────────────────────────────────────────────────────────────────────────

export type RowStats = UsdStats & { netExTop3: number | null; outliers: boolean; judged: boolean };
export type SetupTimingRow = RowStats & { setupId: number | null; setup: string | null; timing: Timing | null };
export type TimingRow = RowStats & { timing: Timing | null };
export type FamilyRow = RowStats & { family: Family };
export type TradeLine = { id: number; day: string; ticker: string; side: "long" | "short" | null; setup: string | null; timing: Timing | null; net: number };

export type SeasonReportInput = {
  trades: readonly FlowTrade[];
  families: ReadonlyMap<number, Family | null>;
  marks: readonly IdeaMark[];
  dailyLimit: number | null;
  minTrades: number;
  giveback: GivebackCfg;
  greenToRed: GreenToRedCfg;
};

export type SeasonReport = {
  totals: UsdStats & { days: number; netExTop3: number | null; outliers: boolean };
  rows: SetupTimingRow[];
  timings: TimingRow[];
  best: TradeLine[];
  worst: TradeLine[];
  families: FamilyRow[];
  flow: {
    /** Re-entries: every trade that was the 2nd+ entry in its ticker and side that day. */
    reentry: UsdStats;
    /** Days whose give-back from the peak passed the desk threshold, and the $ given back on them. */
    giveback: { days: number; total: number };
    /** Days where the size / pace went up after the day turned red. */
    greenToRedDays: number;
  };
  tiers: { tiers: TierRow[]; authored: UsdStats; bands: BandRow[]; marked: number };
};

const TOP = 3;

function rowOf<T extends object>(key: T, list: readonly FlowTrade[], minTrades: number): T & RowStats {
  const st = computeUsdStats([...list]);
  const nets = list.map((t) => computeUsdStats([t]).net).filter((v): v is number => v != null);
  const rob = robustEdge(nets);
  return { ...key, ...st, netExTop3: st.n ? rob.netExTop3 : null, outliers: st.n ? rob.outliers : false, judged: st.n >= minTrades };
}

const byNet = (a: { net: number | null }, b: { net: number | null }) => (b.net ?? 0) - (a.net ?? 0);

export function seasonReport(x: SeasonReportInput): SeasonReport {
  const closed = x.trades.filter((t) => t.result !== "open" && computeUsdStats([t]).n > 0);
  const totals = computeUsdStats([...closed]);
  const totRob = robustEdge(closed.map((t) => computeUsdStats([t]).net!));

  const bySt = groupBy(closed, (t) => `${t.setupId ?? ""}|${timingOf(t) ?? ""}`);
  const rows = [...bySt.values()].map((l) => rowOf({ setupId: l[0]!.setupId, setup: l[0]!.setupName, timing: timingOf(l[0]!) }, l, x.minTrades)).sort(byNet);
  const byT = groupBy(closed, (t) => timingOf(t) ?? "");
  const timings = [...TIMINGS, null].filter((k) => byT.has(k ?? "")).map((k) => rowOf({ timing: k }, byT.get(k ?? "")!, x.minTrades));
  const byF = groupBy(closed.filter((t) => x.families.get(t.id)), (t) => x.families.get(t.id)!);
  const families = FAMILIES.filter((f) => byF.has(f)).map((f) => rowOf({ family: f }, byF.get(f)!, x.minTrades)).sort(byNet);

  const lines = closed.map((t): TradeLine => ({ id: t.id, day: t.day, ticker: t.ticker.toUpperCase(), side: t.side, setup: t.setupName, timing: timingOf(t), net: computeUsdStats([t]).net! }));
  const sorted = [...lines].sort((a, b) => b.net - a.net || a.id - b.id);
  const best = sorted.filter((l) => l.net > 0).slice(0, TOP);
  const worst = [...sorted].reverse().filter((l) => l.net < 0).slice(0, TOP);

  const nums = entryNumbers(x.trades);
  const reentry = computeUsdStats(closed.filter((t) => (nums.get(t.id) ?? 1) >= 2));
  let gbDays = 0, gbTotal = 0, g2r = 0;
  const days = groupBy(x.trades, (t) => t.day);
  for (const list of days.values()) {
    const g = dayGiveback(list, x.dailyLimit, x.giveback);
    if (g?.flagged) { gbDays++; gbTotal += g.giveback; }
    if (greenToRed(list, x.greenToRed)?.material) g2r++;
  }
  const tiers = tierStats(closed, x.marks);

  return {
    totals: { ...totals, days: new Set(closed.map((t) => t.day)).size, netExTop3: totals.n ? totRob.netExTop3 : null, outliers: totals.n ? totRob.outliers : false },
    rows, timings, best, worst, families,
    flow: { reentry, giveback: { days: gbDays, total: Math.round(gbTotal * 100) / 100 }, greenToRedDays: g2r },
    tiers: { ...tiers, marked: x.marks.length },
  };
}
