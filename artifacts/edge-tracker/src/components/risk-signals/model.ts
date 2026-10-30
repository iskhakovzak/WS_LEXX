/**
 * Live risk signals — client model (pure; unit-tested in model.test.ts). Shapes mirror the API
 * (artifacts/api-server/src/routes/risk-signals.ts, lib/riskSignals/types.ts).
 */
export type Signal = "stop_proximity" | "loss_streak" | "revenge" | "off_plan" | "banned_window";
export type Severity = "warn" | "critical";

export type RiskAlert = {
  id: number;
  trader: string;
  day: string;
  signal: Signal;
  level: string;
  severity: Severity;
  tradeId: number | null;
  triggeredAt: string;
  detectedAt: string;
  stats: Record<string, number | string | null>;
  staffNotified: boolean;
  seenAt: string | null;
  settled: boolean;
  restNet: number | null;
  baselineRest: number | null;
  baselineN: number | null;
  saved: number | null;
};

export type AlertsDay = { day: string; now: string; enabled: boolean; alerts: RiskAlert[]; trader?: string };

export type SavedTotals = { alerts: number; settled: number; estimated: number; hidden: number; saved: number | null; cases: number };
export type SavedPeriod = "day" | "week" | "month";
export type SavedSummary = SavedTotals & {
  period: SavedPeriod;
  from: string;
  to: string;
  minSample: number;
  bySignal: Array<{ signal: Signal } & SavedTotals>;
};

/** The strip polls this often while the page is visible in desk hours (the sync is near-live). */
export const LIVE_POLL_MS = 5_000;
/** Desk hours, New York minutes: 08:00 (premarket entries) to 16:15. */
const DESK_FROM = 8 * 60;
const DESK_TO = 16 * 60 + 15;

const nyParts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" });

/** Weekday 08:00–16:15 New York (holidays are cheap to poll: the server answers an empty list). */
export function inDeskHours(now: Date = new Date()): boolean {
  const parts = Object.fromEntries(nyParts.formatToParts(now).map((p) => [p.type, p.value]));
  if (parts.weekday === "Sat" || parts.weekday === "Sun") return false;
  const m = (Number(parts.hour) % 24) * 60 + Number(parts.minute);
  return m >= DESK_FROM && m <= DESK_TO;
}

/** refetchInterval: fast in desk hours, off outside them (TanStack Query never polls a hidden tab by default). */
export const livePollInterval = (now: Date = new Date()): number | false => (inDeskHours(now) ? LIVE_POLL_MS : false);

/** The strip: unseen alerts, critical first, then newest. */
export function stripAlerts(alerts: readonly RiskAlert[], hidden: ReadonlySet<number> = new Set()): RiskAlert[] {
  return alerts
    .filter((a) => !a.seenAt && !hidden.has(a.id))
    .sort((a, b) => (a.severity === b.severity ? Date.parse(b.triggeredAt) - Date.parse(a.triggeredAt) : a.severity === "critical" ? -1 : 1));
}

/** i18n key of an alert's line (revenge has two kinds). */
export type AlertTextKey = Exclude<Signal, "revenge"> | "revenge_size" | "revenge_pace";
export const alertKey = (a: Pick<RiskAlert, "signal" | "level">): AlertTextKey =>
  a.signal === "revenge" ? (a.level === "pace" ? "revenge_pace" : "revenge_size") : a.signal;

const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const s = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);

/** Interpolation values of an alert's text (money formatted by the caller's `usd`). */
export type AlertVars = {
  pct: number; loss: string; limit: string; losses: number; ratio: string; median: string; entries: number; usual: string; minutes: number;
  ticker: string; time: string; event: string;
};
export function alertVars(a: RiskAlert, usd: (v: number) => string): AlertVars {
  const st = a.stats;
  return {
    pct: Math.round(n(st.pct)), loss: usd(n(st.lossUsd)), limit: usd(n(st.limitUsd)), losses: n(st.losses),
    ratio: n(st.ratio).toFixed(1), median: usd(n(st.medianUsd)), entries: n(st.entries), usual: n(st.usual).toFixed(1), minutes: n(st.windowMin),
    ticker: s(st.ticker, a.signal === "off_plan" ? a.level : "—"), time: s(st.time, a.level), event: s(st.event, "—"),
  };
}

/** Saved totals are shown only with at least one estimated alert (else «not enough history» / «after the close»). */
export type SavedView = { kind: "value"; saved: number } | { kind: "pending" } | { kind: "small" } | { kind: "none" };
export function savedView(t: SavedTotals): SavedView {
  if (t.saved != null && t.estimated > 0) return { kind: "value", saved: t.saved };
  if (t.alerts > t.settled) return { kind: "pending" };
  if (t.hidden > 0) return { kind: "small" };
  return { kind: "none" };
}
