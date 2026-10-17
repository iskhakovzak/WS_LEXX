/**
 * «Путь трейдера» — promotion engine (pure, no I/O).
 *
 * Ladder (user decision): Стажёр (trainee) → Джун (junior) → Трейдер (trader) → Сеньор (senior).
 * The pre-trainee selection / bootcamp is a separate funnel (agent F4), not a stage here.
 * Stage keys deliberately equal the scaling tiers of lib/scalingEngine.ts (DEFAULT_TIERS: trainee/junior/trader/senior),
 * so a stage borrows its tier's limits (daily loss, max drawdown, account size) for limit-based criteria.
 *
 * The window metrics that already exist in the scaling engine (net $, trades, PF, win rate, max DD, % of DD limit,
 * limit breaches, green days, violations, curator discipline rating) are computed BY the scaling engine
 * (computeWindowMetrics) — this file only adds what the academy needs on top:
 *   trading days, consistency (best day's share of profit), fee share of gross, longest red-day streak,
 *   behaviour discipline index (lib/behaviorEngine, optional), lessons / quizzes completion (F1, optional),
 *   passed evaluation challenges (lib/challengeEngine via the route).
 *
 * Conventions (shared with lib/tradeMath + scalingEngine): money is net of fees; win rate = W/(W+L) (BE excluded);
 * PF = Σ⁺/|Σ⁻|, null (never ∞) when there are no losses; dates are NY trading dates (YYYY-MM-DD).
 */
import {
  addDays, compare, computeWindowMetrics, isWeekend, progressOf, windowStart,
  type LimitsInput, type Op, type RatingInput, type Tier, type TradeInput, type TraderInput,
} from "./scalingEngine";

// ─── stages ─────────────────────────────────────────────────────────────────

export type StageKey = "trainee" | "junior" | "trader" | "senior";
export const STAGE_KEYS: readonly StageKey[] = ["trainee", "junior", "trader", "senior"];

export interface StageMeta {
  key: StageKey;
  name: string;
  order: number;
  description: string;
  /** scaling_tiers.key whose limits apply at this stage (null ⇒ none). */
  scalingTier: string | null;
}

export const DEFAULT_STAGES: StageMeta[] = [
  { key: "trainee", name: "Стажёр", order: 1, scalingTier: "trainee", description: "После отбора и буткемпа: минимальный размер, жёсткие лимиты, обучение и экзамены" },
  { key: "junior", name: "Джун", order: 2, scalingTier: "junior", description: "Капитал фирмы, малый лот, только интрадей" },
  { key: "trader", name: "Трейдер", order: 3, scalingTier: "trader", description: "Полноценный трейдер деска: интрадей + овернайт" },
  { key: "senior", name: "Сеньор", order: 4, scalingTier: "senior", description: "Полный BP, свинг, наставничество" },
];

export function isStageKey(v: unknown): v is StageKey {
  return typeof v === "string" && (STAGE_KEYS as readonly string[]).includes(v);
}

export function sortStages(stages: StageMeta[]): StageMeta[] {
  return [...stages].sort((a, b) => a.order - b.order || STAGE_KEYS.indexOf(a.key) - STAGE_KEYS.indexOf(b.key));
}

export function nextStageOf(stages: StageMeta[], key: StageKey | null): StageMeta | null {
  const s = sortStages(stages);
  if (!key) return s[0] ?? null;
  const i = s.findIndex((x) => x.key === key);
  return i >= 0 ? s[i + 1] ?? null : null;
}

// ─── metrics ────────────────────────────────────────────────────────────────

export type PromoMetricKey =
  | "net_pnl" | "trading_days" | "trades" | "max_dd_usd" | "max_dd_pct" | "consistency" | "win_rate" | "profit_factor"
  | "fee_share" | "violations" | "limit_breaches" | "red_streak_max" | "green_days_pct" | "discipline_index"
  | "rating_discipline" | "lessons_pct" | "quiz_avg" | "challenges_passed";

export type PromoUnit = "usd" | "count" | "pct" | "x" | "score100" | "score10" | "days";
export type MetricSource = "trades" | "rules" | "behavior" | "ratings" | "learning" | "challenges";

export interface PromoMetricMeta {
  key: PromoMetricKey;
  label: string;
  unit: PromoUnit;
  higherIsBetter: boolean;
  source: MetricSource;
  hint: string;
}

