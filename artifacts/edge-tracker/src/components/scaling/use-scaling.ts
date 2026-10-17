import { useMutation, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { apiUrl } from "@/lib/api";
import { nyDate } from "@/lib/trading-date";

// ─── types (mirror api-server/src/lib/scalingEngine.ts) ─────────────────────

export type RuleKind = "promote" | "demote";
export type Op = ">=" | ">" | "<=" | "<" | "=";
export type Unit = "abs" | "x_daily_limit" | "pct_account";
export type MetricUnit = "usd" | "r" | "pct" | "count" | "x" | "score" | "weeks" | "days";
export type Action = "promote" | "hold" | "demote" | "assign";
export type RuleStatus = "pass" | "fail" | "na";

export type MetricMeta = { key: string; label: string; unit: MetricUnit; higherIsBetter: boolean; hint: string };
export type Meta = { metrics: MetricMeta[]; ops: Op[]; units: { key: Unit; label: string }[] };

export type Tier = {
  key: string;
  name: string;
  order: number;
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
  description?: string | null;
};

export type Rule = {
  id: number;
  kind: RuleKind;
  metric: string;
  op: Op;
  value: number;
  unit: Unit;
  windowDays: number;
  tierKey: string | null;
  label: string | null;
  enabled: boolean;
};

export type MetricValue = { key: string; value: number | null; basis?: "usd" | "r"; note?: string };
export type WindowMetrics = {
  windowDays: number;
  from: string;
  to: string;
  moneySource: "propreports" | "journal";
  hasMoney: boolean;
  values: Record<string, MetricValue>;
};

export type RuleResult = {
  ruleId: number;
  kind: RuleKind;
  metric: string;
  label: string;
  op: Op;
  threshold: number | null;
  rawValue: number;
  unit: Unit;
  windowDays: number;
  actual: number | null;
  basis?: "usd" | "r";
  status: RuleStatus;
  progress: number;
  text: string;
};

export type Limits = {
  trader: string;
  tier: string | null;
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
  updatedBy: string | null;
  updatedAt: string | null;
};

export type Proposal = {
  id: number;
  trader: string;
  action: Action;
  fromTier: string | null;
  toTier: string;
  status: "pending" | "approved" | "rejected";
  source: "auto" | "manual";
  reasons: string[];
  comment: string | null;
  createdBy: string;
  createdAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionComment: string | null;
};

export type HistoryEntry = {
  id: number;
  trader: string;
  action: string;
  fromTier: string | null;
  toTier: string;
  proposalId: number | null;
  actor: string;
  comment: string | null;
  limits: Partial<Tier> | null;
  createdAt: string;
};

export type TraderEval = {
  trader: string;
  today: string;
  tierKey: string | null;
  tier: Tier | null;
  nextTier: Tier | null;
  prevTier: Tier | null;
  rules: RuleResult[];
  windows: WindowMetrics[];
  recommendation: { action: Action; toTier: Tier | null; reasons: string[]; warning: boolean };
  progress: number | null;
  promotePassed: number;
  promoteTotal: number;
  missing: RuleResult[];
  triggered: RuleResult[];
  limits: Limits | null;
  pendingProposal: Proposal | null;
  role: string | null;
};

export type Evaluation = {
  date: string;
  tiers: Tier[];
  rules: Rule[];
  meta: Meta;
  summary: { traders: number; promote: number; demote: number; assign: number; hold: number; warnings: number; pending: number };
  traders: TraderEval[];
  canEdit: boolean;
};

export type Config = { tiers: Tier[]; rules: Rule[]; meta: Meta; canEdit: boolean };

// ─── fetch helpers ──────────────────────────────────────────────────────────

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function parseError(r: Response): Promise<HttpError> {
  let msg = `HTTP ${r.status}`;
  try {
    const j = (await r.json()) as { error?: string; issues?: { path: string; message: string }[] };
    if (j?.error) msg = j.error;
    if (j?.issues?.length) msg += ": " + j.issues.map((i) => `${i.path} — ${i.message}`).join("; ");
  } catch { /* not json */ }
  return new HttpError(r.status, msg);
}

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(apiUrl(path));
  if (!r.ok) throw await parseError(r);
  return (await r.json()) as T;
}

