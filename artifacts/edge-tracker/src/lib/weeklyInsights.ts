/**
 * «Отчёт недели» — pure insight builders (no React, no fetch): tips with $ amounts, «что получилось»,
 * the curator checklist and the partners' executive conclusions.
 *
 * Nothing here re-computes trading math: every number comes from an existing engine response
 * (GET /api/weekly-review, /api/behavior, /api/whatif/fees, /api/whatif/suggestions, /api/day-report,
 * /api/benchmark). Each input is optional — a missing / failed endpoint simply yields fewer insights.
 */

// ── Inputs (defensive subsets of the engine responses) ───────────────────────

export type WeekKpi = {
  trades: number; wins: number; losses: number;
  winRate: number | null;
  netPnl: number | null; grossPnl: number | null; fees: number;
  profitFactorUsd: number | null; profitFactorR: number | null;
  totalR: number; rCount: number;
  unit: "usd" | "r";
  tradingDays: number; greenDays: number; redDays: number;
  bestDay: { date: string; value: number } | null;
  worstDay: { date: string; value: number } | null;
};

export type BehaviorWeekPoint = { week: string; n: number; cost: number | null; net: number | null };

export type BehaviorPattern = {
  key: string;
  title: string;
  n: number;
  net: number | null;
  cost: number | null;
  severity?: "none" | "low" | "medium" | "high";
  baselineLabel?: string;
  baselineAvg?: number | null;
  weekly?: BehaviorWeekPoint[];
  extra?: Record<string, unknown>;
};

export type BehaviorReport = {
  patterns?: BehaviorPattern[];
  disciplineWeekly?: Array<{ week: string; avg: number | null; days: number }>;
  disciplineAvg?: number | null;
};

export type FeeRow = {
  key: string; trades: number; wins?: number; losses?: number;
  gross: number; grossWins?: number; fees: number; net: number;
  feePctOfGross?: number | null; feePctOfGrossWins?: number | null; breakEvenCents?: number | null;
};

export type FeeReport = {
  total?: FeeRow;
  byHold?: FeeRow[];
  byHour?: FeeRow[];
  breakEvenCents?: number | null;
  recommendations?: string[];
};

export type SimSuggestion = {
  label: string;
  improvement: number;
  ci?: { lo: number; hi: number } | null;
  excluded?: number;
  tradesLeft?: number;
};

export type DayLeak = { kind: string; title: string; count: number; costUsd: number | null; netUsd?: number | null; tradeIds?: number[] };
export type DayPlanItem = { id: string; source?: string; costUsd: number | null; text: string };
export type DayReportLite = {
  date: string;
  summary?: { trades: number; net: number | null; fees?: number | null; winRate?: number | null };
  leaks?: DayLeak[];
  leaksTotalUsd?: number | null;
  plan?: DayPlanItem[];
};

// ── Formatting (local: ₽-free «−$1,234») ─────────────────────────────────────

export function usd(v: number | null | undefined, signed = true): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  const body = a.toLocaleString("en-US", { maximumFractionDigits: a >= 1000 ? 0 : a >= 100 ? 0 : 2, minimumFractionDigits: 0 });
  const sign = v < 0 ? "−" : signed && v > 0 ? "+" : "";
  return `${sign}$${body}`;
}

export function pct(v: number | null | undefined, digits = 0): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

const plural = (n: number, one: string, few: string, many: string) => {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
};
export const trades = (n: number) => `${n} ${plural(n, "сделка", "сделки", "сделок")}`;

// ── Derived KPIs ─────────────────────────────────────────────────────────────

/** Fees as a share of gross P&L; null when gross ≤ 0 (a share of a loss is meaningless). */
export function feeShareOf(k: Pick<WeekKpi, "fees" | "grossPnl"> | null | undefined): number | null {
  if (!k || k.grossPnl == null || !(k.grossPnl > 0)) return null;
  return k.fees / k.grossPnl;
}

/** PF in the week's unit: $ when the book has P&L, else R. Never ∞ (the engines return null). */
export function pfOf(k: Pick<WeekKpi, "unit" | "profitFactorUsd" | "profitFactorR"> | null | undefined): number | null {
  if (!k) return null;
  return k.unit === "usd" ? k.profitFactorUsd : k.profitFactorR;
}

