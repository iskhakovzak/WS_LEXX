/**
 * Day ordering and small statistics of the behaviour engine (lib/behaviorEngine re-exports them): trades of a day in
 * entry order, decision numbers (one entry second = one decision — auction batches go in together), the trade closed
 * last before an entry, median / MAD / quantile, ISO week, hold-text parsing, calendar date shift. Pure, no I/O.
 */
import type { BehaviorTrade } from "./behaviorEngine";

export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Масштабированное MAD (×1.4826 ≈ σ для нормального распределения). */
export function mad(values: number[]): number {
  if (!values.length) return 0;
  const m = median(values);
  return 1.4826 * median(values.map((v) => Math.abs(v - m)));
}

export function quantile(values: number[], q: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/** Понедельник ISO-недели для даты YYYY-MM-DD (календарная арифметика без таймзон). */
export function weekKey(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = (dt.getUTCDay() + 6) % 7; // Пн = 0
  dt.setUTCDate(dt.getUTCDate() - dow);
  return dt.toISOString().slice(0, 10);
}

/**
 * Текст удержания из журнала → минуты: "5m", "17s", "2h 29m", "1:30", "45 мин", "3 д", "2h".
 * Null, если не распознано.
 */
export function parseHoldText(text: string | null | undefined): number | null {
  if (!text) return null;
  const s = text.trim().toLowerCase().replace(",", ".");
  if (!s) return null;
  const clock = /^(\d{1,3}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]) + (clock[3] ? Number(clock[3]) / 60 : 0);
  let total = 0, matched = false;
  // Input parsing (journal hold text in RU / EN / UZ), not UI text.
  const re = /(\d+(?:\.\d+)?)\s*(d|day|days|kun|д|дн|h|hr|soat|ч|m|min|daq|daqiqa|мин|м|s|sec|son|soniya|сек|с)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    matched = true;
    const v = Number(m[1]);
    const u = m[2];
    if (u === "d" || u === "day" || u === "days" || u === "kun" || u === "д" || u === "дн") total += v * 1440; // i18n-ignore (input units)
    else if (u === "h" || u === "hr" || u === "soat" || u === "ч") total += v * 60; // i18n-ignore (input units)
    else if (u === "s" || u === "sec" || u === "son" || u === "soniya" || u === "сек" || u === "с") total += v / 60; // i18n-ignore (input units)
    else total += v;
  }
  if (matched) return total;
  const bare = /^(\d+(?:\.\d+)?)$/.exec(s);
  return bare ? Number(bare[1]) : null;
}

export function notional(t: BehaviorTrade): number | null {
  if (t.qty == null) return null;
  if (t.entry != null && t.entry > 0) return Math.abs(t.qty) * t.entry;
  return Math.abs(t.qty);
}

/** Сделки по дням в порядке входа (время → id). */
export function groupByDay(trades: BehaviorTrade[]): Map<string, BehaviorTrade[]> {
  const byDay = new Map<string, BehaviorTrade[]>();
  for (const t of trades) {
    if (!byDay.has(t.date)) byDay.set(t.date, []);
    byDay.get(t.date)!.push(t);
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => {
      if (a.entryAt != null && b.entryAt != null && a.entryAt !== b.entryAt) return a.entryAt - b.entryAt;
      if (a.entryAt != null && b.entryAt == null) return -1;
      if (a.entryAt == null && b.entryAt != null) return 1;
      return a.id - b.id;
    });
  }
  return new Map([...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

/** Entry second of a trade: one entry second = one decision (auction batches OPG/IMBX/MOC go in together). */
export const entrySec = (t: BehaviorTrade): number | null => (t.entryAt == null ? null : Math.floor(t.entryAt / 1000));

/**
 * Number of each trade of a day (in groupByDay order) counted by decisions: trades entered in the same second share the
 * number of the first of them, so the in-batch order (by id) never makes a trade "late". 9 trades at 09:30:00 -> all #1.
 */
export function entryRanks(day: readonly BehaviorTrade[]): number[] {
  const out: number[] = [];
  day.forEach((t, i) => {
    const s = entrySec(t);
    out.push(i > 0 && s != null && entrySec(day[i - 1]!) === s ? out[i - 1]! : i + 1);
  });
  return out;
}

/**
 * The trade of the day closed last at or before day[i] was entered (a result the trader already knew), from an earlier
 * entry second. Trades without times: the previous trade in order when it has no time either (the old rule).
 */
export function lastClosedBefore(day: readonly BehaviorTrade[], i: number): BehaviorTrade | null {
  const t = day[i]!;
  const s = entrySec(t);
  if (s == null || t.entryAt == null) {
    const p = i > 0 ? day[i - 1]! : null;
    return p && p.entryAt == null ? p : null;
  }
  let best: BehaviorTrade | null = null;
  for (const p of day) {
    if (p === t || p.exitAt == null || p.exitAt > t.entryAt) continue;
    const ps = entrySec(p);
    if (ps == null || ps >= s) continue;
    if (!best || p.exitAt >= best.exitAt!) best = p;
  }
  return best;
}

/** Календарный сдвиг даты YYYY-MM-DD на n дней (без таймзон). */
export function shiftDate(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
