/**
 * Data layer for «Отчёт недели»: types, ISO-week helpers (NY trading weeks, Mon–Fri),
 * react-query hooks and the text / Markdown export of the memo.
 */
import { useMutation, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { apiUrl } from "@/lib/api";
import { nyDate, addDays } from "@/lib/trading-date";
import type { Horizon } from "@/lib/trade-math";

// ── Types (mirror of routes/weekly-review.ts) ────────────────────────────────
export type Unit = "usd" | "r";

export type Kpi = {
  trades: number; closed: number; wins: number; losses: number; be: number; open: number;
  winRate: number | null;
  totalR: number; rCount: number; expectancyR: number | null; profitFactorR: number | null;
  avgWinR: number | null; avgLossR: number | null;
  netPnl: number | null; grossPnl: number | null; fees: number; pnlCount: number;
  profitFactorUsd: number | null; expectancyUsd: number | null;
  unit: Unit;
  tradingDays: number; greenDays: number; redDays: number;
  bestDay: { date: string; value: number } | null;
  worstDay: { date: string; value: number } | null;
};

export type GroupKpi = Kpi & { key: string; playbookId: number | null };

export type TradeLite = {
  id: number; ticker: string; date: string; cdate: string; setup: string | null; side: string | null; playbookId: number | null;
  horizon: Horizon; result: string | null; r: number | null; net: number | null; gross: number | null; fees: number;
  riskUsd: number | null; qty: number | null; entry: number | null; exit: number | null; stop: number | null;
};

export type Mistake = {
  id: number; errorType: string; description: string; severity: string; lesson: string | null; resolved: boolean;
  ticker: string | null; tradeId: number | null; tradeDate: string | null; tradeR: number | null; tradeNet: number | null; createdAt: string;
};

export type Violation = {
  id: number; severity: string; message: string; ruleName: string | null; ruleKind: string | null;
  ticker: string | null; tradeId: number | null; tradeDate: string | null; tradeR: number | null; tradeNet: number | null; occurredAt: string;
  /** Past weeks only: the rule was disabled / deleted since (the violation is kept, out of current counts). */
  archivedReason?: "rule_disabled" | "rule_deleted" | "stale" | null;
  archivedLabel?: string | null;
};

export type Cost = { trades: number; usd: number | null; r: number | null };

export type RiskEvent = { date: string; kind: string; label: string; level: "warn" | "breach"; used: number; limit: number | null; pct: number | null; detail?: string };

export type RiskLimits = {
  accountSize: number | null; dailyLossLimit: number | null; weeklyLossLimit: number | null; maxDrawdown: number | null;
  maxRiskPerTrade: number | null; maxPositionUsd: number | null; maxOvernightExposure: number | null; maxOpenPositions: number | null;
  allowOvernight: boolean; allowSwing: boolean; tier: string | null;
};

export type OpenPosition = {
  id: number; ticker: string; date: string; side: string | null; setup: string | null; horizon: Horizon;
  qty: number | null; entry: number | null; stop: number | null; daysHeld: number; stillOpen: boolean; exitDate: string | null;
  riskUsd: number | null; exposureUsd: number | null;
};

export type GoalStatus = "open" | "done" | "partial" | "missed";
export type Goal = { id: string; text: string; status: GoalStatus; by: string; createdAt: string; statusBy?: string; statusAt?: string };

export type SelfReview = { well?: string; badly?: string; focus?: string; lessons?: string; mood?: number | null; updatedAt?: string };
export type CuratorReview = { comment?: string; score?: number | null; by?: string; updatedAt?: string };
export type ReviewStatus = "draft" | "submitted" | "reviewed";

export type Review = {
  id: number; trader: string; week: string; weekStart: string;
  selfReview: SelfReview; curatorReview: CuratorReview; goals: Goal[];
  status: ReviewStatus; submittedAt: string | null; reviewedAt: string | null; createdAt: string | null; updatedAt: string | null;
};

export type WeekInfo = { key: string; start: string; end: string; prevKey: string; nextKey: string; isCurrent: boolean; today: string };

export type DayPoint = { date: string; trades: number; net: number | null; r: number | null; wins: number; losses: number };

export type Discipline = {
  journalDays: number; journalWithReview: number; journalWithPlan: number; tradingDays: number;
  journalStreak: number; cleanDays: number; cleanStreak: number;
  avgMood: number | null; avgDiscipline: number | null; followedPlanDays: number;
  days: Array<{ date: string; mood: number | null; discipline: number | null; followedPlan: boolean | null; hasReview: boolean }>;
};

export type Rating = {
  id: number; curator: string; overall: number; discipline: number; riskManagement: number; execution: number; journaling: number; improvement: number; comment: string | null;
};

export type WeeklyReview = {
  trader: string;
  viewer: { name: string; staff: boolean; isOwner: boolean };
  week: WeekInfo;
  kpis: { current: Kpi; previous: Kpi; avg4: Kpi; avg4Weeks: number };
  days: DayPoint[];
  byHorizon: GroupKpi[];
  bySetup: GroupKpi[];
  bestTrades: TradeLite[];
  worstTrades: TradeLite[];
  mistakes: { items: Mistake[]; cost: Cost };
  violations: { items: Violation[]; cost: Cost };
  discipline: Discipline;
  risk: { limits: RiskLimits | null; events: RiskEvent[]; weeklyLossPct: number | null };
  openPositions: OpenPosition[];
  ratings: Rating[];
  review: Review | null;
  prevReview: Review | null;
  prevGoals: Goal[];
};

export type OverviewRow = {
  trader: string; role: string | null;
  trades: number; closed: number; netPnl: number | null; totalR: number; winRate: number | null; expectancyR: number | null; profitFactorR: number | null;
  fees: number; unit: Unit; tradingDays: number; mistakes: number; violations: number; journalDays: number;
  status: ReviewStatus | "none"; selfDone: boolean; curatorScore: number | null; curatorBy: string | null;
  goals: number; goalsDone: number; submittedAt: string | null; reviewedAt: string | null;
  // Added for «Партнёрам» (optional: an API build without them still renders).
  grossPnl?: number | null; profitFactorUsd?: number | null; posNet?: number | null; negNet?: number | null;
  risk?: OverviewRisk; curatorComment?: string | null; focus?: string | null;
};

export type RiskStatus = "ok" | "warn" | "breach" | "none";
export type OverviewRisk = {
  status: RiskStatus; breaches: number; warns: number; weeklyLossPct: number | null;
  events: Array<{ date: string; label: string; level: "warn" | "breach"; pct: number | null; detail: string | null }>;
};

export type Overview = {
  week: WeekInfo;
  summary: {
    traders: number; active: number; netPnl: number | null; totalR: number; trades: number; submitted: number; reviewed: number; pending: number; mistakes: number; violations: number;
    grossPnl?: number | null; fees?: number; posNet?: number | null; negNet?: number | null; riskBreaches?: number; riskWarns?: number;
  };
  traders: OverviewRow[];
};

// ── Week helpers (ISO weeks; same maths as the server) ───────────────────────
const WEEK_RE = /^(\d{4})-W(\d{2})$/;

export function weekKeyOf(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const year = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week = 1 + Math.round(((d.getTime() - jan4.getTime()) / 86_400_000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export function weekStartOf(key: string): string | null {
  const m = WEEK_RE.exec(key);
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  if (week < 1 || week > 53) return null;
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + (week - 1) * 7);
  const start = monday.toISOString().slice(0, 10);
  return weekKeyOf(start) === key ? start : null;
}

export function isWeekKey(v: string | null | undefined): v is string {
  return !!v && WEEK_RE.test(v) && weekStartOf(v) != null;
}

export const currentWeekKey = () => weekKeyOf(nyDate());
export const shiftWeek = (key: string, n: number) => weekKeyOf(addDays(weekStartOf(key) ?? nyDate(), n * 7));

const MONTHS_GEN = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

export function fmtDay(ymd: string, withWeekday = false): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const base = `${Number(m[3])} ${MONTHS_GEN[d.getUTCMonth()]}`;
  return withWeekday ? `${WEEKDAYS[(d.getUTCDay() + 6) % 7]}, ${base}` : base;
}

export function weekdayShort(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? ymd : WEEKDAYS[(d.getUTCDay() + 6) % 7];
}

/** "W42 · 13–17 окт 2026" */
export function weekLabel(key: string): string {
  const start = weekStartOf(key);
  if (!start) return key;
  const end = addDays(start, 4);
  const [sy, sm, sd] = start.split("-").map(Number);
  const [, em, ed] = end.split("-").map(Number);
  const range = sm === em ? `${sd}–${ed} ${MONTHS_GEN[sm - 1]}` : `${sd} ${MONTHS_GEN[sm - 1]} – ${ed} ${MONTHS_GEN[em - 1]}`;
  return `${key.slice(5)} · ${range} ${sy}`;
}

// ── Formatting ───────────────────────────────────────────────────────────────
export function fmtUsd(v: number | null | undefined, opts: { signed?: boolean; compact?: boolean } = {}): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  let body: string;
  if (opts.compact && a >= 10_000) body = a >= 1_000_000 ? `${(a / 1_000_000).toFixed(1)}M` : `${(a / 1000).toFixed(a >= 100_000 ? 0 : 1)}k`;
  else body = a.toLocaleString("en-US", { maximumFractionDigits: a >= 1000 ? 0 : 2, minimumFractionDigits: 0 });
  const sign = v < 0 ? "−" : opts.signed && v > 0 ? "+" : "";
  return `${sign}$${body}`;
}

export function fmtR(v: number | null | undefined, signed = true): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const s = Math.abs(v).toFixed(Math.abs(v) >= 10 ? 1 : 2).replace(/\.?0+$/, "") || "0";
  return `${v < 0 ? "−" : signed && v > 0 ? "+" : ""}${s}R`;
}

