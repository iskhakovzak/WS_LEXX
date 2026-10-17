import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiUrl } from "@/lib/api";

/**
 * «Кабинет куратора» client: types + raw fetch hooks for /api/curator/* and the risk-process endpoints
 * (/api/risk/templates, /api/risk/breaches, /api/risk/summary). Contract: api-server routes/curator.ts, routes/risk.ts.
 * A 404 (router not registered / API not rebuilt yet) becomes `NotAvailableError` so the page can say so.
 */

export class NotAvailableError extends Error {
  constructor() { super("Раздел ещё не подключён на сервере"); }
}

async function asJson<T>(res: Response): Promise<T> {
  const ct = res.headers.get("content-type") ?? "";
  if (res.status === 404 && !ct.includes("json")) throw new NotAvailableError();
  if (res.ok && !ct.includes("json")) throw new NotAvailableError();
  if (!res.ok) {
    let msg = `Ошибка ${res.status}`;
    try { const b = await res.json(); if (b?.error) msg = String(b.error); } catch { /* ignore */ }
    if (res.status === 404 && /Cannot (GET|POST)/i.test(msg)) throw new NotAvailableError();
    const err = new Error(msg) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res.json() as Promise<T>;
}

const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const enc = encodeURIComponent;

// ─── types ──────────────────────────────────────────────────────────────────

export type Scope = "mine" | "desk";
export type Phase = "premarket" | "session" | "afterclose" | "weekend";
export type NextActionKind =
  | "breach_review" | "stopped" | "near_stop" | "eod_review" | "weekly_review" | "overdue_action"
  | "no_limits" | "template_drift" | "missing_plan" | "missing_eod" | "one_on_one" | "none";
export type NextAction = { kind: NextActionKind; label: string; priority: number; href: string };
export type WeekPoint = { week: string; net: number | null; trades: number };

export type TraderSignal = {
  trader: string;
  stage: { key: string | null; label: string | null; since: string | null };
  tier: string | null;
  tierName: string | null;
  risk: {
    status: string; state: string; label: string; message: string; halted: boolean; nearStop: boolean;
    dailyPct: number | null; weeklyPct: number | null; drawdownPct: number | null;
    todayPnl: number | null; todayTrades: number; weekPnl: number | null; openPositions: number;
    hasLimits: boolean; templateDrift: string[];
  };
  trend: WeekPoint[];
  trendDir: "up" | "down" | "flat" | "none";
  discipline: { value: number | null; eodAvg: number | null; ratingAvg: number | null; n: number };
  plan: { today: "ready" | "draft" | null; available: boolean };
  eod: { prevDay: string; prevTraded: boolean; prevClosed: boolean; todayTraded: boolean; todayClosed: boolean; pending: number; lastClosed: string | null; lastReviewedAt: string | null; lastScore: number | null };
  weekly: { currentStatus: string | null; submittedPending: boolean; lastReviewedWeek: string | null; lastReviewedAt: string | null };
  academy: { openActions: number; overdueActions: number; lastOneOnOne: string | null; daysSinceOneOnOne: number | null; pendingSubmissions: number; activeGoals: number };
  breaches: { unreviewed: number; last30: number; lastDate: string | null };
  lastNote: { body: string; author: string; createdAt: string } | null;
  lastTradeDate: string | null;
  nextAction: NextAction;
};

export type RiskBrief = { trader: string; state: string; label: string; message: string; pnlNet: number | null; dailyPct: number | null; weeklyPct: number | null; drawdownPct: number | null };
export type QueueKind = "eod" | "weekly" | "academy" | "breach";
export type QueueItem = { kind: QueueKind; id: string; trader: string; title: string; since: string | null; hoursWaiting: number | null; href: string; overdue: boolean; slaHours: number };

export type TodayPayload = {
  date: string; prevDay: string; phase: Phase; nyMinutes: number; scope: Scope; wards: number; traders: string[]; plansAvailable: boolean;
  counts: { traders: number; trading: number; halted: number; nearStop: number; noLimits: number; missingPlan: number; missingEod: number; queue: number; queueOverdue: number; overdueActions: number };
  trading: { trader: string; trades: number; pnlNet: number | null; openPositions: number; state: string; dailyPct: number | null }[];
  risk: { halted: RiskBrief[]; nearStop: RiskBrief[]; noLimits: string[] };
  missingPlan: { trader: string; status: "ready" | "draft" | null }[];
  missingEod: { trader: string; date: string }[];
  openToday: { trader: string; date: string }[];
  queue: QueueItem[];
  overdueActions: { id: number; trader: string; title: string; dueOn: string; owner: string; daysOverdue: number }[];
  nextActions: (NextAction & { trader: string })[];
};

export type TradersPayload = { date: string; scope: Scope; wards: number; traders: TraderSignal[] };

export type CuratorNote = { id: number; trader: string; author: string; body: string; kind: NoteKind; pinned: boolean; createdAt: string; updatedAt: string };
export type NoteKind = "note" | "call" | "concern" | "praise";

export type BreachAction = { id: string; title: string; dueOn: string | null; status: "open" | "done" | "dropped" };
export type BreachReview = {
  id: number; alertId: number; trader: string; date: string; kind: string; reason: string; comment: string | null;
  actions: BreachAction[]; consequence: string; createdBy: string; createdAt: string; updatedBy: string | null; updatedAt: string;
};
export type Breach = {
  id: number; trader?: string; date: string; kind: string; kindLabel: string; used: number | null; limit: number | null; message: string;
  createdAt: string | null; repeat?: boolean; breachDays7?: number; review: BreachReview | null;
};

export type RiskLimits = {
  trader: string; accountSize: number | null; dailyLossLimit: number | null; weeklyLossLimit: number | null; maxDrawdown: number | null;
  maxRiskPerTrade: number | null; maxPositionUsd: number | null; maxOvernightExposure: number | null; maxOpenPositions: number | null;
  allowOvernight: boolean; allowSwing: boolean; tier: string | null; notes: string | null; updatedBy: string | null; updatedAt: string | null;
};

export type ProfilePayload = {
  trader: string; role: string;
  assigned: { curator: string | null; mentor: string | null; riskManager: string | null };
  signal: TraderSignal;
  limits: RiskLimits | null;
  metrics: {
    today: { pnlNet: number | null; trades: number; openPositions: number; openRiskUsd: number; dailyLimitUsedPct: number | null; dailyRemainingUsd: number | null };
    week: { pnlNet: number | null; trades: number; limitUsedPct: number | null; remainingUsd: number | null };
    drawdown: { currentUsd: number; maxUsd: number; limitUsedPct: number | null; redDayStreak: number };
    stop: { state: string; label: string; message: string; halted: boolean };
    alerts: { kind: string; label: string; level: "warn" | "breach"; used: number; limit: number | null; pct: number | null; detail?: string }[];
  } | null;
  breaches: Breach[];
  eodDays: { id: number; date: string; closedAt: string | null; reviewedAt: string | null; reviewedBy: string | null; discipline: number | null; curatorScore: number | null; curatorComment: string | null }[];
  weeks: { id: number; week: string; weekStart: string; status: string; submittedAt: string | null; reviewedAt: string | null; score: number | null }[];
  actions: { id: number; owner: string; title: string; dueOn: string | null; status: string; overdue: boolean }[];
  meetings: { id: number; mentor: string; metAt: string | null; format: string; agenda: string }[];
  goals: { id: number; title: string; metric: string; comparator: string; target: number | null; dueOn: string | null; status: string; lastValue: number | null; lastProgress: number | null }[];
  notes: CuratorNote[];
  limitEvents: { id: number; reason: string | null; changedBy: string | null; changedAt: string | null }[];
  canEditLimits: boolean;
};

export type BreachesPayload = {
  from: string; to: string; trader: string | null; breaches: Breach[]; unreviewed: number;
  reasons: { key: string; label: string }[]; consequences: { key: string; label: string }[]; canReview: boolean;
};

export type LimitDiff = { field: string; label: string; current: number | boolean | null; template: number | boolean | null };
export type TierTemplate = {
  key: string; name: string; order: number; accountSize: number | null; dailyLossLimit: number | null; weeklyLossLimit: number | null; maxDrawdown: number | null;
  maxRiskPerTrade: number | null; maxPositionUsd: number | null; maxOvernightExposure: number | null; maxOpenPositions: number | null;
  allowOvernight: boolean; allowSwing: boolean; description: string | null; stage: string | null; stageLabel: string | null;
};
export type TemplatesPayload = {
  tiers: TierTemplate[];
  traders: { trader: string; limits: RiskLimits | null; tier: string | null; tierName: string | null; hasLimits: boolean; drift: LimitDiff[] }[];
  canEdit: boolean;
};
export type ApplyResult = { applied: number; failed: number; results: { trader: string; ok: boolean; error?: string; tier?: string; resync?: boolean; changes?: string[] }[] };

export type RiskSummary = {
  date: string;
  totals: { traders: number; trading: number; pnlNetToday: number | null; openPositions: number; openRiskUsd: number; carriedTonight: number; overnightExposureUsd: number };
  halted: RiskBrief[]; nearStop: RiskBrief[];
  breachesToday: { trader: string; kind: string; kindLabel: string }[];
  repeatBreachers: { trader: string; days7: number; dates: string[] }[];
  unreviewedBreaches: { id: number; trader: string; date: string; kind: string; kindLabel: string; message: string }[];
  noLimits: string[];
  templateDrift: { trader: string; tier: string | null; tierName: string | null; fields: string[] }[];
  overnight: { trader: string; positions: number; exposureUsd: number; allowed: boolean | null; limitUsd: number | null }[];
};

export type IdpMetric = { key: string; label: string; unit: string; comparator: string; windowKind: string; defaultWindow: number | null; defaultTarget: number; description: string; example: string };

// ─── keys + fetchers ────────────────────────────────────────────────────────

export const curatorKeys = {
  all: ["curator"] as const,
  today: (scope: Scope | "auto") => ["curator", "today", scope] as const,
  traders: (scope: Scope | "auto") => ["curator", "traders", scope] as const,
  profile: (trader: string) => ["curator", "profile", trader] as const,
  breaches: (trader: string | null) => ["curator", "breaches", trader ?? "*"] as const,
  templates: ["curator", "templates"] as const,
  summary: ["curator", "risk-summary"] as const,
  idpMetrics: ["curator", "idp-metrics"] as const,
  behavior: (trader: string) => ["curator", "behavior", trader] as const,
};

const scopeQ = (s: Scope | "auto") => (s === "auto" ? "" : `?scope=${s}`);

export const curatorApi = {
  today: (scope: Scope | "auto") => fetch(apiUrl(`/api/curator/today${scopeQ(scope)}`)).then((r) => asJson<TodayPayload>(r)),
  traders: (scope: Scope | "auto") => fetch(apiUrl(`/api/curator/traders${scopeQ(scope)}`)).then((r) => asJson<TradersPayload>(r)),
  profile: (trader: string) => fetch(apiUrl(`/api/curator/trader/${enc(trader)}`)).then((r) => asJson<ProfilePayload>(r)),
  addNote: (body: { trader: string; body: string; kind: NoteKind; pinned?: boolean }) =>
    fetch(apiUrl(`/api/curator/notes`), json("POST", body)).then((r) => asJson<CuratorNote>(r)),
  patchNote: (id: number, body: { body?: string; kind?: NoteKind; pinned?: boolean }) =>
    fetch(apiUrl(`/api/curator/notes/${id}`), json("PATCH", body)).then((r) => asJson<CuratorNote>(r)),
  archiveNote: (id: number) => fetch(apiUrl(`/api/curator/notes/${id}/archive`), { method: "POST" }).then((r) => asJson<{ ok: true }>(r)),
  breaches: (trader: string | null, days = 90) =>
    fetch(apiUrl(`/api/risk/breaches?days=${days}${trader ? `&trader=${enc(trader)}` : ""}`)).then((r) => asJson<BreachesPayload>(r)),
  review: (alertId: number, body: { reason: string; comment: string | null; actions: { id?: string; title: string; dueOn: string | null; status?: string }[]; consequence: string }) =>
    fetch(apiUrl(`/api/risk/breaches/${alertId}/review`), json("POST", body)).then((r) => asJson<BreachReview>(r)),
  setActionStatus: (reviewId: number, actionId: string, status: BreachAction["status"]) =>
    fetch(apiUrl(`/api/risk/breach-reviews/${reviewId}/action`), json("POST", { actionId, status })).then((r) => asJson<BreachReview>(r)),
  templates: () => fetch(apiUrl(`/api/risk/templates`)).then((r) => asJson<TemplatesPayload>(r)),
  applyTemplate: (items: { trader: string; tierKey: string }[], reason: string | null) =>
    fetch(apiUrl(`/api/risk/templates/apply`), json("POST", { items, reason })).then((r) => asJson<ApplyResult>(r)),
  summary: () => fetch(apiUrl(`/api/risk/summary`)).then((r) => asJson<RiskSummary>(r)),
  idpMetrics: () => fetch(apiUrl(`/api/academy/idp/metrics`)).then((r) => asJson<{ metrics: IdpMetric[] }>(r)),
  addGoal: (body: { student: string; title: string; metric: string; target?: number; window?: number | null; dueOn?: string | null; note?: string }) =>
    fetch(apiUrl(`/api/academy/idp`), json("POST", body)).then((r) => asJson<{ id: number }>(r)),
  behavior: (trader: string, from: string, to: string) =>
    fetch(apiUrl(`/api/behavior?trader=${enc(trader)}&from=${from}&to=${to}`)).then((r) =>
      asJson<{ patterns?: { key: string; title: string; n: number; share?: number; net?: number | null; cost?: number | null; severity?: string }[] }>(r)),
};

const retryUnlessMissing = (count: number, err: unknown) => !(err instanceof NotAvailableError) && count < 2;

export function useCuratorToday(scope: Scope | "auto") {
  return useQuery({ queryKey: curatorKeys.today(scope), queryFn: () => curatorApi.today(scope), refetchInterval: 60_000, retry: retryUnlessMissing });
}
export function useCuratorTraders(scope: Scope | "auto") {
  return useQuery({ queryKey: curatorKeys.traders(scope), queryFn: () => curatorApi.traders(scope), staleTime: 30_000, retry: retryUnlessMissing });
}
export function useCuratorProfile(trader: string | null) {
  return useQuery({ queryKey: curatorKeys.profile(trader ?? ""), queryFn: () => curatorApi.profile(trader!), enabled: !!trader, retry: retryUnlessMissing });
}
export function useRiskSummary(enabled = true) {
  return useQuery({ queryKey: curatorKeys.summary, queryFn: curatorApi.summary, enabled, refetchInterval: 60_000, retry: retryUnlessMissing });
}
export function useRiskTemplates(enabled = true) {
  return useQuery({ queryKey: curatorKeys.templates, queryFn: curatorApi.templates, enabled, staleTime: 60_000, retry: retryUnlessMissing });
}
export function useIdpMetrics(enabled: boolean) {
  return useQuery({ queryKey: curatorKeys.idpMetrics, queryFn: curatorApi.idpMetrics, enabled, staleTime: 10 * 60_000, retry: retryUnlessMissing });
}
export function useBehaviorPatterns(trader: string, from: string, to: string, enabled: boolean) {
  return useQuery({ queryKey: [...curatorKeys.behavior(trader), from, to], queryFn: () => curatorApi.behavior(trader, from, to), enabled, staleTime: 5 * 60_000, retry: false });
}

/** Invalidate everything the cabinet shows (after a note / review / template / goal change). */
export function useInvalidateCurator() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: curatorKeys.all });
    void qc.invalidateQueries({ queryKey: ["risk"] });
  };
}

export function useCuratorMutation<V, R>(fn: (v: V) => Promise<R>) {
  const invalidate = useInvalidateCurator();
  return useMutation({ mutationFn: fn, onSuccess: () => invalidate() });
}