export const PROMO_METRICS: readonly PromoMetricMeta[] = [
  { key: "net_pnl", label: "P&L нетто", unit: "usd", higherIsBetter: true, source: "trades", hint: "Σ (pnl − |комиссии|) закрытых сделок окна; брокерские данные при наличии" },
  { key: "trading_days", label: "Торговых дней", unit: "days", higherIsBetter: true, source: "trades", hint: "Дни (NY) с хотя бы одной закрытой сделкой" },
  { key: "trades", label: "Закрытых сделок", unit: "count", higherIsBetter: true, source: "trades", hint: "Количество закрытых сделок в окне" },
  { key: "max_dd_usd", label: "Макс. просадка, $", unit: "usd", higherIsBetter: false, source: "trades", hint: "Пик-впадина накопленного нетто по дням" },
  { key: "max_dd_pct", label: "Просадка, % от лимита", unit: "pct", higherIsBetter: false, source: "trades", hint: "Макс. просадка / лимит просадки (лимиты трейдера или тира ступени)" },
  { key: "consistency", label: "Стабильность (доля лучшего дня)", unit: "pct", higherIsBetter: false, source: "trades", hint: "Лучший день / итоговая прибыль окна × 100. Нет прибыли ⇒ не выполнено" },
  { key: "win_rate", label: "Win rate", unit: "pct", higherIsBetter: true, source: "trades", hint: "W / (W + L), безубыточные не учитываются" },
  { key: "profit_factor", label: "Profit factor", unit: "x", higherIsBetter: true, source: "trades", hint: "Σ прибыли / |Σ убытков| в $; нет убытков ⇒ не определён (не ∞)" },
  { key: "fee_share", label: "Доля комиссий", unit: "pct", higherIsBetter: false, source: "trades", hint: "Σ |комиссий| / брутто P&L × 100. Брутто ≤ 0 ⇒ комиссии съели всё" },
  { key: "violations", label: "Нарушений правил", unit: "count", higherIsBetter: false, source: "rules", hint: "Записи rule_violations + журнал ошибок за окно" },
  { key: "limit_breaches", label: "Пробоев лимитов", unit: "count", higherIsBetter: false, source: "trades", hint: "Дни/недели с убытком больше лимита (лимиты трейдера или тира)" },
  { key: "red_streak_max", label: "Макс. серия красных дней", unit: "days", higherIsBetter: false, source: "trades", hint: "Самая длинная серия убыточных дней подряд в окне" },
  { key: "green_days_pct", label: "Доля зелёных дней", unit: "pct", higherIsBetter: true, source: "trades", hint: "Дни в плюсе / торговые дни" },
  { key: "discipline_index", label: "Индекс дисциплины", unit: "score100", higherIsBetter: true, source: "behavior", hint: "Средний дневной индекс поведенческого движка (0–100: реванш, мартингейл, тильт, овертрейдинг…)" },
  { key: "rating_discipline", label: "Оценка дисциплины куратором", unit: "score10", higherIsBetter: true, source: "ratings", hint: "Средняя недельная оценка «дисциплина» (1–10)" },
  { key: "lessons_pct", label: "Пройдено уроков", unit: "pct", higherIsBetter: true, source: "learning", hint: "Завершённые уроки программы / все обязательные уроки" },
  { key: "quiz_avg", label: "Средний балл тестов", unit: "pct", higherIsBetter: true, source: "learning", hint: "Средний лучший результат по тестам, %" },
  { key: "challenges_passed", label: "Сдано экзаменов", unit: "count", higherIsBetter: true, source: "challenges", hint: "Пройденные челленджи (экзамены) с начала ступени" },
];

export const PROMO_METRIC_BY_KEY: Record<PromoMetricKey, PromoMetricMeta> =
  Object.fromEntries(PROMO_METRICS.map((m) => [m.key, m])) as Record<PromoMetricKey, PromoMetricMeta>;
export const PROMO_METRIC_KEYS = PROMO_METRICS.map((m) => m.key) as [PromoMetricKey, ...PromoMetricKey[]];

// ─── criteria ───────────────────────────────────────────────────────────────

export interface Criterion {
  id: number;
  /** The stage these criteria are for — i.e. what is required to move from `fromStage` to the next one. */
  fromStage: StageKey;
  metric: PromoMetricKey;
  op: Op;
  value: number;
  /** Window in trading days ending today; null ⇒ since the stage started (or all history). */
  windowDays: number | null;
  label: string | null;
  enabled: boolean;
}