export function fmtPct(v: number | null | undefined, digits = 0): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

export function fmtX(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(2)}×`;
}

/** Value in the week's unit: $ when the book has P&L, else R. */
export function fmtValue(v: number | null | undefined, unit: Unit, signed = true): string {
  return unit === "usd" ? fmtUsd(v, { signed }) : fmtR(v, signed);
}

export const HORIZON_LABEL: Record<Horizon, string> = { intraday: "Интрадей", overnight: "Овернайт", swing: "Свинг" };
export const STATUS_LABEL: Record<ReviewStatus | "none", string> = { none: "Не начат", draft: "Черновик", submitted: "Отправлен", reviewed: "Разобран" };
export const GOAL_LABEL: Record<GoalStatus, string> = { open: "В работе", done: "Выполнена", partial: "Частично", missed: "Не выполнена" };

// ── HTTP ─────────────────────────────────────────────────────────────────────
export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function readError(r: Response): Promise<HttpError> {
  let msg = `HTTP ${r.status}`;
  try {
    const j = (await r.json()) as { error?: string };
    if (j?.error) msg = j.error;
  } catch { /* not json */ }
  return new HttpError(r.status, msg);
}

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(apiUrl(path));
  if (!r.ok) throw await readError(r);
  return (await r.json()) as T;
}

async function sendJson<T>(path: string, method: "PUT" | "PATCH", body: unknown): Promise<T> {
  const r = await fetch(apiUrl(path), { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw await readError(r);
  return (await r.json()) as T;
}

const retry = (count: number, err: unknown) => !(err instanceof HttpError && [400, 401, 403, 404].includes(err.status)) && count < 2;

export const weeklyKeys = {
  all: ["weekly-review"] as const,
  doc: (trader: string, week: string) => ["weekly-review", "doc", trader, week] as const,
  overview: (week: string) => ["weekly-review", "overview", week] as const,
};

export function useWeeklyReview(trader: string | null, week: string, enabled = true) {
  return useQuery({
    queryKey: weeklyKeys.doc(trader ?? "", week),
    queryFn: () => getJson<WeeklyReview>(`/api/weekly-review?trader=${encodeURIComponent(trader ?? "")}&week=${encodeURIComponent(week)}`),
    enabled: enabled && !!trader && isWeekKey(week),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry,
  });
}

export function useWeeklyOverview(week: string, enabled = true) {
  return useQuery({
    queryKey: weeklyKeys.overview(week),
    queryFn: () => getJson<Overview>(`/api/weekly-review/overview?week=${encodeURIComponent(week)}`),
    enabled: enabled && isWeekKey(week),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry,
  });
}

export type SelfInput = { week: string; well: string; badly: string; focus: string; lessons: string; mood?: number | null; submit?: boolean };
export type CuratorInput = { trader: string; week: string; comment: string; score: number | null; goals: Array<{ id?: string; text: string }>; finalize?: boolean };
export type GoalsInput = { trader: string; week: string; goals: Array<{ id: string; status: GoalStatus }> };

/** Patches the review inside the cached document (no refetch flash), then invalidates. */
function useReviewMutation<I>(fn: (input: I) => Promise<Review>, docOf: (input: I) => { trader: string; week: string } | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (saved, input) => {
      const target = docOf(input);
      qc.setQueriesData<WeeklyReview>({ queryKey: ["weekly-review", "doc"] }, (old) => {
        if (!old) return old;
        if (old.trader === saved.trader && old.week.key === saved.week) return { ...old, review: saved };
        if (old.trader === saved.trader && old.week.prevKey === saved.week) return { ...old, prevReview: saved, prevGoals: saved.goals };
        return old;
      });
      void target;
      qc.invalidateQueries({ queryKey: weeklyKeys.all });
    },
  });
}

export function useSaveSelf() {
  return useReviewMutation<SelfInput>((b) => sendJson<Review>("/api/weekly-review/self", "PUT", b), () => null);
}

export function useSaveCurator() {
  return useReviewMutation<CuratorInput>((b) => sendJson<Review>("/api/weekly-review/curator", "PUT", b), (b) => ({ trader: b.trader, week: b.week }));
}

export function useSetGoalStatus() {
  return useReviewMutation<GoalsInput>((b) => sendJson<Review>("/api/weekly-review/goals", "PATCH", b), (b) => ({ trader: b.trader, week: b.week }));
}

// ── Export as text / Markdown ────────────────────────────────────────────────
function delta(cur: number | null, prev: number | null, unit: Unit): string {
  if (cur == null || prev == null) return "";
  const d = cur - prev;
  return ` (${unit === "usd" ? fmtUsd(d, { signed: true }) : fmtR(d)} к пред. неделе)`;
}

/** The whole memo as plain text or Markdown (same structure as the page). */
export function reviewToText(doc: WeeklyReview, md: boolean): string {
  const k = doc.kpis.current, p = doc.kpis.previous, u = k.unit;
  const h = (s: string, lvl = 2) => (md ? `${"#".repeat(lvl)} ${s}` : s.toUpperCase());
  const li = (s: string) => (md ? `- ${s}` : `• ${s}`);
  const b = (s: string) => (md ? `**${s}**` : s);
  const tradeLine = (t: TradeLite) =>
    `${t.ticker} ${fmtDay(t.cdate)} ${t.setup ? `· ${t.setup} ` : ""}· ${fmtValue(u === "usd" ? t.net : t.r, u)}${u === "usd" && t.r != null ? ` (${fmtR(t.r)})` : ""}`;
  const lines: string[] = [];
  lines.push(h(`Отчёт недели ${weekLabel(doc.week.key)} — ${doc.trader}`, 1), "");
  lines.push(h("Итоги"));
  lines.push(li(`${b("P&L нетто")}: ${fmtUsd(k.netPnl, { signed: true })}${delta(k.netPnl, p.netPnl, "usd")}; комиссии ${fmtUsd(k.fees)}`));
  if (k.rCount > 0) lines.push(li(`${b("R")}: ${fmtR(k.totalR)}${delta(k.totalR, p.totalR, "r")}; ожидание ${fmtR(k.expectancyR)}; PF ${fmtX(k.profitFactorR)}`));
  else if (u === "usd") lines.push(li(`${b("PF")}: ${fmtX(k.profitFactorUsd)}; ожидание ${fmtUsd(k.expectancyUsd, { signed: true })} / сделка`));
  lines.push(li(`${b("Сделки")}: ${k.trades} (${k.wins}W / ${k.losses}L / ${k.be}BE${k.open ? ` / ${k.open} открыто` : ""}); win rate ${fmtPct(k.winRate)}; торговых дней ${k.tradingDays}`));
  if (k.bestDay) lines.push(li(`Лучший день ${fmtDay(k.bestDay.date, true)}: ${fmtValue(k.bestDay.value, u)}`));
  if (k.worstDay) lines.push(li(`Худший день ${fmtDay(k.worstDay.date, true)}: ${fmtValue(k.worstDay.value, u)}`));
  lines.push("");
  if (doc.byHorizon.length > 1) {
    lines.push(h("По горизонту"));
    for (const g of doc.byHorizon) lines.push(li(`${HORIZON_LABEL[g.key as Horizon] ?? g.key}: ${g.trades} сделок, ${fmtValue(u === "usd" ? g.netPnl : g.totalR, u)}, WR ${fmtPct(g.winRate)}`));
    lines.push("");
  }
  if (doc.bySetup.some((g) => g.key !== "—")) {
    lines.push(h("По сетапам"));
    for (const g of doc.bySetup.slice(0, 8)) lines.push(li(`${g.key}: ${g.trades} сделок, ${fmtValue(u === "usd" ? g.netPnl : g.totalR, u)}, WR ${fmtPct(g.winRate)}${g.rCount ? `, ожидание ${fmtR(g.expectancyR)}` : ""}`));
    lines.push("");
  }
  if (doc.bestTrades.length || doc.worstTrades.length) {
    lines.push(h("Лучшие и худшие сделки"));
    for (const t of doc.bestTrades) lines.push(li(`✓ ${tradeLine(t)}`));
    for (const t of doc.worstTrades) lines.push(li(`✗ ${tradeLine(t)}`));
    lines.push("");
  }
  lines.push(h("Ошибки и нарушения"));
  lines.push(li(`Ошибок: ${doc.mistakes.items.length}${doc.mistakes.cost.trades ? `, цена ${fmtUsd(doc.mistakes.cost.usd)} / ${fmtR(doc.mistakes.cost.r)}` : ""}`));
  for (const m of doc.mistakes.items.slice(0, 10)) lines.push(`  ${li(`${m.errorType}${m.ticker ? ` (${m.ticker})` : ""}: ${m.description}`)}`);
  lines.push(li(`Нарушений правил: ${doc.violations.items.length}${doc.violations.cost.trades ? `, цена ${fmtUsd(doc.violations.cost.usd)} / ${fmtR(doc.violations.cost.r)}` : ""}`));
  for (const v of doc.violations.items.slice(0, 10)) lines.push(`  ${li(`${v.ruleName ?? v.ruleKind ?? "Правило"}${v.ticker ? ` (${v.ticker})` : ""}: ${v.message}`)}`);
  lines.push("");
  const d = doc.discipline;
  lines.push(h("Дисциплина"));
  lines.push(li(`Журнал: ${d.journalDays} из 5 дней (серия ${d.journalStreak}); чистых дней ${d.cleanDays} из ${d.tradingDays} (серия ${d.cleanStreak})`));
  if (d.avgDiscipline != null || d.avgMood != null) lines.push(li(`Дисциплина ${d.avgDiscipline ?? "—"}/5, настроение ${d.avgMood ?? "—"}/5, по плану ${d.followedPlanDays} дн.`));
  if (doc.risk.events.length) {
    lines.push("", h("Риск-события"));
    for (const e of doc.risk.events) lines.push(li(`${fmtDay(e.date)} ${e.label}${e.detail ? ` (${e.detail})` : ""}: ${e.pct != null ? `${e.pct}% лимита` : e.level === "breach" ? "нарушение" : "предупреждение"}`));
  }
  if (doc.openPositions.length) {
    lines.push("", h("Открытые позиции на конец недели"));
    for (const o of doc.openPositions) lines.push(li(`${o.ticker} ${HORIZON_LABEL[o.horizon]} · ${o.daysHeld} дн.${o.riskUsd != null ? ` · риск ${fmtUsd(o.riskUsd)}` : ""}`));
  }
  const prevGoals = doc.prevGoals;
  if (prevGoals.length) {
    lines.push("", h("Цели прошлой недели"));
    for (const g of prevGoals) lines.push(li(`[${g.status === "done" ? "x" : g.status === "partial" ? "~" : g.status === "missed" ? "!" : " "}] ${g.text} — ${GOAL_LABEL[g.status]}`));
  }
  const s = doc.review?.selfReview;
  if (s && (s.well || s.badly || s.focus || s.lessons)) {
    lines.push("", h("Самооценка трейдера"));
    if (s.well) lines.push(`${b("Что получилось")}: ${s.well}`);
    if (s.badly) lines.push(`${b("Что не получилось")}: ${s.badly}`);
    if (s.lessons) lines.push(`${b("Уроки")}: ${s.lessons}`);
    if (s.focus) lines.push(`${b("Фокус на следующую неделю")}: ${s.focus}`);
  }
  const c = doc.review?.curatorReview;
  if (c && (c.comment || c.score != null)) {
    lines.push("", h("Разбор куратора"));
    if (c.score != null) lines.push(li(`Оценка: ${c.score}/10${c.by ? ` (${c.by})` : ""}`));
    if (c.comment) lines.push(c.comment);
  }
  const goals = doc.review?.goals ?? [];
  if (goals.length) {
    lines.push("", h("Цели на следующую неделю"));
    goals.forEach((g, i) => lines.push(`${i + 1}. ${g.text}`));
  }
  return lines.join("\n").trim() + "\n";
}
