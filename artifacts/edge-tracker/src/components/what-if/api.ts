/**
 * Data layer of the «Что-если» simulator: raw fetch helpers for /api/whatif/* (no orval codegen for new
 * endpoints) and the response types mirrored from api-server/src/lib/whatIf.ts.
 */
import { useEffect, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "@/lib/api/http";
import { isNotFound } from "@/lib/api/errors";
import { type ErrorCode, isErrorCode } from "@/components/shared/error-vocab";
import type { Rule, RuleType } from "./rules";

export type Side = "long" | "short";

export type SimTrade = {
  id: number;
  day: string;
  entryMin: number | null;
  ticker: string;
  side: Side | null;
  qty: number | null;
  entry: number | null;
  gross: number | null;
  fees: number;
  holdSec: number | null;
  setup: string | null;
  /** Engine-only fields: /whatif/base no longer sends them (payload size); kept optional for older API builds. */
  exit?: number | null;
  r?: number | null;
  stop?: number | null;
  tags?: string[];
  horizon?: "intraday" | "overnight" | "swing";
  result?: "win" | "loss" | "be" | null;
  feeBreakdown?: Record<string, number> | null;
  /** Σ regulatory fees — sent by the compact table instead of `feeBreakdown`. */
  regFees?: number | null;
  fills?: number | null;
  seq: number;
  /** Own grade A+…C; absent on older API builds. */
  grade?: string | null;
  /** Fields of the newer rules (absent on older API builds): owner, IMX, re-entry, size to the usual, stop, marks. */
  trader?: string | null;
  imx?: boolean;
  reentry?: boolean;
  sizeRel?: number | null;
  hasStop?: boolean | null;
  mistakes?: ErrorCode[];
  ptags?: string[];
};

export type DayResult = { day: string; net: number; gross: number; fees: number; trades: number };
export type EquityPoint = { day: string; net: number; cum: number };

export type Metrics = {
  trades: number; wins: number; losses: number; be: number;
  gross: number; fees: number; net: number;
  winRate: number | null; profitFactor: number | null; expectancy: number | null;
  avgWin: number | null; avgLoss: number | null;
  maxDrawdown: number; days: number;
  bestDay: DayResult | null; worstDay: DayResult | null;
  dailyMean: number | null; dailyStd: number | null; sharpe: number | null;
  maxLossStreak: number;
  feePctOfGross: number | null; feePerTrade: number | null; shares: number; feePerShare: number | null;
  /** Σ R of trades with a known R (absent on older API builds). */
  totalR?: number | null; rCount?: number;
};

export type Ci = { mean: number; lo: number; hi: number };
export type MonthDist = { p5: number; p25: number; p50: number; p75: number; p95: number; probPositive: number };
export type BootstrapSummary = {
  iters: number; days: number;
  diffTotal: Ci;
  dailyExpectancy: { base: Ci; scenario: Ci };
  month: MonthDist; monthBase: MonthDist;
  significant: boolean; smallSample: boolean;
};

export type ExcludedTrade = { id: number; day: string; ticker: string; net: number; reason: string; detail: string };
export type ChangedTrade = { id: number; day: string; ticker: string; reason: string; before: number; after: number; detail: string; estimate: boolean };
export type SkippedRule = { rule: string; reason: string };

export type PeriodMeta = { from: string | null; to: string | null; withEntryTime: number; withHold: number; withR: number; withQty: number };

export type Preset = { id: string; label: string; description: string; rules: Rule[] };

/** Compact trade table of /whatif/base?enc=2 (api-server routes/whatif.ts compactTrades). */
export type TradeTable = { cols: string[]; rows: (string | number | null)[][]; dicts: Record<string, string[]> };

export type BaseResponse = {
  scope: string | null;
  period: PeriodMeta;
  trades: SimTrade[];
  baseline: Metrics;
  equity: EquityPoint[];
  daily: DayResult[];
  presets: Preset[];
  /** Rule types the running engine understands (absent on an older API build → only the legacy set). */
  ruleTypes?: RuleType[];
  generatedAt: string;
};

export type RunResponse = {
  scope: string | null;
  period: PeriodMeta;
  rules: Rule[];
  ruleLabels: string[];
  baseline: Metrics;
  scenario: Metrics;
  baselineEquity: EquityPoint[];
  scenarioEquity: EquityPoint[];
  baselineDaily: DayResult[];
  scenarioDaily: DayResult[];
  excluded: ExcludedTrade[];
  changed: ChangedTrade[];
  skipped: SkippedRule[];
  keptIds: number[];
  bootstrap: BootstrapSummary | null;
  generatedAt: string;
};

export type Suggestion = {
  rule: Rule; label: string; improvement: number; ci: { lo: number; hi: number };
  tradesLeft: number; excluded: number; scenarioNet: number; scenarioWinRate: number | null; scenarioProfitFactor: number | null;
  /** Above zero after the correction for the rules tried (absent on an older API build, where every suggestion is robust). */
  robust?: boolean;
  removedNet?: number;
  /** "exante" = known before the entry; "label" = depends on the trader's own marks (absent on older builds). */
  kind?: "exante" | "label";
  /** Chosen by its own past result (worst tickers / setups / tags). */
  picked?: boolean;
  /** Picked and checked on the same days (too few days for a holdout). */
  sameData?: boolean;
  /** Result on the last third of the days; null without a holdout. */
  holdout?: { delta: number; days: number; affected: number } | null;
  /** Trades removed or changed / changed (scale rules); estimate = a scale rule. */
  affected?: number;
  changed?: number;
  estimate?: boolean;
  /**
   * The honest path (api lib/whatIfHonesty): «Подтверждено» / «Гипотеза» once the verdict is ready, «предварительно»
   * for the fast cards shown meanwhile; absent in team scope and on older builds.
   */
  status?: "confirmed" | "hypothesis" | "preliminary";
  /** «до входа» / «в сделке» / «разбор»; absent on older builds (then derived from `kind`). */
  timing?: Timing;
  /** Out of sample: Σ over the later months and in how many it helped (null without a walk-forward). */
  oos?: { sum: number; months: number; positive: number; testDays: number } | null;
  /** A hypothesis: trading days still needed to tell an effect this size from chance; `needDaysAtLeast` = a lower bound. */
  needDays?: number | null;
  needDaysAtLeast?: boolean;
  /** The days needed outrun what this period can still gather («с начала года» near the year's end): check on «всё время». */
  needAllTime?: boolean;
  /** Most of the effect comes from a few days. */
  fragile?: { reason: "fewDays" | "topDays"; days: number } | null;
};

export type Timing = "exante" | "inTrade" | "review";
/** «window»: a rolling 30 / 90-day period or a closed range — it never grows, so no honest verdict can resolve there. */
export type HonestyState = "ready" | "queued" | "running" | "failed" | "team" | "unavailable" | "window" | "facets";
export type HonestyInfo = {
  state: HonestyState;
  version: number;
  computedAt: string | null;
  wfAvailable: boolean | null;
  months: number | null;
  testDays: number | null;
  confirmed: number;
  hypotheses: number;
  /** Poll interval while the honest check is queued or running (the server backs off after 3 min), else null. */
  pollMs: number | null;
  /** How long the honest check has been queued or running, else null (absent on older builds). */
  pendingMs?: number | null;
};

export type SuggestionsResponse = {
  scope: string | null; period: PeriodMeta; baselineNet: number; trades: number; days: number;
  /** < 30 days or < 60 trades: every card is a guide, none robust. */
  smallSample: boolean;
  suggestions: Suggestion[];
  /** Rules tried (the family-wise correction); absent on older builds. */
  tested?: number;
  /** The honest check of this trader's cards; absent on older builds and without trades. */
  honesty?: HonestyInfo;
  generatedAt: string;
};

/** The honest check is still being computed (the page polls until it is ready). */
export function honestyPending(data: SuggestionsResponse | undefined): boolean {
  const st = data?.honesty?.state;
  return st === "queued" || st === "running";
}

/** Pending longer than this: the check is taking longer than usual (the server polls slower then, never stops). */
export const HONESTY_SLOW_MS = 3 * 60_000;

/** The honest check has been pending for HONESTY_SLOW_MS or more (a restart, a long queue): no «до минуты» promise. */
export function honestySlow(data: SuggestionsResponse | undefined): boolean {
  return honestyPending(data) && (data?.honesty?.pendingMs ?? 0) >= HONESTY_SLOW_MS;
}

/**
 * refetchInterval of the suggestions query: the server's interval while the check is pending (4 s, 30 s once it has
 * been pending for 3 min — so every pending episode, after any sync, is followed to the end), else none.
 */
export function suggestionsPollMs(data: SuggestionsResponse | undefined): number | false {
  return honestyPending(data) ? data?.honesty?.pollMs ?? 4000 : false;
}

export type SavedScenario = { id: number; trader: string; name: string; rules: Rule[]; labels: string[]; createdBy: string | null; createdAt: string; updatedAt: string };

/** `rolling`: the page's 30 / 90-day periods, whose start moves every day (the suggestions take the fast path there). */
/** `facets`: the page's «Разрезы» as x* params (components/shared/trade-facets) — excluded trades never reach the engine. */
export type Scope = { trader: string; from: string; to: string; rolling?: boolean; facets?: string };

function scopeParams(s: Scope): string {
  const sp = new URLSearchParams();
  if (s.trader) sp.set("trader", s.trader);
  if (s.from) sp.set("from", s.from);
  if (s.to) sp.set("to", s.to);
  if (s.facets) new URLSearchParams(s.facets).forEach((v, k) => sp.set(k, v));
  return sp.toString();
}

function suggestionsParams(s: Scope): string {
  const sp = new URLSearchParams(scopeParams(s));
  if (s.rolling) sp.set("window", "rolling");
  return sp.toString();
}

export const whatIfKeys = {
  all: ["whatif"] as const,
  base: (s: Scope) => ["whatif", "base", scopeParams(s)] as const,
  run: (s: Scope, rules: Rule[]) => ["whatif", "run", scopeParams(s), JSON.stringify(rules)] as const,
  suggestions: (s: Scope) => ["whatif", "suggestions", suggestionsParams(s)] as const,
  scenarios: (trader: string) => ["whatif", "scenarios", trader] as const,
};

const TABLE_COLS = [
  "id", "day", "entryMin", "ticker", "side", "qty", "entry", "gross", "fees", "holdSec", "seq", "fills", "reg", "setup", "grade",
  "trader", "imx", "reentry", "sizeRel", "hasStop", "ptags", "mistakes",
];

/**
 * Trades of the compact table (dictionary columns restored; unknown columns ignored, missing ones → null). The newer
 * columns are read by name, so an older API table simply leaves them out of the trades.
 */
export function decodeTrades(t: TradeTable): SimTrade[] {
  const at = (k: string) => t.cols.indexOf(k);
  const ix = Object.fromEntries(TABLE_COLS.map((k) => [k, at(k)])) as Record<string, number>;
  const cell = (r: (string | number | null)[], k: string) => (ix[k] >= 0 ? r[ix[k]] ?? null : null);
  const num = (r: (string | number | null)[], k: string) => { const v = cell(r, k); return typeof v === "number" ? v : null; };
  const str = (r: (string | number | null)[], k: string) => {
    const v = cell(r, k);
    if (v == null) return null;
    const d = t.dicts[k];
    return d && typeof v === "number" ? d[v] ?? null : String(v);
  };
  const list = (r: (string | number | null)[], k: string) => str(r, k)?.split(",").filter(Boolean) ?? [];
  const has = (k: string) => ix[k] >= 0;
  return t.rows.map((r, i) => {
    const out: SimTrade = {
      id: num(r, "id") ?? 0, day: str(r, "day") ?? "", entryMin: num(r, "entryMin"), ticker: str(r, "ticker") ?? "",
      side: (str(r, "side") as Side | null) ?? null, qty: num(r, "qty"), entry: num(r, "entry"), gross: num(r, "gross"),
      fees: num(r, "fees") ?? 0, holdSec: num(r, "holdSec"), seq: num(r, "seq") ?? i, fills: num(r, "fills"), regFees: num(r, "reg"),
      setup: str(r, "setup"), grade: str(r, "grade"),
    };
    if (has("trader")) out.trader = str(r, "trader");
    if (has("imx")) out.imx = num(r, "imx") === 1;
    if (has("reentry")) out.reentry = num(r, "reentry") === 1;
    if (has("sizeRel")) out.sizeRel = num(r, "sizeRel");
    if (has("hasStop")) { const v = num(r, "hasStop"); out.hasStop = v === 1 ? true : v === 0 ? false : null; }
    if (has("ptags")) out.ptags = list(r, "ptags");
    if (has("mistakes")) out.mistakes = list(r, "mistakes").filter(isErrorCode);
    return out;
  });
}

type BaseWire = Omit<BaseResponse, "trades"> & { trades?: SimTrade[]; enc?: number; tradeTable?: TradeTable };

/** The compact table (enc=2: ~a third of the JSON for the whole desk); an older API answers with plain `trades`. */
export function useWhatIfBase(scope: Scope, enabled = true) {
  return useQuery<BaseResponse>({
    queryKey: whatIfKeys.base(scope), enabled, staleTime: 60_000,
    // Period / trader switch: keep the previous base on screen (dimmed, «recalculating») instead of a full-page skeleton.
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const q = scopeParams(scope);
      const { tradeTable, trades, ...rest } = await http.get<BaseWire>(`/api/whatif/base?${q ? `${q}&` : ""}enc=2`);
      return { ...rest, trades: tradeTable ? decodeTrades(tradeTable) : trades ?? [] };
    },
  });
}