const c = (fromStage: StageKey, metric: PromoMetricKey, op: Op, value: number, windowDays: number | null, label: string): Omit<Criterion, "id"> =>
  ({ fromStage, metric, op, value, windowDays, label, enabled: true });

/** Seeded on first run into academy_stage_criteria, staff-editable afterwards. */
export const DEFAULT_CRITERIA: Omit<Criterion, "id">[] = [
  // Стажёр → Джун (20 торговых дней)
  c("trainee", "trading_days", ">=", 15, 20, "Минимум 15 торговых дней из 20"),
  c("trainee", "net_pnl", ">=", 300, 20, "P&L нетто ≥ $300 за 20 дней"),
  c("trainee", "max_dd_usd", "<=", 500, 20, "Просадка не больше $500"),
  c("trainee", "consistency", "<=", 40, 20, "Лучший день ≤ 40% прибыли"),
  c("trainee", "win_rate", ">=", 45, 20, "Win rate ≥ 45%"),
  c("trainee", "profit_factor", ">=", 1.2, 20, "Profit factor ≥ 1.2"),
  c("trainee", "fee_share", "<=", 50, 20, "Комиссии ≤ 50% брутто"),
  c("trainee", "violations", "<=", 2, 20, "Не больше 2 нарушений правил"),
  c("trainee", "red_streak_max", "<=", 4, 20, "Не больше 4 красных дней подряд"),
  c("trainee", "discipline_index", ">=", 70, 20, "Индекс дисциплины ≥ 70"),
  c("trainee", "lessons_pct", ">=", 80, null, "Пройдено ≥ 80% уроков"),
  c("trainee", "quiz_avg", ">=", 70, null, "Средний балл тестов ≥ 70%"),
  c("trainee", "challenges_passed", ">=", 1, null, "Сдан экзамен «Перевод Стажёр → Джун»"),
  // Джун → Трейдер (40 торговых дней)
  c("junior", "trading_days", ">=", 30, 40, "Минимум 30 торговых дней из 40"),
  c("junior", "net_pnl", ">=", 1500, 40, "P&L нетто ≥ $1 500 за 40 дней"),
  c("junior", "max_dd_pct", "<=", 50, 40, "Просадка ≤ 50% лимита"),
  c("junior", "consistency", "<=", 35, 40, "Лучший день ≤ 35% прибыли"),
  c("junior", "win_rate", ">=", 48, 40, "Win rate ≥ 48%"),
  c("junior", "profit_factor", ">=", 1.3, 40, "Profit factor ≥ 1.3"),
  c("junior", "fee_share", "<=", 40, 40, "Комиссии ≤ 40% брутто"),
  c("junior", "limit_breaches", "=", 0, 40, "Без пробоев лимитов"),
  c("junior", "violations", "<=", 1, 40, "Не больше 1 нарушения правил"),
  c("junior", "discipline_index", ">=", 75, 40, "Индекс дисциплины ≥ 75"),
  c("junior", "quiz_avg", ">=", 80, null, "Средний балл тестов ≥ 80%"),
  c("junior", "challenges_passed", ">=", 1, null, "Сдан экзамен «Перевод Джун → Трейдер»"),
  // Трейдер → Сеньор (60 торговых дней)
  c("trader", "trading_days", ">=", 50, 60, "Минимум 50 торговых дней из 60"),
  c("trader", "net_pnl", ">=", 6000, 60, "P&L нетто ≥ $6 000 за 60 дней"),
  c("trader", "profit_factor", ">=", 1.5, 60, "Profit factor ≥ 1.5"),
  c("trader", "consistency", "<=", 30, 60, "Лучший день ≤ 30% прибыли"),
  c("trader", "max_dd_pct", "<=", 50, 60, "Просадка ≤ 50% лимита"),
  c("trader", "fee_share", "<=", 30, 60, "Комиссии ≤ 30% брутто"),
  c("trader", "green_days_pct", ">=", 55, 60, "Зелёных дней ≥ 55%"),
  c("trader", "limit_breaches", "=", 0, 60, "Без пробоев лимитов"),
  c("trader", "discipline_index", ">=", 80, 60, "Индекс дисциплины ≥ 80"),
];

// ─── input ──────────────────────────────────────────────────────────────────

export interface PromoTrade extends TradeInput {
  /** Gross P&L (pnl), null when unknown. */
  gross: number | null;
  /** |fees| (0 when unknown). */
  fees: number;
}

