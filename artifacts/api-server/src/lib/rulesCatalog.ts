/**
 * Каталог видов правил дисциплины (чистый модуль, без БД).
 *
 * - `auto: true`  — правило проверяется само по сделкам из бэк-офиса (время входа/выхода, размер, нетто P&L, исполнения).
 * - `auto: false` — самооценка: трейдер отмечает «соблюдал / нарушил» раз в день (чекбокс в журнале, таблица rule_self_checks).
 * - `needs`       — какие данные сделки нужны для проверки; если их нет ни у одной сделки периода, правило «не проверяемо»,
 *                   а не «100% соблюдено».
 * - Поля порога: number (положительное число), time (HHMM как число: 935 = 9:35 ET), tickers (список тикеров).
 *   Пустое необязательное поле с `riskLimit` берёт значение из лимитов риск-деска (trader_risk_limits).
 *
 * Первые 11 видов — исторический контракт (RULE_KINDS в lib/rulesEngine, тесты на порядок/типы); новые идут после.
 */

export type RuleFieldType = "number" | "time" | "tickers";
export type RiskLimitKey = "daily_loss_limit" | "max_position_usd" | "max_risk_per_trade";
export type RuleNeed = "pnl" | "time" | "hold" | "size" | "qty" | "executions" | "stop" | "checklist";
export type RuleGroup = "volume" | "loss" | "time" | "size" | "process" | "self";

export interface CatalogField {
  key: string;
  label: string;
  type: RuleFieldType;
  /** number/time → число; tickers → [] */
  default: number | string[];
  optional?: boolean;
  riskLimit?: RiskLimitKey;
  unit?: string;
}

export interface RuleKindMeta {
  kind: string;
  label: string;
  hint: string;
  group: RuleGroup;
  auto: boolean;
  needs: RuleNeed[];
  fields: CatalogField[];
  /** Исторический вид (входит в RULE_KINDS). */
  legacy?: boolean;
}

export const RULE_GROUPS: Record<RuleGroup, string> = {
  volume: "Количество сделок",
  loss: "Убытки и тильт",
  time: "Время",
  size: "Размер позиции",
  process: "Процесс",
  self: "Самооценка",
};

const n = (key: string, label: string, def: number, extra: Partial<CatalogField> = {}): CatalogField => ({ key, label, type: "number", default: def, ...extra });

