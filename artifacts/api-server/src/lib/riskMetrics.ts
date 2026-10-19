/**
 * Pure risk-desk metrics (no DB): red-day stop state machine, per-trader usage, equity / drawdown.
 * Used by routes/risk.ts (and through it the curator cockpit). Texts: server `risk` namespace.
 *
 * Drawdown baseline: a curator's «Разбор нарушения» of a drawdown breach resets the peak — the drawdown is counted
 * from the trader's equity at the end of the review day (`ddSince`). Without a review the peak is lifetime, so a
 * drawdown halt stays until the curator decides.
 */
import { addDays } from "./tradingDate";
import { type Lang } from "../i18n";
import { riskT } from "../i18n/ns";
import { fmtMoney } from "./notifyEventsCore";

export const WARN_PCT = 70;

/** Monday of the week containing ymd. */
export function weekStart(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  const dow = d.getUTCDay(); // 0 = Sun
  return addDays(ymd, dow === 0 ? -6 : 1 - dow);
}

export const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
export const round2 = (x: number) => Math.round(x * 100) / 100;

export type Limits = {
  trader: string;
  accountSize: number | null;
  dailyLossLimit: number | null;
  weeklyLossLimit: number | null;
  maxDrawdown: number | null;
  maxRiskPerTrade: number | null;
  maxPositionUsd: number | null;
  maxOvernightExposure: number | null;
  maxOpenPositions: number | null;
  allowOvernight: boolean;
  allowSwing: boolean;
  tier: string | null;
  notes: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
};

export type PnlSource = "propreports" | "journal" | null;
export type DayRow = {
  trader: string;
  date: string;
  /** Net P&L for the day from the resolved source (null when no $ data). */
  pnl: number | null;
  source: PnlSource;
  trades: number;
  brokerTrades: number;
  r: number;
  fees: number;
};

export type Horizon = "intraday" | "overnight" | "swing";
export type Position = {
  id: number;
  ticker: string;
  date: string;
  side: string | null;
  setup: string | null;
  trader: string;
  horizon: Horizon;
  qty: number | null;
  entry: number | null;
  stop: number | null;
  daysHeld: number;
  riskUsd: number | null;
  riskSource: "planned" | "stop" | null;
  /** Planned risk_usd disagrees with |entry−stop|×qty by >25% — the trader's stop moved or the plan is stale. */
  riskMismatch: boolean;
  plannedRiskUsd: number | null;
  stopRiskUsd: number | null;
  exposureUsd: number | null;
  /** Carried past its entry day (or explicitly overnight/swing) ⇒ gap risk. */
  carried: boolean;
  /** Will be in the overnight book tonight: carried, or still open after 15:45 ET today. */
  carriedTonight: boolean;
  /** result IS NULL and no exit — shown in the book with a "без статуса" flag. */
  noStatus: boolean;
  source: "propreports" | "manual";
  sector: string | null;
  /** 14-day ATR from ticker_data_cache (may be stale; the client refreshes it from quotes). */
  atr: number | null;
};

// ─── metrics ────────────────────────────────────────────────────────────────

export type Alert = {
  kind: "daily" | "weekly" | "drawdown" | "overnight" | "positions" | "trade_risk" | "position_size" | "overnight_not_allowed" | "swing_not_allowed";
  label: string;
  level: "warn" | "breach";
  used: number;
  limit: number | null;
  pct: number | null;
  detail?: string;
  tradeId?: number;
};

export function pctOf(used: number, limit: number | null): number | null {
  if (limit == null || limit < 0) return null;
  if (limit === 0) return used > 0 ? 100 : 0; // explicit zero limit: anything is a breach
  return Math.round((used / limit) * 1000) / 10;
}

export type StopState = "ok" | "warn" | "stop" | "weekly" | "drawdown" | "no_limits";
export type Stop = {
  state: StopState;
  label: string;
  /** Russian one-liner with exact numbers, e.g. «осталось $120 до дневного стопа». */
  message: string;
  halted: boolean;
  dailyRemainingUsd: number | null;
  weeklyRemainingUsd: number | null;
  drawdownRemainingUsd: number | null;
  dailyPct: number | null;
  weeklyPct: number | null;
  drawdownPct: number | null;
};

/** Stop / breach texts: the app money format ("$318.76", "$300"), the same as lib/notifyEventsCore fmtMoney. */
const usd0 = (v: number) => fmtMoney(v);