/** Behavior discipline index (0–100) for the week and the mean of the previous weeks in the response. */
export function disciplineOf(beh: BehaviorReport | null | undefined, weekStart: string): { current: number | null; prevAvg: number | null; prevWeeks: number } {
  const rows = beh?.disciplineWeekly ?? [];
  const cur = rows.find((r) => r.week === weekStart);
  const prev = rows.filter((r) => r.week < weekStart && r.avg != null);
  const prevAvg = prev.length ? Math.round((prev.reduce((s, r) => s + (r.avg as number), 0) / prev.length) * 10) / 10 : null;
  return { current: cur?.avg ?? null, prevAvg, prevWeeks: prev.length };
}

/** The pattern's numbers for one week (weekly point keyed by the week's Monday). */
export function patternWeek(p: BehaviorPattern, weekStart: string): BehaviorWeekPoint | null {
  return p.weekly?.find((w) => w.week === weekStart) ?? null;
}

// ── Tips ─────────────────────────────────────────────────────────────────────

export type TipSource = "behavior" | "hold" | "fees" | "time" | "sim" | "day";

export type Tip = {
  id: string;
  source: TipSource;
  /** Short headline with the $ figure. */
  title: string;
  /** $ impact: negative = what it cost this week, positive = potential gain (simulator). */
  amount: number | null;
  /** What the data shows. */
  evidence: string;
  /** One concrete rule for next week (can become the weekly goal). */
  action: string;
  /** Where to dig deeper (route + params). */
  href?: string;
};

export const TIP_SOURCE_LABEL: Record<TipSource, string> = {
  behavior: "Поведение",
  hold: "Удержание",
  fees: "Комиссии",
  time: "Время дня",
  sim: "Симулятор",
  day: "Разбор дня",
};

/** Concrete next-week rule per behavior pattern (keys from lib/behaviorEngine). */
const PATTERN_ACTION: Record<string, (p: BehaviorPattern) => string> = {
  martingale: () => "После убытка следующий вход — тем же или меньшим объёмом.",
  revenge: () => "Пауза 3 минуты после каждого убыточного выхода.",
  overtrading: (p) => `Лимит ${typeof p.extra?.norm === "number" ? p.extra.norm : 4} сделок в день, дальше — только A+ сетапы.`,
  fatigue: (p) => `После ${typeof p.extra?.cut === "number" ? p.extra.cut : 3}-й сделки дня — только A+ сетапы или стоп.`,
  tilt: () => "Стоп на день после 3 убытков подряд.",
  chase: () => "Красное утро — работаем половинным размером, без отыгрыша.",
  disposition: () => "Тайм-стоп: убыточная позиция не дольше средней прибыльной.",
  euphoria: () => "После крупного плюса — пауза 15 минут, следующий вход стандартным размером.",
  firstTrade: () => "Первая сделка дня — только по плану и половинным размером.",
};

const PATTERN_TITLE: Record<string, string> = {
  martingale: "Рост размера после убытка",
  revenge: "Вход сразу после убытка",
  overtrading: "Сделки сверх нормы",
  fatigue: "Сделки в конце дня",
  tilt: "Серии убытков подряд",
  chase: "Отыгрыш после красного утра",
  disposition: "Пересиживание убытков",
  euphoria: "Сделки на эйфории",
  firstTrade: "Первая сделка дня",
};

/** Day-report leak kinds that duplicate a behavior pattern (so the same issue is not tipped twice). */
const LEAK_TO_PATTERN: Record<string, string> = { revenge: "revenge", size_up: "martingale", overtrading: "overtrading", tilt: "tilt" };

const SCALP_KEYS = new Set(["< 30 с", "30 с – 2 мин"]);

export type TipInput = {
  trader: string;
  weekStart: string;
  weekEnd: string;
  kpi?: WeekKpi | null;
  behavior?: BehaviorReport | null;
  fees?: FeeReport | null;
  suggestions?: SimSuggestion[] | null;
  /** Window the suggestions were computed on (for the evidence line). */
  suggestionsWeeks?: number;
  dayReports?: DayReportLite[] | null;
};

const q = (p: Record<string, string | undefined>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v) s.set(k, v);
  const out = s.toString();
  return out ? `?${out}` : "";
};