export const RULE_CATALOG: RuleKindMeta[] = [
  // ── Исторические виды (порядок и типы полей зафиксированы тестами) ──────────────────────────────
  { kind: "max_trades_per_day", label: "Макс. сделок в день", hint: "Овертрейдинг: каждая сделка сверх лимита — нарушение", group: "volume", auto: true, needs: [], legacy: true,
    fields: [n("n", "N сделок", 5)] },
  { kind: "no_trade_after_n_losses", label: "Стоп после N убытков подряд", hint: "Тильт-стоп внутри дня: сделки после серии убытков — нарушение", group: "loss", auto: true, needs: ["pnl"], legacy: true,
    fields: [n("n", "N убытков", 3)] },
  { kind: "max_daily_loss_usd", label: "Дневной лимит убытка ($, нетто)", hint: "Сделки после достижения лимита — нарушение. Пусто — лимит из риск-деска", group: "loss", auto: true, needs: ["pnl"], legacy: true,
    fields: [n("usd", "$ в день", 500, { optional: true, riskLimit: "daily_loss_limit", unit: "$" })] },
  { kind: "max_loss_per_day_pct", label: "Дневной лимит убытка (% капитала)", hint: "Процент от капитала, нетто", group: "loss", auto: true, needs: ["pnl"], legacy: true,
    fields: [n("pct", "%", 2, { unit: "%" }), n("capital", "Капитал ($)", 50000, { unit: "$" })] },
  { kind: "max_position_usd", label: "Макс. размер позиции ($)", hint: "Позиция × цена по исполнениям; пусто — лимит риск-деска", group: "size", auto: true, needs: ["size"], legacy: true,
    fields: [n("usd", "$ позиции", 20000, { optional: true, riskLimit: "max_position_usd", unit: "$" })] },
  { kind: "position_size_pct", label: "Размер позиции, % капитала", hint: "Процент от капитала", group: "size", auto: true, needs: ["size"], legacy: true,
    fields: [n("pct", "%", 10, { unit: "%" }), n("capital", "Капитал ($)", 50000, { unit: "$" })] },
  { kind: "max_risk_per_trade_usd", label: "Макс. риск на сделку ($)", hint: "Нужен стоп: |вход − стоп| × qty. Без стопов используйте «Макс. убыток на сделку»", group: "loss", auto: true, needs: ["stop"], legacy: true,
    fields: [n("usd", "$ риска", 200, { optional: true, riskLimit: "max_risk_per_trade", unit: "$" })] },
  { kind: "max_consecutive_losses", label: "Макс. убытков подряд (через дни)", hint: "Серия убытков, переходящая через дни", group: "loss", auto: true, needs: ["pnl"], legacy: true,
    fields: [n("n", "N убытков", 4)] },
  { kind: "no_overnight", label: "Без переноса через ночь", hint: "Любая не-интрадей сделка — нарушение", group: "process", auto: true, needs: [], legacy: true, fields: [] },
  { kind: "no_swing", label: "Без свинг-сделок", hint: "Горизонт swing — нарушение", group: "process", auto: true, needs: [], legacy: true, fields: [] },
  { kind: "trade_without_checklist", label: "Сделка без чеклиста", hint: "Только для сделок, внесённых вручную с чеклистом", group: "process", auto: true, needs: ["checklist"], legacy: true, fields: [] },

  // ── Новые виды ────────────────────────────────────────────────────────────────────────────────────
  { kind: "max_trades_per_ticker_day", label: "Макс. входов в один тикер за день", hint: "Повторные заходы в тот же тикер сверх лимита", group: "volume", auto: true, needs: [],
    fields: [n("n", "N входов", 2)] },
  { kind: "max_loss_per_trade_usd", label: "Макс. убыток на сделку ($)", hint: "Убыток сделки больше лимита. Работает без стопов. Пусто — макс. риск из риск-деска", group: "loss", auto: true, needs: ["pnl"],
    fields: [n("usd", "$ убытка", 100, { optional: true, riskLimit: "max_risk_per_trade", unit: "$" })] },
  { kind: "min_pause_after_loss", label: "Пауза после убыточной сделки", hint: "Вход раньше чем через N минут после убыточного выхода — реванш", group: "loss", auto: true, needs: ["pnl", "time"],
    fields: [n("min", "Минут", 10, { unit: "мин" })] },
  { kind: "no_size_up_after_loss", label: "Не увеличивать размер после убытка", hint: "Нотионал ≥ ×K от предыдущей убыточной сделки того же дня", group: "loss", auto: true, needs: ["pnl", "size"],
    fields: [n("factor", "Множитель K", 1.3, { unit: "×" })] },
  { kind: "no_trade_first_minutes", label: "Не торговать первые N минут", hint: "Вход в первые N минут после открытия 9:30 ET", group: "time", auto: true, needs: ["time"],
    fields: [n("n", "Минут", 5, { unit: "мин" })] },
  { kind: "trading_window", label: "Торговать только в окне времени", hint: "Вход вне окна (время Нью-Йорка) — нарушение", group: "time", auto: true, needs: ["time"],
    fields: [{ key: "start", label: "С", type: "time", default: 930 }, { key: "end", label: "До", type: "time", default: 1555 }] },
  { kind: "min_hold_seconds", label: "Минимальное удержание", hint: "Сделки, закрытые быстрее N секунд (импульсивные входы-выходы)", group: "time", auto: true, needs: ["hold"],
    fields: [n("sec", "Секунд", 30, { unit: "сек" })] },
  { kind: "max_position_shares", label: "Макс. размер позиции (акций)", hint: "Количество акций в сделке больше лимита", group: "size", auto: true, needs: ["qty"],
    fields: [n("qty", "Акций", 500)] },
  { kind: "no_averaging_down", label: "Без усреднения убытка", hint: "Добор против позиции по худшей цене. Нужны исполнения с доборами", group: "size", auto: true, needs: ["executions"], fields: [] },
  { kind: "banned_tickers", label: "Запрещённые тикеры", hint: "Сделка в тикере из списка — нарушение", group: "process", auto: true, needs: [],
    fields: [{ key: "tickers", label: "Тикеры", type: "tickers", default: [] }] },
  { kind: "self_check", label: "Самооценка (отмечается в журнале)", hint: "Нельзя проверить по сделкам: трейдер раз в день отмечает «соблюдал / нарушил»", group: "self", auto: false, needs: [], fields: [] },
];