/**
 * Pure red-day stop state machine (exported for the offline check).
 * Priority: max drawdown ≥100% → weekly ≥100% → daily ≥100% (stop) → any ≥70% (warn) → ok.
 */
export function computeStop(args: { todayLoss: number; weekLoss: number; currentDd: number; limits: Limits | null }, lang: Lang = "ru"): Stop {
  const { todayLoss, weekLoss, currentDd, limits: L } = args;
  const t = riskT.tFor(lang);
  const dailyPct = pctOf(todayLoss, L?.dailyLossLimit ?? null);
  const weeklyPct = pctOf(weekLoss, L?.weeklyLossLimit ?? null);
  const drawdownPct = pctOf(currentDd, L?.maxDrawdown ?? null);
  const rem = (limit: number | null | undefined, used: number) => (limit == null ? null : round2(Math.max(0, limit - used)));
  const base = {
    dailyRemainingUsd: rem(L?.dailyLossLimit, todayLoss),
    weeklyRemainingUsd: rem(L?.weeklyLossLimit, weekLoss),
    drawdownRemainingUsd: rem(L?.maxDrawdown, currentDd),
    dailyPct,
    weeklyPct,
    drawdownPct,
  };
  if (!L || (L.dailyLossLimit == null && L.weeklyLossLimit == null && L.maxDrawdown == null)) {
    return { ...base, state: "no_limits", label: t("stop.no_limits.label"), message: t("stop.no_limits.message"), halted: false };
  }
  if (drawdownPct != null && drawdownPct >= 100) {
    return { ...base, state: "drawdown", label: t("stop.drawdown.label"), halted: true,
      message: t("stop.drawdown.message", { used: usd0(currentDd), limit: usd0(L.maxDrawdown!) }) };
  }
  if (weeklyPct != null && weeklyPct >= 100) {
    return { ...base, state: "weekly", label: t("stop.weekly.label"), halted: true,
      message: t("stop.weekly.message", { used: usd0(weekLoss), limit: usd0(L.weeklyLossLimit!) }) };
  }
  if (dailyPct != null && dailyPct >= 100) {
    return { ...base, state: "stop", label: t("stop.stop.label"), halted: true,
      message: t("stop.stop.message", { used: usd0(todayLoss), limit: usd0(L.dailyLossLimit!) }) };
  }
  const worst = Math.max(dailyPct ?? -1, weeklyPct ?? -1, drawdownPct ?? -1);
  if (worst >= WARN_PCT) {
    const parts: string[] = [];
    if (dailyPct != null && dailyPct >= WARN_PCT) parts.push(t("stop.warn.daily", { left: usd0(base.dailyRemainingUsd ?? 0), pct: Math.round(dailyPct) }));
    if (weeklyPct != null && weeklyPct >= WARN_PCT) parts.push(t("stop.warn.weekly", { left: usd0(base.weeklyRemainingUsd ?? 0), pct: Math.round(weeklyPct) }));
    if (drawdownPct != null && drawdownPct >= WARN_PCT) parts.push(t("stop.warn.drawdown", { left: usd0(base.drawdownRemainingUsd ?? 0), pct: Math.round(drawdownPct) }));
    const msg = parts.join("; ");
    return { ...base, state: "warn", label: t("stop.warn.label"), halted: false, message: msg.charAt(0).toUpperCase() + msg.slice(1) + "." };
  }
  const msg = base.dailyRemainingUsd != null
    ? dailyPct != null
      ? t("stop.ok.dailyPct", { left: usd0(base.dailyRemainingUsd), pct: Math.round(dailyPct) })
      : t("stop.ok.daily", { left: usd0(base.dailyRemainingUsd) })
    : base.weeklyRemainingUsd != null
      ? t("stop.ok.weekly", { left: usd0(base.weeklyRemainingUsd) })
      : t("stop.ok.drawdown", { left: usd0(base.drawdownRemainingUsd ?? 0) });
  return { ...base, state: "ok", label: t("stop.ok.label"), halted: false, message: msg };
}

/**
 * The drawdown baseline in effect on `today`: the latest curator review day of a drawdown breach that is not after
 * `today` (a back-test with ?date= ignores later reviews), else null (lifetime peak).
 */
export function drawdownSince(reviewDays: readonly string[] | undefined, today: string): string | null {
  let best: string | null = null;
  for (const d of reviewDays ?? []) if (d <= today && (best == null || d > best)) best = d;
  return best;
}