export interface LearningInput {
  lessonsTotal: number;
  lessonsDone: number;
  /** Average best score per quiz, 0–100 (null when no quiz was taken). */
  quizAvg: number | null;
  quizzesTaken: number;
}

export interface PromotionInput {
  user: string;
  stage: StageKey | null;
  /** YYYY-MM-DD when the current stage started (null ⇒ unknown). */
  stageSince: string | null;
  today: string;
  trades: PromoTrade[];
  violationDates: string[];
  ratings: RatingInput[];
  limits: LimitsInput | null;
  /** Behaviour engine daily discipline scores; null ⇒ engine unavailable. */
  disciplineDays: { date: string; score: number }[] | null;
  /** F1 learning progress; null ⇒ content module not installed. */
  learning: LearningInput | null;
  /** Dates (YYYY-MM-DD) on which evaluation challenges were passed; null ⇒ challenges not available. */
  challengesPassed: string[] | null;
}

export interface MetricOut {
  value: number | null;
  note?: string;
  /** true ⇒ the data source is not installed (criterion is not counted). */
  unavailable?: boolean;
}

// ─── date helpers ───────────────────────────────────────────────────────────

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const r2 = (x: number) => Math.round(x * 100) / 100;

/** Weekdays in [from, to] inclusive (holidays not considered). */
export function tradingDaysBetween(from: string, to: string): number {
  if (!YMD.test(from) || !YMD.test(to) || from > to) return 0;
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) if (!isWeekend(d)) n++;
  return n;
}

/** Window length in trading days for a criterion (null window ⇒ since stage start, else ~1 year). */
export function resolveWindow(windowDays: number | null, stageSince: string | null, today: string): number {
  if (windowDays != null && windowDays > 0) return Math.round(windowDays);
  if (stageSince && YMD.test(stageSince) && stageSince <= today) return Math.max(1, tradingDaysBetween(stageSince, today));
  return 260;
}

// ─── metric computation ─────────────────────────────────────────────────────

/** Longest run of consecutive negative values. */
export function maxRun(values: number[], pred: (v: number) => boolean): number {
  let best = 0, cur = 0;
  for (const v of values) {
    if (pred(v)) { cur++; if (cur > best) best = cur; } else cur = 0;
  }
  return best;
}

/** Consistency = best day's net / total net × 100; null when the total is not positive. */
export function consistencyPct(dayNets: number[]): number | null {
  const total = dayNets.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return null;
  const best = Math.max(...dayNets);
  return best > 0 ? (best / total) * 100 : 0;
}

/** Fee share = Σ|fees| / gross × 100; null when there is no money; ≥ 100 means fees ate the whole gross. */
export function feeSharePct(gross: number, fees: number): number | null {
  if (fees <= 0 && gross === 0) return null;
  if (gross <= 0) return fees > 0 ? 100 : null;
  return (fees / gross) * 100;
}

/**
 * All promotion metrics over a window of `windowDays` trading days ending `today`.
 * Window metrics shared with the scaling plan come from scalingEngine.computeWindowMetrics (same numbers on /scaling).
 */