export const CATALOG_BY_KIND = new Map(RULE_CATALOG.map((k) => [k.kind, k]));

export function kindMeta(kind: string): RuleKindMeta | undefined {
  return CATALOG_BY_KIND.get(kind);
}

/** HHMM-число → минуты от полуночи (935 → 575); null, если некорректно. */
export function hhmmToMinutes(v: unknown): number | null {
  const x = typeof v === "string" ? Number(v.replace(":", "")) : Number(v);
  if (!Number.isInteger(x) || x < 0 || x > 2359) return null;
  const h = Math.floor(x / 100);
  const m = x % 100;
  if (m > 59 || h > 23) return null;
  return h * 60 + m;
}

export function fmtHHMM(v: unknown): string {
  const m = hhmmToMinutes(v);
  if (m == null) return "—";
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

const TICKER_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;

/** Нормализует список тикеров (массив или строка через запятую/пробел): верхний регистр, уникальные, ≤ 50. */
export function normTickers(v: unknown): string[] | null {
  const raw = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[\s,;]+/) : null;
  if (!raw) return null;
  const out: string[] = [];
  for (const x of raw) {
    const t = String(x ?? "").trim().toUpperCase().replace(/^\$/, "");
    if (!t) continue;
    if (!TICKER_RE.test(t)) return null;
    if (!out.includes(t)) out.push(t);
  }
  return out.length > 50 ? null : out;
}

export type ThresholdValue = number | string[];

/**
 * Проверка порога по полям вида. Обязательные пустые поля получают значение по умолчанию; необязательные пустые
 * пропускаются (действует лимит риск-деска).
 */
export function validateThreshold(kind: string, threshold: unknown): { ok: true; value: Record<string, ThresholdValue> } | { ok: false; error: string } {
  const def = kindMeta(kind);
  if (!def) return { ok: false, error: "Invalid kind" };
  if (threshold != null && (typeof threshold !== "object" || Array.isArray(threshold))) return { ok: false, error: "Invalid threshold" };
  const src = (threshold ?? {}) as Record<string, unknown>;
  const out: Record<string, ThresholdValue> = {};
  for (const f of def.fields) {
    const raw = src[f.key];
    const empty = raw === undefined || raw === null || raw === "" || (typeof raw === "number" && Number.isNaN(raw)) || (Array.isArray(raw) && raw.length === 0);
    if (f.type === "tickers") {
      if (empty) return { ok: false, error: `Укажите хотя бы один тикер в поле «${f.label}»` };
      const list = normTickers(raw);
      if (!list || !list.length) return { ok: false, error: `«${f.label}»: тикеры латиницей через запятую (до 50)` };
      out[f.key] = list;
      continue;
    }
    if (empty) {
      if (f.optional) continue;
      out[f.key] = f.default as number;
      continue;
    }
    if (f.type === "time") {
      const m = hhmmToMinutes(raw);
      if (m == null) return { ok: false, error: `«${f.label}»: время в формате ЧЧ:ММ` };
      out[f.key] = Math.floor(m / 60) * 100 + (m % 60);
      continue;
    }
    const v = Number(raw);
    if (!Number.isFinite(v) || v <= 0) return { ok: false, error: `«${f.label}» должно быть числом больше 0` };
    out[f.key] = v;
  }
  if (kind === "trading_window") {
    const s = hhmmToMinutes(out.start);
    const e = hhmmToMinutes(out.end);
    if (s != null && e != null && e <= s) return { ok: false, error: "Окно: «До» должно быть позже «С»" };
  }
  if (kind === "no_size_up_after_loss" && typeof out.factor === "number" && out.factor < 1) {
    return { ok: false, error: "Множитель должен быть не меньше 1" };
  }
  return { ok: true, value: out };
}