/** Read-only POST: nothing is stored, so it is modelled as a query (cached by scope + rules). */
export function useWhatIfRun(scope: Scope, rules: Rule[], enabled = true) {
  return useQuery<RunResponse>({
    queryKey: whatIfKeys.run(scope, rules),
    enabled,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
    queryFn: () => http.post<RunResponse>("/api/whatif/run", {
      trader: scope.trader || undefined, from: scope.from || undefined, to: scope.to || undefined, ...Object.fromEntries(new URLSearchParams(scope.facets ?? "")), rules,
    }),
  });
}

export function useWhatIfSuggestions(scope: Scope, enabled = true) {
  return useQuery<SuggestionsResponse>({
    queryKey: whatIfKeys.suggestions(scope), enabled, staleTime: 5 * 60_000, placeholderData: keepPreviousData,
    // While the honest check runs on the server the fast cards are shown, and the query polls until it is ready.
    refetchInterval: (q) => suggestionsPollMs(q.state.data),
    queryFn: () => http.get<SuggestionsResponse>(`/api/whatif/suggestions?${suggestionsParams(scope)}`),
  });
}

export function useSavedScenarios(trader: string, enabled = true) {
  return useQuery<SavedScenario[]>({
    queryKey: whatIfKeys.scenarios(trader),
    enabled,
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      try {
        return await http.get<SavedScenario[]>(`/api/whatif/scenarios${trader ? `?trader=${encodeURIComponent(trader)}` : ""}`);
      } catch (e) {
        if (isNotFound(e)) return [];
        throw e;
      }
    },
  });
}

export function useSaveScenario(trader: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; rules: Rule[] }) => http.post<SavedScenario>("/api/whatif/scenarios", { ...body, trader: trader || undefined }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["whatif", "scenarios"] }),
  });
}

export function useDeleteScenario() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => http.del<{ ok: true }>(`/api/whatif/scenarios/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["whatif", "scenarios"] }),
  });
}

/**
 * The trader's risk limits (GET /api/risk/limits/:trader — read only; the risk desk owns them). Null for the whole
 * team, without a limits row, or when the viewer may not read them: the page then falls back to the trades.
 */
export function useTraderLimits(trader: string) {
  return useQuery<{ dailyLossLimit: number | null } | null>({
    queryKey: ["whatif", "limits", trader],
    enabled: !!trader,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async () => {
      try {
        const l = await http.get<{ dailyLossLimit?: unknown } | null>(`/api/risk/limits/${encodeURIComponent(trader)}`);
        const v = Number(l?.dailyLossLimit);
        return { dailyLossLimit: Number.isFinite(v) && v > 0 ? v : null };
      } catch {
        return null;
      }
    },
  });
}

/** Debounced copy of a value (the rule constructor fires on every keystroke; the server runs once it settles). */
export function useDebounced<T>(value: T, ms = 400): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
