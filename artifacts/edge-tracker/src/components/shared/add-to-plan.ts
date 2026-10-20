/**
 * «В план» — ONE way to put a ticker into the viewer's personal day plan (Волна 1, item 1.7), used by /themes, the
 * morning screener, /watchlist, analysts and offerings (it replaces four copies that each read → changed → wrote the
 * whole plan, prefilled levels only on /watchlist and credited the quest only on /themes).
 *
 *   levels   PDH / PDL / PMH / PML (+ the caller's stop / target) become «Поддержка / Сопротивление» around the price:
 *            the caller's hints when it has them (watchlist, big7), else the session bars of the ticker (the candles
 *            API, cached per ticker and day) — best effort, ≤ 2.5 s, no levels rather than a wait.
 *   no clobber  a plan editor open for that day registers a draft sink (usePlanDraftSink): the ticker is merged into
 *            the editor's draft and its own autosave writes it. Without an open editor the plan is read fresh from the
 *            server, the ticker appended (every stored field sent back as is), and the saved plan put into the query
 *            cache, so an editor opened next starts from it and never writes an older doc back.
 *   quest    credited once per added ticker: the quests query is marked stale and «plan.save» tracked — only on «added».
 */
import { useEffect, useRef } from "react";
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { http } from "@/lib/api/http";
import { KEYS } from "@/lib/api/keys";
import { trackAction } from "@/lib/usage";
import { addDays, nyDate, prevWeekday } from "@/lib/trading-date";
import { PLAN_MAX_TICKERS, normTicker, planTickers } from "./finviz/model";

export type PlanBias = "bull" | "bear" | "neutral";

/** What the caller already knows about the ticker (any of it may be missing). */
export type PlanLevelHints = {
  price?: number | null; pdh?: number | null; pdl?: number | null; pmh?: number | null; pml?: number | null;
  stop?: number | null; target?: number | null;
};

export type AddToPlanInput = {
  ticker: string;
  /** The plan day (the caller's own rule: today until the close, then the next session). */
  date: string;
  catalyst: string;
  bias?: PlanBias;
  horizon?: "intraday" | "swing";
  plan?: string;
  riskNote?: string;
  /** Known levels; `null` = don't look any up; undefined = look them up from the session bars. */
  levels?: PlanLevelHints | null;
};

/** One «В игре» row of a stored plan doc (the plan PUT validates the same shape). */
export type PlanItem = {
  ticker: string; catalyst: string; bias: PlanBias; grade: null; levels: { support: number[]; resistance: number[] }; plan: string;
  horizon: "intraday" | "swing"; risk_note: string; scenarioA: string; scenarioB: string; trigger: string; invalidation: string;
  tvLink: string; media: never[];
};

export type AddToPlanKind = "added" | "exists" | "full";
export type AddToPlanResult = { kind: AddToPlanKind; date: string; ticker: string; via: "editor" | "server"; levels: number[] };

// ── pure ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const pos = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
const round2 = (v: number) => Math.round(v * 100) / 100;

/** Levels below the price → support (nearest first), at / above → resistance (nearest first), ≤ 4 each. */
export function planLevels(h: PlanLevelHints | null | undefined): { support: number[]; resistance: number[] } {
  if (!h || !pos(h.price)) return { support: [], resistance: [] };
  const price = h.price;
  const pts = [...new Set([h.pdh, h.pdl, h.pmh, h.pml, h.stop, h.target].filter(pos).map(round2))];
  return {
    support: pts.filter((p) => p < price).sort((a, b) => b - a).slice(0, 4),
    resistance: pts.filter((p) => p >= price).sort((a, b) => a - b).slice(0, 4),
  };
}

export function buildPlanItem(input: AddToPlanInput, ticker: string, hints: PlanLevelHints | null | undefined): PlanItem {
  return {
    ticker, catalyst: input.catalyst.slice(0, 240), bias: input.bias ?? "neutral", grade: null, levels: planLevels(hints),
    plan: input.plan ?? "", horizon: input.horizon ?? "intraday", risk_note: input.riskNote ?? "",
    scenarioA: "", scenarioB: "", trigger: "", invalidation: "", tvLink: "", media: [],
  };
}

type DocLike = Record<string, unknown> & { inPlay?: unknown };

/** The stored doc with the ticker appended to «В игре» (every other field kept as is). */
export function mergeIntoDoc(doc: DocLike | null | undefined, item: PlanItem): { kind: "added"; doc: DocLike } | { kind: "exists" | "full" } {
  const base: DocLike = doc && typeof doc === "object" ? { ...doc } : {};
  const list = Array.isArray(base.inPlay) ? [...(base.inPlay as unknown[])] : [];
  if (planTickers(base).has(item.ticker)) return { kind: "exists" };
  if (list.length >= PLAN_MAX_TICKERS) return { kind: "full" };
  return { kind: "added", doc: { ...base, inPlay: [...list, item] } };
}

type Bar = { t: number; h: number; l: number; c: number };
const NY_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
function ny(epochSec: number): { day: string; mod: number } {
  const p = NY_FMT.formatToParts(new Date(epochSec * 1000));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return { day: `${g("year")}-${g("month")}-${g("day")}`, mod: (Number(g("hour")) % 24) * 60 + Number(g("minute")) };
}
const RTH_OPEN = 9 * 60 + 30, RTH_CLOSE = 16 * 60, PRE_OPEN = 4 * 60;