/** Every candidate tip, most expensive first (deduplicated by id). */
export function tipCandidates(input: TipInput): Tip[] {
  const { trader, weekStart, behavior, fees, suggestions, dayReports } = input;
  const out: Tip[] = [];
  const usedPatterns = new Set<string>();

  // 1) Behavior patterns — this week's slice of the 5-week report.
  for (const p of behavior?.patterns ?? []) {
    const w = patternWeek(p, weekStart);
    if (!w || w.n <= 0) continue;
    const action = (PATTERN_ACTION[p.key] ?? (() => "Разберите эти сделки в журнале и запишите правило."))(p);
    const name = PATTERN_TITLE[p.key] ?? p.title;
    if (p.key === "firstTrade") {
      // «Первая сделка дня −$Y»: the absolute result of the first trades, only when it lost money.
      if (w.net == null || w.net >= -1) continue;
      out.push({
        id: "beh:firstTrade", source: "behavior", amount: w.net,
        title: `${name}: ${usd(w.net)}`,
        evidence: `${trades(w.n)} открыли день с итогом ${usd(w.net)}.`,
        action, href: `/behavior${q({ trader })}`,
      });
      usedPatterns.add(p.key);
      continue;
    }
    if (w.cost == null || w.cost >= -1) continue;
    out.push({
      id: `beh:${p.key}`, source: "behavior", amount: w.cost,
      title: `${name}: ${usd(w.cost)}`,
      evidence: `${trades(w.n)}${w.net != null ? `, нетто ${usd(w.net)}` : ""} — на ${usd(Math.abs(w.cost), false)} хуже вашей нормы${p.baselineLabel ? ` (${p.baselineLabel})` : ""}.`,
      action, href: `/behavior${q({ trader })}`,
    });
    usedPatterns.add(p.key);
  }

  // 2) Fees — scalps shorter than 2 minutes.
  const total = fees?.total;
  const scalps = (fees?.byHold ?? []).filter((r) => SCALP_KEYS.has(r.key));
  if (scalps.length) {
    const n = scalps.reduce((s, r) => s + r.trades, 0);
    const net = scalps.reduce((s, r) => s + r.net, 0);
    const fee = scalps.reduce((s, r) => s + r.fees, 0);
    if (n >= 2 && net < -1) {
      const be = fees?.breakEvenCents ?? total?.breakEvenCents ?? null;
      out.push({
        id: "hold:scalps", source: "hold", amount: Math.round(net * 100) / 100,
        title: `Скальпы < 2 мин: ${usd(net)}`,
        evidence: `${trades(n)} короче 2 минут, комиссии ${usd(fee, false)}.`,
        action: be != null ? `Минимальное удержание 2 мин или цель ≥ ${Math.max(3, Math.ceil(be * 3))}¢ на акцию.` : "Минимальное удержание 2 минуты — или цель минимум втрое больше комиссии.",
        href: `/simulator${q({ trader })}`,
      });
    }
  }

  // 3) Time of day — the worst window (skipped when it is simply where all the week's trades were).
  const hours = (fees?.byHour ?? []).filter((r) => r.trades >= 2 && r.net < -1);
  const totalTrades = total?.trades ?? hours.reduce((s, r) => s + r.trades, 0);
  const worstHour = [...hours].sort((a, b) => a.net - b.net)[0];
  if (worstHour && totalTrades > 0 && worstHour.trades / totalTrades < 0.9) {
    const share = worstHour.feePctOfGrossWins ?? null;
    out.push({
      id: `time:${worstHour.key}`, source: "time", amount: worstHour.net,
      title: `${worstHour.key} ET: ${usd(worstHour.net)}`,
      evidence: `${trades(worstHour.trades)} в этом окне${share != null && share > 0 ? `, комиссии съели ${pct(share)} прибыли` : ""}.`,
      action: `В ${worstHour.key} — только A+ сетапы, остальное пропускать.`,
      href: `/simulator${q({ trader })}`,
    });
  }

  // 4) Fees overall — when commissions eat a large share of the winners. When (almost) every trade sat in
  //    one time window, name it: «15:30–16:00: комиссии съели 39% прибыли».
  if (total && total.fees > 0) {
    const eaten = total.feePctOfGrossWins ?? null;
    const dominant = (fees?.byHour ?? []).find((r) => totalTrades > 0 && r.trades / totalTrades >= 0.9);
    if (eaten != null && eaten >= 0.25) {
      out.push({
        id: "fees:total", source: "fees", amount: -Math.round(total.fees * 100) / 100,
        title: `${dominant ? `${dominant.key}: к` : "К"}омиссии съели ${pct(eaten)} прибыли`,
        evidence: `${usd(total.fees, false)} комиссий при ${usd(total.grossWins ?? null, false)} брутто прибыльных сделок.`,
        action: fees?.recommendations?.[0] ?? "Цель сделки — минимум втрое больше безубытка по комиссиям.",
        href: `/simulator${q({ trader })}`,
      });
    }
  }

  // 5) Day reports — leaks not already covered by a behavior pattern, summed over the week.
  const leakAgg = new Map<string, { title: string; cost: number; count: number; days: number; plan?: string; date: string }>();
  for (const d of dayReports ?? []) {
    for (const l of d.leaks ?? []) {
      const pk = LEAK_TO_PATTERN[l.kind];
      if (pk && usedPatterns.has(pk)) continue;
      if (l.costUsd == null || !(l.costUsd > 0)) continue;
      const a = leakAgg.get(l.kind) ?? { title: l.title, cost: 0, count: 0, days: 0, date: d.date };
      a.cost += l.costUsd; a.count += l.count; a.days += 1;
      const plan = d.plan?.find((p) => p.id === l.kind)?.text;
      if (plan && !a.plan) a.plan = plan.replace(/\s+—\s+сегодня.*$/u, ".").replace(/\.\.$/, ".");
      leakAgg.set(l.kind, a);
    }
  }
  for (const [kind, a] of leakAgg) {
    const cost = -Math.round(a.cost * 100) / 100;
    if (cost >= -1) continue;
    out.push({
      id: `day:${kind}`, source: "day", amount: cost,
      title: `${a.title}: ${usd(cost)}`,
      evidence: `${trades(a.count)} за ${a.days} ${plural(a.days, "день", "дня", "дней")} по разбору дня.`,
      action: a.plan ?? "Разберите эти сделки в «Разборе дня» и запишите правило.",
      href: `/day-report${q({ trader, date: a.date })}`,
    });
  }

  // 6) Simulator — a statistically confirmed rule (positive = what it would have added).
  const best = (suggestions ?? []).filter((s) => s.improvement > 0).sort((a, b) => b.improvement - a.improvement)[0];
  if (best) {
    const weeks = input.suggestionsWeeks ?? 8;
    out.push({
      id: "sim:best", source: "sim", amount: best.improvement,
      title: `Правило «${best.label}»: ${usd(best.improvement)}`,
      evidence: `Симулятор: за ${weeks} нед. добавило бы ${usd(best.improvement)}${best.ci ? ` (диапазон ${usd(best.ci.lo)}…${usd(best.ci.hi)})` : ""}${best.excluded ? `, убрав ${trades(best.excluded)}` : ""}.`,
      action: `Правило на неделю: «${best.label}».`,
      href: `/simulator${q({ trader })}`,
    });
  }

  const seen = new Set<string>();
  return out
    .filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)))
    .sort((a, b) => Math.abs(b.amount ?? 0) - Math.abs(a.amount ?? 0));
}

