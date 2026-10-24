/**
 * Plateau / stagnation detector (roadmap R6) — pure, seeded, no I/O. lib/plateauStore.ts loads the series and saves
 * trader_progress_snapshots; the job academy.plateau-monthly runs it (monthly on the 1st trading day, refreshed weekly).
 * Only data up to the run date is used.
 *
 *   1. tenure = active (traded) days at the current ladder stage; below academy.plateau.minTenure → no verdict;
 *   2. lookback L = the last 250 active days at the stage; target pace π = the stage's net_pnl threshold ÷ its window
 *      (Джун 1500 / 40 = $37.5 a day; follows the criteria the owner edits);
 *   3. m = mean daily net over L with an 80% interval from a moving-block bootstrap (block 5); shrunk toward the desk
 *      prior of traders at the same stage and tenure bucket (P2) when there are ≥ 10 of them;
 *   4. p_impr = P(m_L − m_prevL > 0) by bootstrap (prevL = the 250 active days before L, or what exists if ≥ 40);
 *   5. PLATEAU ⇔ hi80(m) < π and (p_impr < 0.9 or undefined); severity by tenure: < 250 slow, 250–499 stuck, ≥ 500
 *      stuck_long;
 *   6. escalate when PLATEAU holds in 2 consecutive monthly runs, at most once per 30 trading days; admin escalation
 *      when stuck_long and 3 escalations passed with no curator intervention logged (R9);
 *   7. dip suppression: a method change in the last 30 trading days (an R9 intervention, a playbook change) suppresses
 *      escalation for 40 trading days from the change — learning curves dip before they rise.
 *
 * PLATEAU means «not at the sustainable pace yet», never «will not pass»; it is shown to staff only. P&L CUSUM is not
 * used for actions (it fires on noise and a size cut after it costs money).
 */
import { STATS_SEED, blockBootstrapMean, blockDiffProb, deskPrior, rngFor, shrink } from "./stats";

export type DayNet = { day: string; net: number };

export type TraderSeries = {
  trader: string;
  stage: string | null;
  /** First day at the current stage (YYYY-MM-DD); null = count every active day. */
  stageSince: string | null;
  /** Daily net $ of active days (any order; days after asOf are ignored). */
  days: readonly DayNet[];
};

export type Severity = "slow" | "stuck" | "stuck_long";
export type RunKind = "monthly" | "weekly";

export type PriorRun = { asOf: string; plateau: boolean; escalated: boolean };

export type PlateauContext = {
  asOf: string;
  kind: RunKind;
  /** academy.plateau.minTenure (active days). */
  minTenure: number;
  /** Target pace in $ per day of a stage (net_pnl threshold ÷ window); null when the stage has none. */
  paceOf: (stage: string | null) => number | null;
  /** Earlier MONTHLY snapshots per trader (any order; only as_of < asOf count). */
  priorRuns?: ReadonlyMap<string, readonly PriorRun[]>;
  /** Latest method change per trader (an R9 intervention by a person, a playbook change), YYYY-MM-DD. */
  methodChange?: ReadonlyMap<string, string>;
  /** Latest curator-authored intervention per trader (for the admin escalation). */
  lastIntervention?: ReadonlyMap<string, string>;
  seed?: number;
  B?: number;
};

export type PlateauResult = {
  trader: string;
  asOf: string;
  kind: RunKind;
  stage: string | null;
  tenure: number;
  /** Active days in the lookback. */
  nDays: number;
  pace: number | null;
  /** Raw mean daily net over L. */
  meanRaw: number | null;
  /** The mean the verdict uses (shrunk when a prior exists) and its 80% interval. */
  mean: number | null;
  lo80: number | null;
  hi80: number | null;
  pImpr: number | null;
  plateau: boolean;
  severity: Severity | null;
  escalated: boolean;
  adminEscalated: boolean;
  suppressedUntil: string | null;
  /** Σ net over L (for the diagnosis). */
  netL: number;
  shrunk: boolean;
};