/** Running peak: on and before the baseline day the peak follows equity (reset), after it the usual high-water mark. */
export function nextPeak(peak: number, cum: number, date: string, since: string | null): number {
  return since != null && date <= since ? cum : Math.max(peak, cum);
}

/**
 * Pure (exported for the offline check). `ddSince` = drawdown baseline day (see drawdownSince): the peak resets to the
 * equity at the end of that day, so a reviewed drawdown halt lifts until a new drawdown ≥ the limit builds up.
 */
export function computeMetrics(trader: string, days: DayRow[], positions: Position[], limits: Limits | null, today: string, lang: Lang = "ru", ddSince: string | null = null) {
  const ws = weekStart(today);
  const todayRow = days.find((d) => d.date === today);
  const weekRows = days.filter((d) => d.date >= ws && d.date <= today);
  const weekPnlRows = weekRows.filter((d) => d.pnl != null);

  // equity / drawdown on days that have $ data
  const since = ddSince != null && ddSince <= today ? ddSince : null;
  let cum = 0;
  let peak = 0;
  let lifePeak = 0;
  let maxDd = 0;
  let cumR = 0;
  let peakR = 0;
  for (const d of days) {
    cumR += d.r;
    peakR = nextPeak(peakR, cumR, d.date, since);
    if (d.pnl == null) continue;
    cum += d.pnl;
    peak = nextPeak(peak, cum, d.date, since);
    if (cum > lifePeak) lifePeak = cum;
    if (lifePeak - cum > maxDd) maxDd = lifePeak - cum;
  }
  const hasPnl = days.some((d) => d.pnl != null);
  const currentDd = hasPnl ? round2(peak - cum) : 0;

  // red-day streak (most recent days with $ data; falls back to R when no $)
  let redStreak = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    const v = hasPnl ? days[i].pnl : days[i].r;
    if (v == null) continue;
    if (v < 0) redStreak++;
    else break;
  }

  const openRisk = positions.reduce((s, p) => s + (p.riskUsd ?? 0), 0);
  const carried = positions.filter((p) => p.carried);
  const tonight = positions.filter((p) => p.carriedTonight);
  const overnightExposure = tonight.reduce((s, p) => s + (p.exposureUsd ?? 0), 0);
  const grossExposure = positions.reduce((s, p) => s + (p.exposureUsd ?? 0), 0);

  const todayPnl = todayRow?.pnl ?? null;
  const weekPnl = weekPnlRows.length ? round2(weekPnlRows.reduce((s, d) => s + (d.pnl ?? 0), 0)) : null;
  const todayLoss = Math.max(0, -(todayPnl ?? 0));
  const weekLoss = Math.max(0, -(weekPnl ?? 0));

  const L = limits;
  const stop = computeStop({ todayLoss, weekLoss, currentDd, limits: L }, lang);
  const AL = riskT.tFor(lang);
  const dailyRemaining = stop.dailyRemainingUsd;

  const alerts: Alert[] = [];
  const check = (kind: Alert["kind"], label: string, used: number, limit: number | null, detail?: string, tradeId?: number) => {
    const pct = pctOf(used, limit);
    if (pct == null) return;
    if (pct >= 100) alerts.push({ kind, label, level: "breach", used: round2(used), limit, pct, detail, tradeId });
    else if (pct >= WARN_PCT) alerts.push({ kind, label, level: "warn", used: round2(used), limit, pct, detail, tradeId });
  };
  if (L) {
    check("daily", AL("alerts.daily"), todayLoss, L.dailyLossLimit);
    check("weekly", AL("alerts.weekly"), weekLoss, L.weeklyLossLimit);
    check("drawdown", AL("alerts.drawdown"), currentDd, L.maxDrawdown);
    check("overnight", AL("alerts.overnight"), overnightExposure, L.maxOvernightExposure);
    check("positions", AL("alerts.positions"), positions.length, L.maxOpenPositions);
    const worstRisk = positions.reduce<Position | null>((w, p) => ((p.riskUsd ?? 0) > (w?.riskUsd ?? 0) ? p : w), null);
    if (worstRisk?.riskUsd != null) check("trade_risk", AL("alerts.trade_risk"), worstRisk.riskUsd, L.maxRiskPerTrade, worstRisk.ticker, worstRisk.id);
    const worstSize = positions.reduce<Position | null>((w, p) => ((p.exposureUsd ?? 0) > (w?.exposureUsd ?? 0) ? p : w), null);
    if (worstSize?.exposureUsd != null) check("position_size", AL("alerts.position_size"), worstSize.exposureUsd, L.maxPositionUsd, worstSize.ticker, worstSize.id);
    const on = positions.filter((p) => p.horizon === "overnight" || (p.horizon === "intraday" && p.carriedTonight));
    if (!L.allowOvernight && on.length) {
      alerts.push({ kind: "overnight_not_allowed", label: AL("alerts.overnight_not_allowed"), level: "breach", used: on.length, limit: 0, pct: null, detail: on.map((p) => p.ticker).join(", "), tradeId: on[0].id });
    }
    const sw = positions.filter((p) => p.horizon === "swing");
    if (!L.allowSwing && sw.length) {
      alerts.push({ kind: "swing_not_allowed", label: AL("alerts.swing_not_allowed"), level: "breach", used: sw.length, limit: 0, pct: null, detail: sw.map((p) => p.ticker).join(", "), tradeId: sw[0].id });
    }
  }
  alerts.sort((a, b) => (a.level === b.level ? (b.pct ?? 999) - (a.pct ?? 999) : a.level === "breach" ? -1 : 1));
  const status: "ok" | "warn" | "breach" | "no_limits" = !L
    ? "no_limits"
    : alerts.some((a) => a.level === "breach")
      ? "breach"
      : alerts.length
        ? "warn"
        : "ok";

  const weekSources = new Set(weekPnlRows.map((d) => d.source).filter(Boolean));
  const histBroker = days.filter((d) => d.source === "propreports").length;
  const histJournal = days.filter((d) => d.source === "journal").length;

  return {
    trader,
    status,
    stop,
    halted: stop.halted,
    alerts,
    breaches: alerts.filter((a) => a.level === "breach"),
    sources: {
      today: (todayRow?.source ?? null) as PnlSource,
      week: (weekSources.size === 0 ? null : weekSources.size === 1 ? [...weekSources][0] : "mixed") as PnlSource | "mixed",
      history: { propreports: histBroker, journal: histJournal },
    },
    today: {
      date: today,
      pnlNet: todayPnl == null ? null : round2(todayPnl),
      source: (todayRow?.source ?? null) as PnlSource,
      fees: round2(todayRow?.fees ?? 0),
      r: round2(todayRow?.r ?? 0),
      trades: todayRow?.trades ?? 0,
      brokerTrades: todayRow?.brokerTrades ?? 0,
      openPositions: positions.length,
      carriedPositions: carried.length,
      carriedTonight: tonight.length,
      openRiskUsd: round2(openRisk),
      overnightExposureUsd: round2(overnightExposure),
      grossExposureUsd: round2(grossExposure),
      dailyLimitUsedPct: pctOf(todayLoss, L?.dailyLossLimit ?? null),
      dailyRemainingUsd: dailyRemaining,
      /** Remaining daily room if every open stop is hit. */
      dailyRemainingAfterOpenRiskUsd: dailyRemaining == null ? null : round2(dailyRemaining - openRisk),
    },
    week: {
      from: ws,
      pnlNet: weekPnl,
      r: round2(weekRows.reduce((s, d) => s + d.r, 0)),
      trades: weekRows.reduce((s, d) => s + d.trades, 0),
      limitUsedPct: pctOf(weekLoss, L?.weeklyLossLimit ?? null),
      remainingUsd: stop.weeklyRemainingUsd,
    },
    drawdown: {
      hasPnl,
      equityNet: hasPnl ? round2(cum) : null,
      peakNet: hasPnl ? round2(peak) : null,
      currentUsd: currentDd,
      maxUsd: round2(maxDd),
      currentPct: L?.accountSize ? Math.round((currentDd / (L.accountSize + peak)) * 1000) / 10 : null,
      limitUsedPct: pctOf(currentDd, L?.maxDrawdown ?? null),
      remainingUsd: stop.drawdownRemainingUsd,
      cumR: round2(cumR),
      currentR: round2(peakR - cumR),
      /** Drawdown counted from this day's close (a curator review of a drawdown breach); null = lifetime peak. */
      since,
      redDayStreak: redStreak,
    },
  };
}
export type Metrics = ReturnType<typeof computeMetrics>;