/** Top-N tips (default 3): one per source first so the list stays varied, then the next most expensive. */
export function buildTips(input: TipInput, limit = 3): Tip[] {
  const all = tipCandidates(input);
  const picked: Tip[] = [];
  const sources = new Set<TipSource>();
  for (const t of all) {
    if (picked.length >= limit) break;
    if (sources.has(t.source)) continue;
    picked.push(t);
    sources.add(t.source);
  }
  for (const t of all) {
    if (picked.length >= limit) break;
    if (!picked.includes(t)) picked.push(t);
  }
  return picked.sort((a, b) => Math.abs(b.amount ?? 0) - Math.abs(a.amount ?? 0));
}

// ── What went well ───────────────────────────────────────────────────────────

export type Positive = { id: string; text: string; amount?: number | null };

export type PositiveInput = {
  weekStart: string;
  kpi?: WeekKpi | null;
  avg4?: WeekKpi | null;
  avg4Weeks?: number;
  behavior?: BehaviorReport | null;
  bestTrade?: { ticker: string; net: number | null } | null;
  violations?: number;
  mistakes?: number;
  journalDays?: number;
  tradingDays?: number;
};

const WEEKDAY = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const wd = (ymd: string) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? ymd : WEEKDAY[(d.getUTCDay() + 6) % 7];
};

