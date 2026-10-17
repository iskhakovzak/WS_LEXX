/**
 * «Мои триггеры» — личные пороги поведения, которые трейдер задаёт сам («3 убытка подряд», «сделка < 2 мин после
 * убытка»…). Чистые функции без I/O: описание видов, валидация параметров и проверка по истории сделок.
 *
 * Проверка ретроспективная (real-time push не нужен): для каждого триггера — сколько раз сработал, в какие дни,
 * какие сделки «под триггером» (их стоило пропустить) и их Σ нетто. Если Σ нетто отрицательна — соблюдение
 * триггера сэкономило бы эти деньги. Деньги — нетто, торговая дата — NY (как в behaviorEngine).
 */
import type { BehaviorTrade } from "./behaviorEngine";

export type TriggerKind =
  | "loss_streak" | "quick_after_loss" | "max_trades_day" | "daily_loss" | "size_up_after_loss"
  | "after_big_win" | "long_loser_hold" | "red_morning" | "custom";

export type TriggerField = { key: string; label: string; default: number; min: number; max: number; step?: number; unit?: string };

export const TRIGGER_KINDS: { kind: TriggerKind; label: string; hint: string; fields: TriggerField[] }[] = [
  { kind: "loss_streak", label: "N убытков подряд", hint: "После N-го убытка подряд за день — стоп. Под триггером все сделки дня после серии.", fields: [{ key: "n", label: "Убытков подряд", default: 3, min: 2, max: 10 }] },
  { kind: "quick_after_loss", label: "Сделка вскоре после убытка", hint: "Вход раньше, чем через M минут после выхода из убыточной сделки.", fields: [{ key: "minutes", label: "Минут", default: 2, min: 1, max: 120, unit: "мин" }] },
  { kind: "max_trades_day", label: "Больше N сделок за день", hint: "Каждая сделка сверх N за день.", fields: [{ key: "n", label: "Сделок в день", default: 8, min: 1, max: 100 }] },
  { kind: "daily_loss", label: "Дневной убыток больше $X", hint: "После того как нетто дня опустилось до −$X, все следующие сделки дня — под триггером.", fields: [{ key: "usd", label: "Убыток, $", default: 300, min: 1, max: 1_000_000, unit: "$" }] },
  { kind: "size_up_after_loss", label: "Рост размера после убытка", hint: "Нотионал сделки ≥ ×K от предыдущей убыточной.", fields: [{ key: "ratio", label: "Во сколько раз", default: 1.3, min: 1.05, max: 10, step: 0.05, unit: "×" }] },
  { kind: "after_big_win", label: "Сделка сразу после крупного выигрыша", hint: "Вход раньше, чем через M минут после выигрыша ≥ $X.", fields: [{ key: "usd", label: "Выигрыш от, $", default: 100, min: 1, max: 1_000_000, unit: "$" }, { key: "minutes", label: "Минут", default: 15, min: 1, max: 240, unit: "мин" }] },
  { kind: "long_loser_hold", label: "Убыточная держится дольше M мин", hint: "Тайм-стоп: убыточная сделка с удержанием больше M минут.", fields: [{ key: "minutes", label: "Минут", default: 20, min: 1, max: 1440, unit: "мин" }] },
  { kind: "red_morning", label: "Красное утро", hint: "Если к 11:00 нетто ≤ −$X — сделки после 11:00 под триггером.", fields: [{ key: "usd", label: "Убыток утра, $", default: 150, min: 1, max: 1_000_000, unit: "$" }] },
  { kind: "custom", label: "Напоминание", hint: "Текстовое правило без автоматической проверки.", fields: [] },
];

export const TRIGGER_KIND_SET = new Set<string>(TRIGGER_KINDS.map((k) => k.kind));

/** Параметры по описанию вида: недостающие — по умолчанию, вне диапазона — ошибка. */
export function validateTriggerParams(kind: string, raw: unknown): { ok: true; value: Record<string, number> } | { ok: false; error: string } {
  const def = TRIGGER_KINDS.find((k) => k.kind === kind);
  if (!def) return { ok: false, error: "Неизвестный вид триггера" };
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: Record<string, number> = {};
  for (const f of def.fields) {
    const v = src[f.key];
    if (v === undefined || v === null || v === "") { out[f.key] = f.default; continue; }
    const n = Number(v);
    if (!Number.isFinite(n) || n < f.min || n > f.max) return { ok: false, error: `«${f.label}»: число от ${f.min} до ${f.max}` };
    out[f.key] = Math.round(n * 100) / 100;
  }
  return { ok: true, value: out };
}

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};

/** Человекочитаемое название триггера по параметрам («3 убытка подряд»). */
export function describeTrigger(kind: string, p: Record<string, number>): string {
  switch (kind) {
    case "loss_streak": return `${p.n} ${plural(p.n, "убыток", "убытка", "убытков")} подряд`;
    case "quick_after_loss": return `Сделка < ${p.minutes} мин после убытка`;
    case "max_trades_day": return `Больше ${p.n} ${plural(p.n, "сделки", "сделок", "сделок")} за день`;
    case "daily_loss": return `Дневной убыток ≥ $${p.usd}`;
    case "size_up_after_loss": return `Размер ×${p.ratio}+ после убытка`;
    case "after_big_win": return `Сделка < ${p.minutes} мин после выигрыша ≥ $${p.usd}`;
    case "long_loser_hold": return `Убыточная дольше ${p.minutes} мин`;
    case "red_morning": return `Утро ≤ −$${p.usd} → после 11:00 не торгую`;
    default: return "Напоминание";
  }
}

export type TriggerHit = { id: number; ticker: string; date: string; net: number | null; note: string };