export const PLATEAU = { lookback: 250, prevMin: 40, block: 5, pImpr: 0.9, escalateGapDays: 30, dipWindowDays: 30, dipSuppressDays: 40, adminAfter: 3, priorMinTraders: 10 } as const;

/** Severity by tenure (active days at the stage). */
export function severityOf(tenure: number): Severity {
  return tenure >= 500 ? "stuck_long" : tenure >= 250 ? "stuck" : "slow";
}

const tenureBucket = (t: number) => (t >= 500 ? "500+" : t >= 250 ? "250-499" : "lt250");

/** Weekdays strictly after `a` up to and including `b` (holidays not excluded); negative when b < a. */
export function weekdaysBetween(a: string, b: string): number {
  if (b < a) return -weekdaysBetween(b, a);
  const d = new Date(`${a}T12:00:00Z`);
  const end = new Date(`${b}T12:00:00Z`).getTime();
  let n = 0;
  while (d.getTime() < end) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) n++;
  }
  return n;
}

/** `n` weekdays after `a`. */
export function addWeekdays(a: string, n: number): string {
  const d = new Date(`${a}T12:00:00Z`);
  let k = 0;
  while (k < n) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) k++;
  }
  return d.toISOString().slice(0, 10);
}

type Raw = { s: TraderSeries; tenure: number; L: number[]; prev: number[]; boot: ReturnType<typeof blockBootstrapMean>; pImpr: number | null };