export function computePromoMetrics(input: PromotionInput, tier: Tier | null, windowDays: number, today = input.today): Record<PromoMetricKey, MetricOut> {
  const scalingInput: TraderInput = {
    trader: input.user,
    tierKey: tier?.key ?? null,
    limits: input.limits,
    trades: input.trades,
    ratings: input.ratings,
    violationDates: input.violationDates,
    today,
  };
  const w = computeWindowMetrics(scalingInput, tier, windowDays);
  const from = w.from;
  const inWin = (d: string) => YMD.test(d) && d >= from && d <= today;

  // Money rows follow the scaling engine's choice (broker rows when the trader has any).
  const rows = input.trades.filter((t) => inWin(t.date) && (w.moneySource === "propreports" ? t.source === "propreports" : true));
  const moneyRows = rows.filter((t) => t.net != null);
  const dayNet = new Map<string, number>();
  let gross = 0, fees = 0, grossKnown = 0;
  for (const t of moneyRows) {
    dayNet.set(t.date, (dayNet.get(t.date) ?? 0) + (t.net as number));
    if (t.gross != null) { gross += t.gross; fees += Math.abs(t.fees || 0); grossKnown++; }
  }
  const tradeDays = new Set(input.trades.filter((t) => inWin(t.date)).map((t) => t.date));
  const days = [...dayNet.keys()].sort();
  const series = days.map((d) => dayNet.get(d) as number);

  const val = (k: keyof typeof w.values): MetricOut => ({ value: w.values[k].value, note: w.values[k].note });

  const disc = input.disciplineDays;
  const discWin = disc ? disc.filter((d) => inWin(d.date)) : null;
  const discAvg = discWin && discWin.length ? discWin.reduce((s, d) => s + d.score, 0) / discWin.length : null;

  const L = input.learning;
  const since = input.stageSince && YMD.test(input.stageSince) ? input.stageSince : null;
  const passed = input.challengesPassed;

  const cons = moneyRows.length ? consistencyPct(series) : null;
  const fee = grossKnown ? feeSharePct(gross, fees) : null;

  return {
    net_pnl: val("net_pnl"),
    trading_days: { value: tradeDays.size },
    trades: val("trades"),
    max_dd_usd: val("max_dd_usd"),
    max_dd_pct: val("max_dd_pct"),
    consistency: {
      value: cons == null ? null : r2(cons),
      note: !moneyRows.length ? "нет данных по $" : cons == null ? "нет прибыли за окно" : undefined,
    },
    win_rate: val("win_rate"),
    profit_factor: val("profit_factor"),
    fee_share: { value: fee == null ? null : r2(fee), note: fee == null ? "нет данных по $" : gross <= 0 ? "брутто ≤ 0 — комиссии съели весь результат" : undefined },
    violations: val("violations"),
    limit_breaches: val("limit_breaches"),
    red_streak_max: { value: series.length ? maxRun(series, (v) => v < 0) : null, note: series.length ? undefined : "нет данных по $" },
    green_days_pct: val("green_days_pct"),
    discipline_index: disc == null
      ? { value: null, unavailable: true, note: "поведенческий движок недоступен" }
      : { value: discAvg == null ? null : r2(discAvg), note: discAvg == null ? "нет сделок со временем входа" : `${discWin!.length} дн.` },
    rating_discipline: { value: w.values.discipline.value, note: w.values.discipline.note },
    lessons_pct: L == null
      ? { value: null, unavailable: true, note: "модуль обучения не подключён" }
      : { value: L.lessonsTotal > 0 ? r2((L.lessonsDone / L.lessonsTotal) * 100) : null, note: L.lessonsTotal > 0 ? `${L.lessonsDone} из ${L.lessonsTotal}` : "в программе нет уроков" },
    quiz_avg: L == null
      ? { value: null, unavailable: true, note: "модуль обучения не подключён" }
      : { value: L.quizAvg == null ? null : r2(L.quizAvg), note: L.quizzesTaken ? `${L.quizzesTaken} тест(ов)` : "тесты не сданы" },
    challenges_passed: passed == null
      ? { value: null, unavailable: true, note: "экзамены недоступны" }
      : { value: passed.filter((d) => YMD.test(d) && (!since || d >= since) && d <= today).length },
  };
}

// ─── formatting & advice ────────────────────────────────────────────────────

export function formatPromo(key: PromoMetricKey, v: number | null): string {
  if (v == null) return "—";
  switch (PROMO_METRIC_BY_KEY[key].unit) {
    case "usd": return `${v < 0 ? "−" : ""}$${Math.abs(v).toLocaleString("ru-RU", { maximumFractionDigits: 0 })}`;
    case "pct": return `${v.toFixed(0)}%`;
    case "x": return `${v.toFixed(2)}×`;
    case "score100": return `${v.toFixed(0)}/100`;
    case "score10": return `${v.toFixed(1)}/10`;
    default: return v.toLocaleString("ru-RU", { maximumFractionDigits: 0 });
  }
}

const OP_TEXT: Record<Op, string> = { ">=": "≥", ">": ">", "<=": "≤", "<": "<", "=": "=" };

export interface AdviceCtx {
  windowDays: number;
  tradingDaysLeftHint?: number;
  bestDay?: number | null;
  totalNet?: number | null;
  grossLoss?: number | null;
  grossProfit?: number | null;
  wins?: number;
  losses?: number;
  gross?: number | null;
  fees?: number | null;
}