export function buildPositives(input: PositiveInput, limit = 4): Positive[] {
  const { kpi: k, avg4, behavior, weekStart } = input;
  const out: Positive[] = [];
  if (!k || k.trades === 0) return out;
  const money = k.unit === "usd";
  if (money && k.netPnl != null && avg4?.netPnl != null && (input.avg4Weeks ?? 0) > 0 && k.netPnl > avg4.netPnl + 1) {
    out.push({ id: "net-vs-avg", text: `Нетто лучше среднего за 4 недели на ${usd(k.netPnl - avg4.netPnl, false)}`, amount: k.netPnl - avg4.netPnl });
  }
  if (k.winRate != null && avg4?.winRate != null && (input.avg4Weeks ?? 0) > 0 && k.winRate - avg4.winRate >= 0.05) {
    out.push({ id: "wr", text: `Win rate ${pct(k.winRate)} — на ${Math.round((k.winRate - avg4.winRate) * 100)} п.п. выше среднего` });
  }
  if (k.bestDay && k.bestDay.value > 0) {
    out.push({ id: "best-day", text: `Лучший день — ${wd(k.bestDay.date)}: ${money ? usd(k.bestDay.value) : `+${k.bestDay.value}R`}`, amount: money ? k.bestDay.value : null });
  }
  if (input.bestTrade?.net != null && input.bestTrade.net > 0) {
    out.push({ id: "best-trade", text: `Лучшая сделка — ${input.bestTrade.ticker}: ${usd(input.bestTrade.net)}`, amount: input.bestTrade.net });
  }
  const first = behavior?.patterns?.find((p) => p.key === "firstTrade");
  const fw = first ? patternWeek(first, weekStart) : null;
  if (fw && fw.n > 0 && fw.cost != null && fw.cost > 1 && (fw.net ?? 0) >= 0) {
    out.push({ id: "first-trade", text: `Первые сделки дня сильнее остальных: ${usd(fw.net)} за ${trades(fw.n)}`, amount: fw.net });
  }
  if ((input.violations ?? 0) === 0 && (input.mistakes ?? 0) === 0) out.push({ id: "clean", text: "Ни одного нарушения правил и записанной ошибки" });
  const disc = disciplineOf(behavior, weekStart).current;
  if (disc != null && disc >= 85) out.push({ id: "discipline", text: `Индекс дисциплины ${Math.round(disc)}/100` });
  const avoided = (behavior?.patterns ?? []).filter((p) => ["overtrading", "tilt", "revenge"].includes(p.key));
  if (avoided.length === 3 && avoided.every((p) => (patternWeek(p, weekStart)?.n ?? 0) === 0)) out.push({ id: "no-tilt", text: "Без овертрейдинга, тильта и реванша" });
  if ((input.tradingDays ?? 0) > 0 && (input.journalDays ?? 0) >= (input.tradingDays ?? 0)) out.push({ id: "journal", text: "Журнал заполнен каждый торговый день" });
  return out.slice(0, limit);
}

// ── Curator checklist ────────────────────────────────────────────────────────

export type CheckStatus = "ok" | "warn" | "fail" | "na";
export type CheckItem = { id: string; label: string; status: CheckStatus; detail: string; amount?: number | null; href?: string };

export type ChecklistInput = {
  trader: string;
  weekStart: string;
  violations: Array<{ ruleName: string | null; ruleKind: string | null; tradeNet: number | null }>;
  violationCostUsd: number | null;
  mistakes: number;
  mistakeCostUsd: number | null;
  risk: { hasLimits: boolean; breaches: number; warns: number; labels: string[] };
  /** Trading days that have no journal review. */
  daysWithoutReview: string[];
  tradingDays: number;
  behavior?: BehaviorReport | null;
  feeShare: number | null;
  reviewStatus: "none" | "draft" | "submitted" | "reviewed";
  prevGoals: Array<{ status: string }>;
};

const BEHAVIOR_RED_FLAGS = ["martingale", "revenge", "tilt", "overtrading"];