/** One run for every trader. Deterministic under the seed; never reads data after `asOf`. */
export function computePlateau(series: readonly TraderSeries[], ctx: PlateauContext): PlateauResult[] {
  const seed = ctx.seed ?? STATS_SEED;
  const B = ctx.B ?? 1000;
  const raws: Raw[] = [];
  for (const s of [...series].sort((a, b) => a.trader.localeCompare(b.trader))) {
    const atStage = s.days
      .filter((d) => d.day <= ctx.asOf && (!s.stageSince || d.day >= s.stageSince))
      .sort((a, b) => a.day.localeCompare(b.day));
    const nets = atStage.map((d) => d.net);
    const L = nets.slice(-PLATEAU.lookback);
    const prev = nets.slice(-2 * PLATEAU.lookback, -PLATEAU.lookback);
    const boot = L.length ? blockBootstrapMean(L, rngFor(seed, s.trader, "L", ctx.asOf), { B, block: PLATEAU.block }) : null;
    const pImpr = prev.length >= PLATEAU.prevMin ? blockDiffProb(L, prev, rngFor(seed, s.trader, "impr", ctx.asOf), { B, block: PLATEAU.block }) : null;
    raws.push({ s, tenure: atStage.length, L, prev, boot, pImpr });
  }

  // Desk prior per (stage, tenure bucket) over traders past the minimum tenure.
  const groups = new Map<string, Raw[]>();
  for (const r of raws) {
    if (r.tenure < ctx.minTenure || !r.boot) continue;
    const k = `${r.s.stage ?? ""}|${tenureBucket(r.tenure)}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }

  return raws.map((r): PlateauResult => {
    const { s, tenure } = r;
    const pace = ctx.paceOf(s.stage);
    const netL = r.L.reduce((a, v) => a + v, 0);
    const base = {
      trader: s.trader, asOf: ctx.asOf, kind: ctx.kind, stage: s.stage, tenure, nDays: r.L.length, pace,
      pImpr: r.pImpr, netL: Math.round(netL * 100) / 100,
    };
    if (tenure < ctx.minTenure || !r.boot || pace == null) {
      return { ...base, meanRaw: r.boot?.mean ?? null, mean: null, lo80: null, hi80: null, plateau: false, severity: null, escalated: false, adminEscalated: false, suppressedUntil: null, shrunk: false };
    }
    let mean = r.boot.mean;
    let lo80 = r.boot.lo80;
    let hi80 = r.boot.hi80;
    let shrunk = false;
    const peers = groups.get(`${s.stage ?? ""}|${tenureBucket(tenure)}`) ?? [];
    if (peers.length >= PLATEAU.priorMinTraders) {
      const prior = deskPrior(peers.map((p) => ({ xbar: p.boot!.mean, se: p.boot!.se, n: p.L.length })), {
        minN: PLATEAU.prevMin, minUnits: PLATEAU.priorMinTraders, tauMin: 1, fallbackMu: 0, fallbackTau: 0,
      });
      if (prior.method === "moments") {
        const post = shrink(r.boot.mean, r.boot.se, prior);
        mean = post.theta;
        lo80 = post.lo80;
        hi80 = post.hi80;
        shrunk = true;
      }
    }
    const plateau = hi80 < pace && (r.pImpr == null || r.pImpr < PLATEAU.pImpr);
    const severity = plateau ? severityOf(tenure) : null;

    // Dip suppression: a method change in the last 30 trading days → no escalation for 40 trading days from it.
    const change = ctx.methodChange?.get(s.trader) ?? null;
    let suppressedUntil: string | null = null;
    if (change && change <= ctx.asOf && weekdaysBetween(change, ctx.asOf) <= PLATEAU.dipWindowDays) {
      suppressedUntil = addWeekdays(change, PLATEAU.dipSuppressDays);
    }
    const priors = [...(ctx.priorRuns?.get(s.trader) ?? [])].filter((p) => p.asOf < ctx.asOf).sort((a, b) => b.asOf.localeCompare(a.asOf));
    const lastEscalation = priors.find((p) => p.escalated)?.asOf ?? null;
    const recentlyEscalated = lastEscalation != null && weekdaysBetween(lastEscalation, ctx.asOf) < PLATEAU.escalateGapDays;
    // «2 consecutive monthly runs»: the previous monthly run is at most ~2 months old and was a plateau too.
    const prevMonthly = priors[0] && weekdaysBetween(priors[0].asOf, ctx.asOf) <= 2 * 23 ? priors[0] : null;
    const escalated = ctx.kind === "monthly" && plateau && prevMonthly?.plateau === true && !recentlyEscalated && !(suppressedUntil && ctx.asOf < suppressedUntil);

    // Admin: stuck_long and ≥ 3 escalations (this one included) since the last curator intervention.
    const lastIntervention = ctx.lastIntervention?.get(s.trader) ?? "";
    const escalationsSince = priors.filter((p) => p.escalated && p.asOf > lastIntervention).length + (escalated ? 1 : 0);
    const adminEscalated = escalated && severity === "stuck_long" && escalationsSince >= PLATEAU.adminAfter;

    return { ...base, meanRaw: r.boot.mean, mean, lo80, hi80, plateau, severity, escalated, adminEscalated, suppressedUntil, shrunk };
  });
}

/** Run kind of a weekday run: the 1st weekday of a month → monthly, a Monday → weekly, otherwise none. Pure. */
export function runKindOn(date: string, holidays: ReadonlySet<string> = new Set()): RunKind | null {
  const d = new Date(`${date}T12:00:00Z`);
  const wd = d.getUTCDay();
  if (wd === 0 || wd === 6 || holidays.has(date)) return null;
  // first trading day of the month: no earlier weekday (non-holiday) in this month
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 12));
  let isFirst = true;
  for (const x = first; x.getTime() < d.getTime(); x.setUTCDate(x.getUTCDate() + 1)) {
    const w = x.getUTCDay();
    if (w !== 0 && w !== 6 && !holidays.has(x.toISOString().slice(0, 10))) { isFirst = false; break; }
  }
  if (isFirst) return "monthly";
  return wd === 1 ? "weekly" : null;
}

/** The first trading day (a weekday that is not a listed holiday) of the month `monthsBack` months before `date`. Pure. */
export function firstTradingDayOfMonth(date: string, monthsBack = 0, holidays: ReadonlySet<string> = new Set()): string {
  const d = new Date(`${date}T12:00:00Z`);
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - monthsBack, 1, 12));
  for (;;) {
    const w = x.getUTCDay();
    const iso = x.toISOString().slice(0, 10);
    if (w !== 0 && w !== 6 && !holidays.has(iso)) return iso;
    x.setUTCDate(x.getUTCDate() + 1);
  }
}