export type TriggerEval = {
  /** Сколько раз сработал (по сделкам или по дням — зависит от вида). */
  fires: number;
  days: number;
  /** Сделки «под триггером». */
  trades: number;
  /** Σ нетто сделок под триггером (отрицательная = соблюдение сэкономило бы). */
  net: number | null;
  tradeIds: number[];
  firstDate: string | null;
  lastDate: string | null;
  /** Последние даты срабатывания (до 30) — для полоски на карточке. */
  recentDates: string[];
  examples: TriggerHit[];
  evaluable: boolean;
};

const fmtUsd = (v: number | null) => (v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}$${Math.abs(v).toFixed(0)}`);
const notional = (t: BehaviorTrade) => (t.qty == null ? null : t.entry != null && t.entry > 0 ? Math.abs(t.qty) * t.entry : Math.abs(t.qty));

/** Проверка одного триггера по сделкам, сгруппированным по дням в порядке входа (behaviorEngine.groupByDay). */
export function evaluateTrigger(kind: string, p: Record<string, number>, byDay: Map<string, BehaviorTrade[]>): TriggerEval {
  const hits: { t: BehaviorTrade; note: string }[] = [];
  const fireDays = new Set<string>();
  let fires = 0;
  const evaluable = kind !== "custom" && TRIGGER_KIND_SET.has(kind);

  if (evaluable) {
    for (const [date, day] of byDay) {
      switch (kind) {
        case "loss_streak": {
          let streak = 0;
          for (let i = 0; i < day.length; i++) {
            const t = day[i];
            if (t.result === "loss") streak++; else if (t.result === "win" || t.result === "be") streak = 0;
            if (streak >= p.n) {
              fires++; fireDays.add(date);
              for (const a of day.slice(i + 1)) hits.push({ t: a, note: `после ${p.n} убытков подряд (с ${t.ticker})` });
              break;
            }
          }
          break;
        }
        case "quick_after_loss": {
          for (let i = 1; i < day.length; i++) {
            const prev = day[i - 1], t = day[i];
            if (prev.result !== "loss" || prev.exitAt == null || t.entryAt == null) continue;
            const gap = (t.entryAt - prev.exitAt) / 60000;
            if (gap >= 0 && gap < p.minutes) {
              fires++; fireDays.add(date);
              hits.push({ t, note: `${gap < 1 ? "<1" : Math.round(gap)} мин после убытка ${prev.ticker} (${fmtUsd(prev.net)})` });
            }
          }
          break;
        }
        case "max_trades_day": {
          if (day.length > p.n) {
            fires++; fireDays.add(date);
            day.slice(p.n).forEach((t, i) => hits.push({ t, note: `сделка №${p.n + i + 1} из ${day.length}` }));
          }
          break;
        }
        case "daily_loss": {
          let cum = 0;
          for (let i = 0; i < day.length; i++) {
            cum += day[i].net ?? 0;
            if (cum <= -p.usd) {
              fires++; fireDays.add(date);
              for (const a of day.slice(i + 1)) hits.push({ t: a, note: `день уже ${fmtUsd(Math.round(cum))}` });
              break;
            }
          }
          break;
        }
        case "size_up_after_loss": {
          for (let i = 1; i < day.length; i++) {
            const prev = day[i - 1], t = day[i];
            if (prev.result !== "loss") continue;
            const n0 = notional(prev), n1 = notional(t);
            if (n0 && n1 && n1 / n0 >= p.ratio) {
              fires++; fireDays.add(date);
              hits.push({ t, note: `размер ×${(n1 / n0).toFixed(1)} после убытка ${prev.ticker}` });
            }
          }
          break;
        }
        case "after_big_win": {
          let lastBig: BehaviorTrade | null = null;
          for (const t of day) {
            if (lastBig?.exitAt != null && t.entryAt != null) {
              const gap = (t.entryAt - lastBig.exitAt) / 60000;
              if (gap >= 0 && gap < p.minutes) {
                fires++; fireDays.add(date);
                hits.push({ t, note: `${gap < 1 ? "<1" : Math.round(gap)} мин после выигрыша ${lastBig.ticker} (${fmtUsd(lastBig.net)})` });
              }
            }
            if (t.result === "win" && (t.net ?? 0) >= p.usd) lastBig = t;
          }
          break;
        }
        case "long_loser_hold": {
          for (const t of day) {
            if (t.result === "loss" && t.holdMin != null && t.holdMin > p.minutes) {
              fires++; fireDays.add(date);
              hits.push({ t, note: `удержание ${Math.round(t.holdMin)} мин` });
            }
          }
          break;
        }
        case "red_morning": {
          let morning = 0, any = false;
          for (const t of day) if (t.entryMin != null && t.entryMin < 660) { morning += t.net ?? 0; any = true; }
          if (any && morning <= -p.usd) {
            const later = day.filter((t) => t.entryMin != null && t.entryMin >= 660);
            fires++; fireDays.add(date);
            for (const t of later) hits.push({ t, note: `утро ${fmtUsd(Math.round(morning))}` });
          }
          break;
        }
      }
    }
  }

  let sum = 0, withPnl = 0;
  for (const h of hits) if (h.t.net != null) { sum += h.t.net; withPnl++; }
  const dates = [...fireDays].sort();
  return {
    fires,
    days: fireDays.size,
    trades: hits.length,
    net: withPnl ? Math.round(sum * 100) / 100 : null,
    tradeIds: hits.map((h) => h.t.id).slice(0, 300),
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
    recentDates: dates.slice(-30),
    examples: [...hits].sort((a, b) => (a.t.net ?? 0) - (b.t.net ?? 0)).slice(0, 5)
      .map((h) => ({ id: h.t.id, ticker: h.t.ticker, date: h.t.date, net: h.t.net, note: h.note })),
    evaluable,
  };
}