/** "What to improve" for a failing criterion — concrete numbers where they can be derived. */
export function adviceFor(metric: PromoMetricKey, op: Op, actual: number | null, target: number, ctx: AdviceCtx): string {
  const usd = (x: number) => formatPromo("net_pnl", x);
  switch (metric) {
    case "net_pnl":
      return actual == null ? "Нет сделок с P&L в окне — торгуйте и импортируйте отчёт PropReports." :
        `Не хватает ${usd(Math.max(0, target - actual))} нетто за ${ctx.windowDays} торговых дней (≈ ${usd(Math.max(0, target - actual) / Math.max(1, ctx.windowDays))} в день сверх текущего).`;
    case "trading_days":
      return `Нужно ещё ${Math.max(0, Math.ceil(target - (actual ?? 0)))} торговых дней в окне ${ctx.windowDays} дн. — торгуйте регулярно, пропуски не засчитываются.`;
    case "trades":
      return `Нужно ещё ${Math.max(0, Math.ceil(target - (actual ?? 0)))} закрытых сделок.`;
    case "max_dd_usd":
      return actual == null ? "Нет данных по $." : `Просадка ${usd(actual)} при допуске ${usd(target)}: уменьшите риск на сделку и останавливайтесь после 2–3 убытков подряд, пока окно не «перекатится».`;
    case "max_dd_pct":
      return actual == null ? "Не задан лимит просадки или нет данных по $." : `Просадка ${actual.toFixed(0)}% лимита (нужно ${OP_TEXT[op]} ${target}%): режьте размер после красных дней.`;
    case "consistency": {
      if (actual == null) return "За окно нет прибыли — сначала выйдите в плюс, затем добирайте ровными днями.";
      const best = ctx.bestDay ?? null, total = ctx.totalNet ?? null;
      if (best != null && total != null && target > 0) {
        const need = best / (target / 100) - total;
        return `Лучший день даёт ${actual.toFixed(0)}% прибыли (нужно ≤ ${target}%). Добавьте ещё ≈ ${usd(Math.max(0, need))} прибыли в других днях, не превышая лучший день — ровная серия вместо одного «джекпота».`;
      }
      return `Лучший день — ${actual.toFixed(0)}% прибыли, нужно ≤ ${target}%: распределяйте результат по дням.`;
    }
    case "win_rate": {
      const w = ctx.wins ?? 0, l = ctx.losses ?? 0;
      if (actual == null) return "Нет закрытых прибыльных/убыточных сделок.";
      const p = target / 100;
      const needWins = p < 1 ? Math.max(0, Math.ceil((p * (w + l) - w) / (1 - p))) : 0;
      return `Win rate ${actual.toFixed(0)}% (${w}W/${l}L), нужно ${OP_TEXT[op]} ${target}%: ≈ ${needWins} прибыльных сделок подряд без убытков, либо жёстче фильтр входа (только A-сетапы).`;
    }
    case "profit_factor": {
      if (actual == null) return "PF не определён (нет убыточных сделок или сделок нет) — критерий засчитается, когда появится статистика.";
      const gl = Math.abs(ctx.grossLoss ?? 0), gp = ctx.grossProfit ?? 0;
      return gl > 0 ? `PF ${actual.toFixed(2)} при цели ${target}: нужно Σ прибыли ≥ ${usd(target * gl)} (сейчас ${usd(gp)}) — либо срезать убытки на ${usd(Math.max(0, gl - gp / target))}. Держите прибыльные дольше, стоп — без усреднения.` :
        `PF ${actual.toFixed(2)}, нужно ${target}.`;
    }
    case "fee_share": {
      if (actual == null) return "Нет данных по комиссиям.";
      return (ctx.gross ?? 0) <= 0
        ? `Комиссии ${usd(ctx.fees ?? 0)} при брутто ${usd(ctx.gross ?? 0)}: меньше сделок, больше средний ход на сделку, избегайте скальпа на копейки.`
        : `Комиссии съедают ${actual.toFixed(0)}% брутто (нужно ≤ ${target}%): сократите число сделок и мелкие выходы, проверьте ECN-сборы в «Что-если» → «Комиссии».`;
    }
    case "violations":
      return `${actual ?? 0} нарушений правил в окне (допуск ${target}): разберите их на странице «Правила» и подтвердите выводы с куратором.`;
    case "limit_breaches":
      return `${actual ?? 0} пробоев дневного/недельного лимита: после достижения лимита торговля прекращается — без исключений.`;
    case "red_streak_max":
      return `Серия из ${actual ?? 0} красных дней (допуск ${target}): после 2 красных дней подряд — половинный размер и разбор с наставником.`;
    case "green_days_pct":
      return `Зелёных дней ${actual?.toFixed(0) ?? "—"}%, нужно ${target}%: закрывайте день в плюс раньше, не отдавайте утреннюю прибыль.`;
    case "discipline_index":
      return actual == null ? "Нет данных о времени входа — индекс не посчитать." : `Индекс ${actual.toFixed(0)}/100 (нужно ${target}): посмотрите «Поведение» — какие паттерны (реванш, тильт, овертрейдинг) снимают баллы.`;
    case "rating_discipline":
      return actual == null ? "Нет оценок куратора за окно." : `Оценка куратора ${actual.toFixed(1)}/10, нужно ${target}.`;
    case "lessons_pct":
      return `Пройдено ${actual?.toFixed(0) ?? 0}% уроков, нужно ${target}% — откройте «Обучение».`;
    case "quiz_avg":
      return actual == null ? "Тесты ещё не сданы — пройдите тесты в «Обучении»." : `Средний балл ${actual.toFixed(0)}%, нужно ${target}% — пересдайте слабые тесты.`;
    case "challenges_passed":
      return "Сдайте экзамен (челлендж) для этой ступени — его назначает наставник на странице «Экзамены».";
  }
}

