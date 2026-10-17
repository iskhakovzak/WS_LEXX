/**
 * Data layer for «Отчёт недели»: types, ISO-week helpers (NY trading weeks, Mon–Fri),
 * react-query hooks and the text / Markdown export of the memo.
 */
import { useMutation, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { http } from "@/lib/api/http";
import { nyDate, addDays } from "@/lib/trading-date";
import { fmtDate, fmtNum, fmtR, fmtRate, fmtUsd, fmtWeekday } from "@/lib/format";
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

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** "13 окт." / "Пн, 13 окт." (UI language). */
export function fmtDay(ymd: string, withWeekday = false): string {
  if (!YMD_RE.test(ymd)) return ymd;
  return withWeekday ? cap(fmtDate(ymd, "weekdayDayMonth")) : fmtDate(ymd, "dayMonth");
}

/** "Пн" (UI language). */
export function weekdayShort(ymd: string): string {
  return YMD_RE.test(ymd) ? cap(fmtWeekday(ymd, "short")) : ymd;
}

/** "W42 · 13–17 окт. 2026" */
export function weekLabel(key: string): string {
  const start = weekStartOf(key);
  if (!start) return key;
  const end = addDays(start, 4);
  const [sy, sm, sd] = start.split("-").map(Number);
  const [, em] = end.split("-").map(Number);
  const range = sm === em ? `${sd}–${fmtDate(end, "dayMonth")}` : `${fmtDate(start, "dayMonth")} – ${fmtDate(end, "dayMonth")}`;
  return `${key.slice(5)} · ${range} ${sy}`;
}

// ── Formatting ───────────────────────────────────────────────────────────────
// Money / R / percent / multipliers: @/lib/format (fmtUsd, fmtR, fmtRate, fmtNum(v, { suffix: "×" })).

/** Value in the week's unit: $ when the book has P&L, else R. */
export function fmtValue(v: number | null | undefined, unit: Unit, signed = true): string {
  return unit === "usd" ? fmtUsd(v, { signed, decimals: "auto" }) : fmtR(v, { signed });
}

export const HORIZON_LABEL: Record<Horizon, string> = { intraday: "Интрадей", overnight: "Овернайт", swing: "Свинг" };
export const STATUS_LABEL: Record<ReviewStatus | "none", string> = { none: "Не начат", draft: "Черновик", submitted: "Отправлен", reviewed: "Разобран" };
export const GOAL_LABEL: Record<GoalStatus, string> = { open: "В работе", done: "Выполнена", partial: "Частично", missed: "Не выполнена" };

// ── HTTP ─────────────────────────────────────────────────────────────────────
export const weeklyKeys = {
  all: ["weekly-review"] as const,
  doc: (trader: string, week: string) => ["weekly-review", "doc", trader, week] as const,
  overview: (week: string) => ["weekly-review", "overview", week] as const,
};

export function useWeeklyReview(trader: string | null, week: string, enabled = true) {
  return useQuery({
    queryKey: weeklyKeys.doc(trader ?? "", week),
    queryFn: () => http.get<WeeklyReview>(`/api/weekly-review?trader=${encodeURIComponent(trader ?? "")}&week=${encodeURIComponent(week)}`),
    enabled: enabled && !!trader && isWeekKey(week),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export function useWeeklyOverview(week: string, enabled = true) {
  return useQuery({
    queryKey: weeklyKeys.overview(week),
    queryFn: () => http.get<Overview>(`/api/weekly-review/overview?week=${encodeURIComponent(week)}`),
    enabled: enabled && isWeekKey(week),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
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
  return useReviewMutation<SelfInput>((b) => http.put<Review>("/api/weekly-review/self", b), () => null);
}

export function useSaveCurator() {
  return useReviewMutation<CuratorInput>((b) => http.put<Review>("/api/weekly-review/curator", b), (b) => ({ trader: b.trader, week: b.week }));
}

export function useSetGoalStatus() {
  return useReviewMutation<GoalsInput>((b) => http.patch<Review>("/api/weekly-review/goals", b), (b) => ({ trader: b.trader, week: b.week }));
}

// ── Export as text / Markdown ────────────────────────────────────────────────
function delta(cur: number | null, prev: number | null, unit: Unit): string {
  if (cur == null || prev == null) return "";
  const d = cur - prev;
  return ` (${unit === "usd" ? fmtUsd(d, { signed: true, decimals: "auto" }) : fmtR(d)} к пред. неделе)`;
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
  lines.push(li(`${b("P&L нетто")}: ${fmtUsd(k.netPnl, { signed: true, decimals: "auto" })}${delta(k.netPnl, p.netPnl, "usd")}; комиссии ${fmtUsd(k.fees, { decimals: "auto" })}`));
  if (k.rCount > 0) lines.push(li(`${b("R")}: ${fmtR(k.totalR)}${delta(k.totalR, p.totalR, "r")}; ожидание ${fmtR(k.expectancyR)}; PF ${fmtNum(k.profitFactorR, { suffix: "×" })}`));
  else if (u === "usd") lines.push(li(`${b("PF")}: ${fmtNum(k.profitFactorUsd, { suffix: "×" })}; ожидание ${fmtUsd(k.expectancyUsd, { signed: true, decimals: "auto" })} / сделка`));
  lines.push(li(`${b("Сделки")}: ${k.trades} (${k.wins}W / ${k.losses}L / ${k.be}BE${k.open ? ` / ${k.open} открыто` : ""}); win rate ${fmtRate(k.winRate)}; торговых дней ${k.tradingDays}`));
  if (k.bestDay) lines.push(li(`Лучший день ${fmtDay(k.bestDay.date, true)}: ${fmtValue(k.bestDay.value, u)}`));
  if (k.worstDay) lines.push(li(`Худший день ${fmtDay(k.worstDay.date, true)}: ${fmtValue(k.worstDay.value, u)}`));
  lines.push("");
  if (doc.byHorizon.length > 1) {
    lines.push(h("По горизонту"));
    for (const g of doc.byHorizon) lines.push(li(`${HORIZON_LABEL[g.key as Horizon] ?? g.key}: ${g.trades} сделок, ${fmtValue(u === "usd" ? g.netPnl : g.totalR, u)}, WR ${fmtRate(g.winRate)}`));
    lines.push("");
  }
  if (doc.bySetup.some((g) => g.key !== "—")) {
    lines.push(h("По сетапам"));
    for (const g of doc.bySetup.slice(0, 8)) lines.push(li(`${g.key}: ${g.trades} сделок, ${fmtValue(u === "usd" ? g.netPnl : g.totalR, u)}, WR ${fmtRate(g.winRate)}${g.rCount ? `, ожидание ${fmtR(g.expectancyR)}` : ""}`));
    lines.push("");
  }
  if (doc.bestTrades.length || doc.worstTrades.length) {
    lines.push(h("Лучшие и худшие сделки"));
    for (const t of doc.bestTrades) lines.push(li(`✓ ${tradeLine(t)}`));
    for (const t of doc.worstTrades) lines.push(li(`✗ ${tradeLine(t)}`));
    lines.push("");
  }
  lines.push(h("Ошибки и нарушения"));
  lines.push(li(`Ошибок: ${doc.mistakes.items.length}${doc.mistakes.cost.trades ? `, цена ${fmtUsd(doc.mistakes.cost.usd, { decimals: "auto" })} / ${fmtR(doc.mistakes.cost.r)}` : ""}`));
  for (const m of doc.mistakes.items.slice(0, 10)) lines.push(`  ${li(`${m.errorType}${m.ticker ? ` (${m.ticker})` : ""}: ${m.description}`)}`);
  lines.push(li(`Нарушений правил: ${doc.violations.items.length}${doc.violations.cost.trades ? `, цена ${fmtUsd(doc.violations.cost.usd, { decimals: "auto" })} / ${fmtR(doc.violations.cost.r)}` : ""}`));
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
    for (const o of doc.openPositions) lines.push(li(`${o.ticker} ${HORIZON_LABEL[o.horizon]} · ${o.daysHeld} дн.${o.riskUsd != null ? ` · риск ${fmtUsd(o.riskUsd, { decimals: "auto" })}` : ""}`));
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