async function send<T>(path: string, method: "POST" | "PUT", body?: unknown): Promise<T> {
  const r = await fetch(apiUrl(path), {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) throw await parseError(r);
  return (await r.json()) as T;
}

const retry = (count: number, err: unknown) => !(err instanceof HttpError && [400, 401, 403, 404].includes(err.status)) && count < 2;

export const scalingKeys = {
  all: ["scaling"] as const,
  evaluate: (trader: string | null) => ["scaling", "evaluate", trader ?? "*"] as const,
  config: () => ["scaling", "config"] as const,
  proposals: (status: string, trader: string | null) => ["scaling", "proposals", status, trader ?? "*"] as const,
  history: (trader: string | null) => ["scaling", "history", trader ?? "*"] as const,
};

export function useEvaluation(trader: string | null, enabled = true) {
  const q = trader ? `trader=${encodeURIComponent(trader)}&` : "";
  return useQuery({
    queryKey: scalingKeys.evaluate(trader),
    queryFn: () => getJson<Evaluation>(`/api/scaling/evaluate?${q}date=${nyDate()}`),
    enabled,
    refetchInterval: 120_000,
    placeholderData: keepPreviousData,
    retry,
  });
}

export function useScalingConfig(enabled = true) {
  return useQuery({ queryKey: scalingKeys.config(), queryFn: () => getJson<Config>("/api/scaling/config"), enabled, retry });
}

export function useProposals(status: "pending" | "approved" | "rejected" | "all", trader: string | null, enabled = true) {
  const q = trader ? `&trader=${encodeURIComponent(trader)}` : "";
  return useQuery({
    queryKey: scalingKeys.proposals(status, trader),
    queryFn: () => getJson<{ proposals: Proposal[] }>(`/api/scaling/proposals?status=${status}${q}&limit=100`),
    enabled,
    retry,
  });
}

export function useHistory(trader: string | null, enabled = true) {
  const q = trader ? `?trader=${encodeURIComponent(trader)}` : "";
  return useQuery({
    queryKey: scalingKeys.history(trader),
    queryFn: () => getJson<{ trader: string | null; history: HistoryEntry[] }>(`/api/scaling/history${q}`),
    enabled,
    retry,
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: scalingKeys.all });
    qc.invalidateQueries({ queryKey: ["risk"] }); // limits changed ⇒ risk desk should refetch too
  };
}

export type TierInput = Omit<Tier, "order"> & { order?: number };
export type RuleInput = Omit<Rule, "id"> & { id?: number };

export function useSaveTiers() {
  const inv = useInvalidate();
  return useMutation({ mutationFn: (tiers: TierInput[]) => send<{ tiers: Tier[] }>("/api/scaling/tiers", "PUT", tiers), onSuccess: inv });
}
export function useSaveRules() {
  const inv = useInvalidate();
  return useMutation({ mutationFn: (rules: RuleInput[]) => send<{ rules: Rule[] }>("/api/scaling/rules", "PUT", rules), onSuccess: inv });
}
export function useCreateProposal() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (body: { trader: string; action?: Action; toTier?: string; comment?: string }) => send<Proposal>("/api/scaling/proposals", "POST", body),
    onSuccess: inv,
  });
}
export function useAutoProposals() {
  const inv = useInvalidate();
  return useMutation({ mutationFn: () => send<{ created: number; proposals: Proposal[] }>("/api/scaling/proposals/auto", "POST", { date: nyDate() }), onSuccess: inv });
}
export function useDecideProposal() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ id, decision, comment }: { id: number; decision: "approve" | "reject"; comment?: string }) =>
      send<{ proposal: Proposal }>(`/api/scaling/proposals/${id}/${decision}`, "POST", { comment }),
    onSuccess: inv,
  });
}
export function useAssignTier() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (body: { trader: string; tierKey: string; comment?: string }) => send<{ trader: string; fromTier: string | null; tier: Tier }>("/api/scaling/assign", "POST", body),
    onSuccess: inv,
  });
}