// ─── evaluation ─────────────────────────────────────────────────────────────

export type CriterionStatus = "pass" | "fail" | "na";
export type Trend = "better" | "worse" | "flat";

export interface CriterionResult {
  id: number;
  metric: PromoMetricKey;
  label: string;
  hint: string;
  unit: PromoUnit;
  op: Op;
  target: number;
  windowDays: number;
  windowFrom: string;
  /** Human window: "20 торг. дн." / "с 2026-09-01 (начало ступени)" / "за всё время". */
  windowLabel: string;
  value: number | null;
  prevValue: number | null;
  display: string;
  targetDisplay: string;
  status: CriterionStatus;
  /** 0..1 towards passing. */
  progress: number;
  trend: Trend | null;
  note: string | null;
  /** What to improve (only for failing criteria). */
  advice: string | null;
}

export interface ReadinessReport {
  user: string;
  today: string;
  stage: StageMeta | null;
  nextStage: StageMeta | null;
  stageSince: string | null;
  passed: number;
  /** Criteria counted (enabled and their data source available). */
  total: number;
  ready: boolean;
  headline: string;
  criteria: CriterionResult[];
  /** Criteria whose source module is not installed (not counted). */
  skipped: CriterionResult[];
  summary: {
    windowDays: number;
    net: number | null;
    tradingDays: number;
    trades: number | null;
    winRate: number | null;
    profitFactor: number | null;
    maxDd: number | null;
    consistency: number | null;
    feeShare: number | null;
    disciplineIndex: number | null;
  };
}

function trendOf(meta: PromoMetricMeta, cur: number | null, prev: number | null): Trend | null {
  if (cur == null || prev == null) return null;
  const eps = Math.max(1e-9, Math.abs(prev) * 0.02);
  if (Math.abs(cur - prev) <= eps) return "flat";
  return (cur > prev) === meta.higherIsBetter ? "better" : "worse";
}

function adviceCtx(input: PromotionInput, windowDays: number, today: string): AdviceCtx {
  const from = windowStart(today, windowDays);
  const anyBroker = input.trades.some((t) => t.source === "propreports");
  const rows = input.trades.filter((t) => t.date >= from && t.date <= today && (!anyBroker || t.source === "propreports"));
  const dayNet = new Map<string, number>();
  let gp = 0, gl = 0, wins = 0, losses = 0, gross = 0, fees = 0;
  for (const t of rows) {
    if (t.result === "win") wins++; else if (t.result === "loss") losses++;
    if (t.net == null) continue;
    dayNet.set(t.date, (dayNet.get(t.date) ?? 0) + t.net);
    if (t.net > 0) gp += t.net; else gl += t.net;
    if (t.gross != null) { gross += t.gross; fees += Math.abs(t.fees || 0); }
  }
  const nets = [...dayNet.values()];
  return {
    windowDays,
    bestDay: nets.length ? Math.max(...nets) : null,
    totalNet: nets.length ? nets.reduce((a, b) => a + b, 0) : null,
    grossProfit: gp, grossLoss: gl, wins, losses, gross, fees,
  };
}

/**
 * Readiness report for moving `input.stage` → next stage.
 * Criteria of the current stage only; a criterion whose source is not installed is reported in `skipped`
 * and not counted. `ready` ⇔ every counted criterion passes (and there is at least one).
 */