/** PDH / PDL (the last regular session before `day`), PMH / PML (premarket of `day`) and the last price, from 5-min bars. */
export function levelsFromBars(bars: readonly Bar[], day: string): PlanLevelHints {
  let prevDay = "";
  let pdh: number | null = null, pdl: number | null = null, pmh: number | null = null, pml: number | null = null;
  for (const b of bars) {
    const p = ny(b.t);
    if (p.day < day) {
      if (p.mod < RTH_OPEN || p.mod >= RTH_CLOSE) continue;
      if (p.day !== prevDay) { prevDay = p.day; pdh = b.h; pdl = b.l; continue; }
      pdh = Math.max(pdh ?? b.h, b.h); pdl = Math.min(pdl ?? b.l, b.l);
    } else if (p.day === day && p.mod >= PRE_OPEN && p.mod < RTH_OPEN) {
      pmh = Math.max(pmh ?? b.h, b.h); pml = Math.min(pml ?? b.l, b.l);
    }
  }
  return { price: bars.length ? bars[bars.length - 1]!.c : null, pdh, pdl, pmh, pml };
}

// ── levels lookup (session bars, cached per ticker and day) ──────────────────────────────────────────────────────

const isWeekend = (d: string) => [0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay());
export const planLevelsKey = (ticker: string, lastSession: string, day: string) => ["plan-levels", ticker, lastSession, day] as const;
const LEVELS_WAIT_MS = 2_500;

async function lookupLevels(qc: QueryClient, ticker: string): Promise<PlanLevelHints | null> {
  const today = nyDate();
  const lastSession = isWeekend(today) ? prevWeekday(today) : today;
  let day = today;
  while (isWeekend(day)) day = addDays(day, 1);
  const job = qc.fetchQuery({
    queryKey: planLevelsKey(ticker, lastSession, day),
    queryFn: async () => {
      const j = await http.get<{ candles?: Bar[] }>(`/api/candles/${encodeURIComponent(ticker)}`, { query: { date: lastSession, interval: "5m", daysBack: 1, extended: 1 } });
      return Array.isArray(j?.candles) && j.candles.length ? levelsFromBars(j.candles, day) : null;
    },
    staleTime: 5 * 60_000,
    retry: 0,
  });
  return Promise.race([job.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), LEVELS_WAIT_MS))]);
}

// ── open editors ─────────────────────────────────────────────────────────────────────────────────────────────────

type DraftSink = (item: PlanItem) => AddToPlanKind;
const sinks = new Map<string, DraftSink>();

/** An open plan editor of `date` takes «В план» into its draft (its autosave writes it). Returns the unregister. */
export function registerPlanDraftSink(date: string, sink: DraftSink): () => void {
  sinks.set(date, sink);
  return () => { if (sinks.get(date) === sink) sinks.delete(date); };
}

/**
 * For the plan editor (one line): `usePlanDraftSink(date, draft, setDraft, toDraftRow, MAX_TICKERS)` — while it is
 * mounted, «В план» from any screen merges into this draft instead of writing the plan behind its back.
 */
export function usePlanDraftSink<T extends { ticker: string }, D extends { inPlay: T[] }>(
  date: string, draft: D, setDraft: (fn: (d: D) => D) => void, toDraftRow: (item: PlanItem) => T, max = PLAN_MAX_TICKERS,
): void {
  const ref = useRef({ draft, setDraft, toDraftRow, max });
  ref.current = { draft, setDraft, toDraftRow, max };
  useEffect(() => registerPlanDraftSink(date, (item) => {
    const { draft: d, setDraft: set, toDraftRow: map, max: cap } = ref.current;
    if (d.inPlay.some((r) => r.ticker.trim().toUpperCase() === item.ticker)) return "exists";
    if (d.inPlay.length >= cap) return "full";
    set((cur) => ({ ...cur, inPlay: [...cur.inPlay, map(item)] }));
    return "added";
  }), [date]);
}

// ── the write ────────────────────────────────────────────────────────────────────────────────────────────────────

type MyPlanRes = { date: string; plan: { status?: "draft" | "ready"; doc?: DocLike | null } | null; prevDate?: string | null } | null;

function credit(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: KEYS.questsMe(), refetchType: "none" });
  trackAction("plan.save");
}

export async function addToPlan(qc: QueryClient, input: AddToPlanInput): Promise<AddToPlanResult> {
  const ticker = normTicker(input.ticker);
  const date = input.date;
  if (!ticker) return { kind: "exists", date, ticker: input.ticker, via: "server", levels: [] };
  const hints = input.levels === undefined ? await lookupLevels(qc, ticker) : input.levels;
  const item = buildPlanItem(input, ticker, hints);
  const levels = [...item.levels.support, ...item.levels.resistance].sort((a, b) => a - b);
  const sink = sinks.get(date);
  if (sink) {
    const kind = sink(item);
    if (kind === "added") trackAction("plan.save");
    return { kind, date, ticker, via: "editor", levels };
  }
  const res = await qc.fetchQuery({
    queryKey: KEYS.myPlan(date),
    queryFn: ({ signal }) => http.get<MyPlanRes>("/api/game-plan/my", { query: { date }, signal }),
    staleTime: 0,
  });
  const merged = mergeIntoDoc(res?.plan?.doc ?? null, item);
  if (merged.kind !== "added") return { kind: merged.kind, date, ticker, via: "server", levels };
  const saved = await http.put<NonNullable<MyPlanRes>["plan"]>(`/api/game-plan/my/${encodeURIComponent(date)}`, {
    ...merged.doc,
    status: res?.plan?.status === "ready" ? "ready" : "draft",
  });
  qc.setQueryData<MyPlanRes>(KEYS.myPlan(date), (prev) => (prev ? { ...prev, plan: saved } : { date, plan: saved, prevDate: null }));
  credit(qc);
  return { kind: "added", date, ticker, via: "server", levels };
}

/** The «В план» mutation every screen uses; the caller words its own toast from the result. */
export function useAddToPlan() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (input: AddToPlanInput) => addToPlan(qc, input) });
}