const usdText = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;

/** Короткое описание порога для списков: «≤ 5 сделок/день», «9:35–15:55 ET», «AAPL, TSLA». */
export function describeThreshold(kind: string, threshold: Record<string, unknown> | null | undefined, limits?: { dailyLossLimit?: number | null; maxPositionUsd?: number | null; maxRiskPerTrade?: number | null }): string {
  const t = threshold ?? {};
  const num = (k: string) => {
    const v = Number(t[k]);
    return Number.isFinite(v) && v > 0 ? v : null;
  };
  const desk = (v: number | null | undefined) => (v != null ? `${usdText(v)} (риск-деск)` : "лимит риск-деска не задан");
  switch (kind) {
    case "max_trades_per_day": return `≤ ${num("n") ?? 5} сделок в день`;
    case "max_trades_per_ticker_day": return `≤ ${num("n") ?? 2} входов в тикер за день`;
    case "no_trade_after_n_losses": return `стоп после ${num("n") ?? 3} убытков подряд`;
    case "max_consecutive_losses": return `≤ ${num("n") ?? 4} убытков подряд`;
    case "max_daily_loss_usd": return num("usd") != null ? `дневной убыток ≤ ${usdText(num("usd")!)}` : `дневной убыток ≤ ${desk(limits?.dailyLossLimit)}`;
    case "max_loss_per_day_pct": return `дневной убыток ≤ ${num("pct") ?? 2}% от ${usdText(num("capital") ?? 50000)}`;
    case "max_loss_per_trade_usd": return num("usd") != null ? `убыток сделки ≤ ${usdText(num("usd")!)}` : `убыток сделки ≤ ${desk(limits?.maxRiskPerTrade)}`;
    case "max_risk_per_trade_usd": return num("usd") != null ? `риск ≤ ${usdText(num("usd")!)}` : `риск ≤ ${desk(limits?.maxRiskPerTrade)}`;
    case "max_position_usd": return num("usd") != null ? `позиция ≤ ${usdText(num("usd")!)}` : `позиция ≤ ${desk(limits?.maxPositionUsd)}`;
    case "position_size_pct": return `позиция ≤ ${num("pct") ?? 10}% от ${usdText(num("capital") ?? 50000)}`;
    case "max_position_shares": return `≤ ${(num("qty") ?? 500).toLocaleString("ru-RU")} акций`;
    case "min_pause_after_loss": return `пауза ≥ ${num("min") ?? 10} мин после убытка`;
    case "no_size_up_after_loss": return `после убытка размер < ×${num("factor") ?? 1.3}`;
    case "no_trade_first_minutes": {
      const end = 570 + (num("n") ?? 5);
      return `без входов 9:30–${Math.floor(end / 60)}:${String(Math.round(end % 60)).padStart(2, "0")} ET`;
    }
    case "trading_window": return `входы ${fmtHHMM(t.start ?? 930)}–${fmtHHMM(t.end ?? 1555)} ET`;
    case "min_hold_seconds": return `удержание ≥ ${num("sec") ?? 30} сек`;
    case "banned_tickers": {
      const list = Array.isArray(t.tickers) ? (t.tickers as unknown[]).map(String) : [];
      return list.length ? `запрет: ${list.slice(0, 6).join(", ")}${list.length > 6 ? ` +${list.length - 6}` : ""}` : "список пуст";
    }
    case "no_overnight": return "только интрадей";
    case "no_swing": return "без свингов";
    case "no_averaging_down": return "без доборов против позиции";
    case "trade_without_checklist": return "чеклист перед каждой сделкой";
    case "self_check": return "отмечается раз в день";
    default: return "";
  }
}