export function evaluatePromotion(input: PromotionInput, criteriaIn: Criterion[], stagesIn: StageMeta[] = DEFAULT_STAGES, tiers: Tier[] = []): ReadinessReport {
  const stages = sortStages(stagesIn);
  const stage = input.stage ? stages.find((s) => s.key === input.stage) ?? null : null;
  const nextStage = nextStageOf(stages, input.stage);
  const tier = stage?.scalingTier ? tiers.find((t) => t.key === stage.scalingTier) ?? null : null;
  const today = input.today;

  const criteria = criteriaIn.filter((x) => x.enabled && input.stage != null && x.fromStage === input.stage);
  const cache = new Map<string, Record<PromoMetricKey, MetricOut>>();
  const metricsFor = (n: number, t: string) => {
    const k = `${n}|${t}`;
    let m = cache.get(k);
    if (!m) { m = computePromoMetrics(input, tier, n, t); cache.set(k, m); }
    return m;
  };

  const results: CriterionResult[] = [];
  const skipped: CriterionResult[] = [];
  for (const cr of criteria) {
    const meta = PROMO_METRIC_BY_KEY[cr.metric];
    if (!meta) continue;
    const n = resolveWindow(cr.windowDays, input.stageSince, today);
    const from = windowStart(today, n);
    const m = metricsFor(n, today)[cr.metric];
    // Previous equal window (trend). Not meaningful for cumulative learning/challenge counters.
    const prevable = meta.source !== "learning" && meta.source !== "challenges";
    const prev = prevable ? metricsFor(n, addDays(from, -1))[cr.metric] : null;
    const value = m.value;
    let status: CriterionStatus;
    if (m.unavailable) status = "na";
    else if (value == null) status = "fail";
    else status = compare(value, cr.op, cr.value) ? "pass" : "fail";
    const progress = status === "pass" ? 1 : value == null ? 0 : progressOf(value, cr.op, cr.value);
    const res: CriterionResult = {
      id: cr.id,
      metric: cr.metric,
      label: cr.label?.trim() || meta.label,
      hint: meta.hint,
      unit: meta.unit,
      op: cr.op,
      target: cr.value,
      windowDays: n,
      windowFrom: from,
      windowLabel: cr.windowDays != null && cr.windowDays > 0 ? `${n} торг. дн.` : input.stageSince ? `с ${input.stageSince} (начало ступени)` : "за всё время",
      value,
      prevValue: prev?.value ?? null,
      display: formatPromo(cr.metric, value),
      targetDisplay: `${OP_TEXT[cr.op]} ${formatPromo(cr.metric, cr.value)}`,
      status,
      progress: Math.round(progress * 1000) / 1000,
      trend: trendOf(meta, value, prev?.value ?? null),
      note: m.note ?? null,
      advice: status === "fail" ? adviceFor(cr.metric, cr.op, value, cr.value, adviceCtx(input, n, today)) : null,
    };
    (status === "na" ? skipped : results).push(res);
  }

  const passed = results.filter((r) => r.status === "pass").length;
  const total = results.length;
  const ready = !!nextStage && total > 0 && passed === total;
  let headline: string;
  if (!stage) headline = "Ступень не назначена";
  else if (!nextStage) headline = "Высшая ступень — дальнейшего перевода нет";
  else if (!total) headline = `Для ступени «${stage.name}» критерии не настроены`;
  else headline = ready ? `Готов к переводу на «${nextStage.name}»: ${passed} из ${total} критериев` : `Готов к переводу: ${passed} из ${total} критериев`;

  const sw = criteria.length ? Math.max(...criteria.map((x) => resolveWindow(x.windowDays, input.stageSince, today)).filter((x) => x < 260), 20) : 20;
  const s = metricsFor(sw, today);
  return {
    user: input.user,
    today,
    stage,
    nextStage,
    stageSince: input.stageSince,
    passed,
    total,
    ready,
    headline,
    criteria: results,
    skipped,
    summary: {
      windowDays: sw,
      net: s.net_pnl.value,
      tradingDays: s.trading_days.value ?? 0,
      trades: s.trades.value,
      winRate: s.win_rate.value,
      profitFactor: s.profit_factor.value,
      maxDd: s.max_dd_usd.value,
      consistency: s.consistency.value,
      feeShare: s.fee_share.value,
      disciplineIndex: s.discipline_index.value,
    },
  };
}