export function buildChecklist(input: ChecklistInput): CheckItem[] {
  const out: CheckItem[] = [];
  const q2 = (p: Record<string, string>) => q(p);

  // Rules
  const byRule = new Map<string, number>();
  for (const v of input.violations) {
    const k = v.ruleName ?? v.ruleKind ?? "Правило";
    byRule.set(k, (byRule.get(k) ?? 0) + 1);
  }
  const ruleList = [...byRule.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ×${n}`).join(", ");
  out.push(input.violations.length === 0
    ? { id: "rules", label: "Правила соблюдены", status: "ok", detail: "Нарушений правил нет" }
    : { id: "rules", label: "Нарушения правил", status: "fail", detail: ruleList, amount: input.violationCostUsd, href: "/error-tracker" });

  // Risk limits
  const r = input.risk;
  out.push(!r.hasLimits
    ? { id: "risk", label: "Лимиты риска", status: "na", detail: "Лимиты не заданы", href: `/risk${q2({ trader: input.trader })}` }
    : r.breaches
      ? { id: "risk", label: "Лимиты риска нарушены", status: "fail", detail: r.labels.join(", ") || `${r.breaches} наруш.`, href: `/risk${q2({ trader: input.trader })}` }
      : r.warns
        ? { id: "risk", label: "Лимиты на грани", status: "warn", detail: r.labels.join(", ") || `${r.warns} предупр.`, href: `/risk${q2({ trader: input.trader })}` }
        : { id: "risk", label: "Лимиты риска соблюдены", status: "ok", detail: "Ни одного события риска" });

  // Behavior red flags this week
  const flags = (input.behavior?.patterns ?? [])
    .filter((p) => BEHAVIOR_RED_FLAGS.includes(p.key))
    .map((p) => ({ p, w: patternWeek(p, input.weekStart) }))
    .filter((x) => x.w && x.w.n > 0);
  if (input.behavior) {
    const cost = flags.reduce((s, x) => s + Math.min(0, x.w?.cost ?? 0), 0);
    out.push(flags.length === 0
      ? { id: "behavior", label: "Без мартингейла, реванша и тильта", status: "ok", detail: "Поведенческих срывов не найдено" }
      : {
          id: "behavior", label: "Поведенческие срывы", status: cost < -1 ? "fail" : "warn",
          detail: flags.map((x) => `${PATTERN_TITLE[x.p.key] ?? x.p.title} ×${x.w?.n}`).join(", "),
          amount: cost < 0 ? Math.round(cost * 100) / 100 : null, href: `/behavior${q2({ trader: input.trader })}`,
        });
  }

  // Journal / day review
  const missing = input.daysWithoutReview.length;
  out.push(input.tradingDays === 0
    ? { id: "journal", label: "Разбор дней в журнале", status: "na", detail: "Торговых дней не было" }
    : missing === 0
      ? { id: "journal", label: "Каждый торговый день разобран", status: "ok", detail: `${input.tradingDays} из ${input.tradingDays} дней с разбором` }
      : { id: "journal", label: "Дни без разбора", status: missing >= Math.ceil(input.tradingDays / 2) ? "fail" : "warn", detail: `${missing} из ${input.tradingDays} торговых дней без записи` });

  // Mistakes
  if (input.mistakes > 0) out.push({ id: "mistakes", label: "Записанные ошибки", status: "warn", detail: `${input.mistakes} за неделю`, amount: input.mistakeCostUsd, href: "/error-tracker" });

  // Fees
  if (input.feeShare != null) {
    out.push(input.feeShare > 0.4
      ? { id: "fees", label: "Комиссии съедают брутто", status: "fail", detail: `${pct(input.feeShare)} брутто ушло в комиссии` }
      : input.feeShare > 0.25
        ? { id: "fees", label: "Комиссии заметны", status: "warn", detail: `${pct(input.feeShare)} брутто ушло в комиссии` }
        : { id: "fees", label: "Комиссии под контролем", status: "ok", detail: `${pct(input.feeShare)} брутто` });
  }

  // Self-review & last week's goals
  out.push(input.reviewStatus === "submitted" || input.reviewStatus === "reviewed"
    ? { id: "self", label: "Самооценка отправлена", status: "ok", detail: input.reviewStatus === "reviewed" ? "Неделя разобрана" : "Ждёт вашего разбора" }
    : { id: "self", label: "Самооценка не отправлена", status: "warn", detail: input.reviewStatus === "draft" ? "Есть черновик" : "Трейдер ещё не писал" });
  if (input.prevGoals.length) {
    const open = input.prevGoals.filter((g) => g.status === "open").length;
    const done = input.prevGoals.filter((g) => g.status === "done").length;
    out.push(open
      ? { id: "goals", label: "Цели прошлой недели не отмечены", status: "warn", detail: `${open} из ${input.prevGoals.length} без статуса` }
      : { id: "goals", label: "Цели прошлой недели", status: done === input.prevGoals.length ? "ok" : "warn", detail: `${done} из ${input.prevGoals.length} выполнено` });
  }
  return out;
}

// ── Partners: desk conclusions ───────────────────────────────────────────────

export type DeskRow = {
  trader: string;
  trades: number;
  netPnl: number | null;
  fees: number;
  grossPnl?: number | null;
  riskStatus?: "ok" | "warn" | "breach" | "none" | null;
  verdict?: "better" | "worse" | "flat" | "nodata" | null;
  weakness?: string | null;
};

export type DeskSummary = {
  traders: number;
  active: number;
  netPnl: number | null;
  fees: number;
  grossPnl: number | null;
  reviewed: number;
  submitted: number;
};

export function buildDeskConclusions(s: DeskSummary, rows: DeskRow[], limit = 5): string[] {
  const out: string[] = [];
  const active = rows.filter((r) => r.trades > 0);
  if (active.length === 0) return ["За неделю закрытых сделок на деске нет."];
  const green = active.filter((r) => (r.netPnl ?? 0) > 0);
  out.push(`Деск: нетто ${usd(s.netPnl)} за неделю; торговали ${s.active} из ${s.traders}, в плюсе ${green.length}.`);

  const byNet = [...active].filter((r) => r.netPnl != null).sort((a, b) => (b.netPnl as number) - (a.netPnl as number));
  const top = byNet[0];
  const worst = byNet[byNet.length - 1];
  if (top && (top.netPnl ?? 0) > 0) {
    const share = s.netPnl != null && s.netPnl > 0 && top.netPnl != null ? top.netPnl / s.netPnl : null;
    out.push(`Лучший результат — ${top.trader} (${usd(top.netPnl)}${share != null && share >= 0.5 && byNet.length > 1 ? `, ${pct(Math.min(share, 9.99))} нетто деска` : ""}).`);
  }
  if (worst && worst !== top && (worst.netPnl ?? 0) < 0) {
    const why = worst.riskStatus === "breach" ? "нарушил лимиты" : worst.verdict === "worse" ? "хуже своих прошлых 4 недель" : worst.weakness ?? null;
    out.push(`Проблемная зона — ${worst.trader} (${usd(worst.netPnl)}${why ? `, ${why}` : ""}).`);
  }

  if (s.fees > 0) {
    const share = s.grossPnl != null && s.grossPnl > 0 ? s.fees / s.grossPnl : null;
    const perTrade = s.netPnl != null ? s.netPnl / Math.max(1, active.reduce((a, r) => a + r.trades, 0)) : null;
    out.push(`Комиссии ${usd(s.fees, false)}${share != null ? ` — ${pct(share)} брутто` : s.grossPnl != null ? " при отрицательном брутто" : ""}; нетто на сделку ${usd(perTrade)}.`);
  }

  const breach = rows.filter((r) => r.riskStatus === "breach").map((r) => r.trader);
  const warn = rows.filter((r) => r.riskStatus === "warn").map((r) => r.trader);
  if (breach.length) out.push(`Риск: лимиты нарушены у ${breach.join(", ")}${warn.length ? `; на грани — ${warn.join(", ")}` : ""}.`);
  else if (warn.length) out.push(`Риск: нарушений нет, на грани лимитов — ${warn.join(", ")}.`);
  else if (rows.some((r) => r.riskStatus === "ok")) out.push("Риск: лимиты не нарушались.");

  const worse = active.filter((r) => r.verdict === "worse").map((r) => r.trader);
  if (worse.length) out.push(`Тренд: ${worse.join(", ")} — хуже своих прошлых 4 недель.`);

  if (out.length < limit) out.push(`Разбор: ${s.reviewed} из ${s.traders} недель разобрано куратором${s.submitted ? `, ${s.submitted} ждут разбора` : ""}.`);
  return out.slice(0, limit);
}
