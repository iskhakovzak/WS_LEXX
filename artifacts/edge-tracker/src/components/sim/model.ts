/**
 * Simulator — pure client logic (no React, no DOM): wire bars, the fake clock, order sizing, the automatic bracket
 * on entry, keyboard mapping and autoplay speeds. The server decides everything that counts; this only prepares
 * requests and reads answers.
 */
import type { Candle } from "@/components/chart-engine";
import type { FillReason, SimFill, WireBar } from "./api";

export const fromWire = (w: WireBar): Candle => ({ t: w[0], o: w[1], h: w[2], l: w[3], c: w[4], v: w[5] });

/** Autoplay speeds, bars per second. */
export const SPEEDS = [1, 2, 4, 8, 16] as const;
export type Speed = (typeof SPEEDS)[number];
export const isSpeed = (v: unknown): v is Speed => SPEEDS.includes(v as Speed);
export function nextSpeed(s: Speed, dir: 1 | -1): Speed {
  const i = SPEEDS.indexOf(s);
  return SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, i + dir))];
}

/** Cents above $1, 4 decimals below (sub-dollar names). */
export function roundPrice(p: number): number {
  const k = Math.abs(p) >= 1 ? 100 : 10000;
  return Math.round(p * k) / k;
}

export type SizePreset = "half" | "base" | "double";
export function presetQty(base: number, p: SizePreset): number {
  const q = p === "half" ? base / 2 : p === "double" ? base * 2 : base;
  return Math.max(1, Math.round(q));
}

export function maxQtyFor(maxNotional: number, price: number): number {
  return price > 0 ? Math.floor(maxNotional / price) : 0;
}

/** Signed position after an order (mirrors the server's orderDelta). */
export function positionAfter(pos: number, kind: "buy" | "sell" | "flat", qty: number): number {
  if (kind === "flat") return 0;
  const q = Math.max(0, Math.floor(qty));
  return pos + (kind === "buy" ? q : -q);
}

/**
 * Stop / target to send with an order that opens a position or flips it: 1R (the risk unit) beyond the price,
 * the target at 2R. Undefined when the order only adds / reduces (the open bracket stays) or nothing is wanted.
 */
export function entryBracket(
  pos: number,
  next: number,
  price: number,
  riskUnit: number,
  opts: { autoStop: boolean; autoTarget: boolean },
): { stop: number | null; target: number | null } | undefined {
  const opens = next !== 0 && (pos === 0 || Math.sign(pos) !== Math.sign(next));
  if (!opens || (!opts.autoStop && !opts.autoTarget)) return undefined;
  const dir = Math.sign(next);
  const stop = opts.autoStop ? roundPrice(price - dir * riskUnit) : null;
  const target = opts.autoTarget ? roundPrice(price + dir * 2 * riskUnit) : null;
  return { stop: stop != null && stop > 0 ? stop : null, target: target != null && target > 0 ? target : null };
}

/** A typed price: "12,5" / "12.50" → 12.5; empty / invalid → null. */
export function parsePrice(s: string): number | null {
  const v = Number(s.trim().replace(",", "."));
  return s.trim() !== "" && Number.isFinite(v) && v > 0 ? v : null;
}

/** Shares to close for «½» (H): half the position rounded down, at least 1 (a single share closes it). */
export function halfQty(pos: number): number {
  const a = Math.abs(Math.trunc(pos));
  return a <= 1 ? a : Math.floor(a / 2);
}

/**
 * Break-even stop (E): the average price, allowed only while the trade is in profit (a long's stop must stay below the
 * price, a short's above). Null = not possible right now.
 */
export function breakEvenStop(pos: number, avg: number | null, price: number): number | null {
  if (pos === 0 || avg == null || !(price > 0)) return null;
  const be = roundPrice(avg);
  return pos > 0 ? (be < price ? be : null) : (be > price ? be : null);
}

/**
 * «Размер по риску»: shares so that the stop distance costs 1R ($), capped by buying power — the same formula the
 * server applies for `sizeMode: "risk"` (shown as a preview before the order). Null without a usable stop.
 */
export function riskQty(oneR: number, price: number, stop: number | null, maxQty: number): number | null {
  if (stop == null || !(oneR > 0) || !(price > 0)) return null;
  const dist = Math.abs(price - stop);
  if (!(dist > 0)) return null;
  return Math.max(0, Math.min(maxQty, Math.floor(oneR / dist)));
}

/** A planned stop that fits the order side: below the price for a buy, above it for a sell. */
export function stopFits(kind: "buy" | "sell", price: number, stop: number | null): boolean {
  return stop != null && stop > 0 && (kind === "buy" ? stop < price : stop > price);
}

export type KeyAction =
  | "buy" | "sell" | "flat" | "half" | "breakeven" | "cancel" | "undo" | "again"
  | "play" | "step" | "event" | "faster" | "slower" | "tf" | "size" | "skip" | "noTrade";
/** A game key: the action and, for "tf" / "size", the 0-based slot (TF keys 1–4, base size Shift+1..4). */
export type GameKey = { a: KeyAction; n?: number };

/**
 * Game keys, DAS-like (layout-independent: KeyboardEvent.code, so B/S/F/H/E work on a Russian layout too).
 * Space / A = play-pause, → = one base bar, Shift+→ = jump to the next event, + / − (or ] / [) = speed, 1–4 = display
 * timeframe, Shift+1..4 = size ½ / 1 / 2 / 3 bases, N = skip, T = no trade. Ctrl / Cmd / Alt combos are left alone.
 */
export function keyAction(e: { code: string; key?: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean }): GameKey | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  const digit = /^(?:Digit|Numpad)([1-4])$/.exec(e.code);
  if (digit) return { a: e.shiftKey ? "size" : "tf", n: Number(digit[1]) - 1 };
  switch (e.code) {
    case "KeyB": return { a: "buy" };
    case "KeyS": return { a: "sell" };
    case "KeyF": case "KeyX": return { a: "flat" };
    case "KeyH": return { a: "half" };
    case "KeyE": return { a: "breakeven" };
    case "Escape": return { a: "cancel" };
    case "Space": case "KeyA": return { a: "play" };
    case "ArrowRight": return { a: e.shiftKey ? "event" : "step" };
    case "BracketRight": case "Equal": case "NumpadAdd": return { a: "faster" };
    case "BracketLeft": case "Minus": case "NumpadSubtract": return { a: "slower" };
    case "KeyZ": return { a: "undo" };
    case "KeyN": return { a: "skip" };
    case "KeyT": return { a: "noTrade" };
    case "Enter": case "NumpadEnter": return { a: "again" };
    default: return null;
  }
}

/* ─────────────────────────── Playback pace ─────────────────────────── */

/** Playback speeds of the game screen: base bars per second (1× ≈ a calm read, 30× ≈ a whole 1m session in 13 s). */
export const PACES = [1, 5, 30] as const;
export type Pace = (typeof PACES)[number];
export const isPace = (v: unknown): v is Pace => PACES.includes(v as Pace);
export function nextPace(p: Pace, dir: 1 | -1): Pace {
  const i = PACES.indexOf(p);
  return PACES[Math.max(0, Math.min(PACES.length - 1, i + dir))];
}

/**
 * Playback tick: how many whole bars are due after `dtMs` at `pace` bars/s, carrying the fraction to the next tick
 * (so 30×, ticking every 50 ms, asks 1, 2, 1, 2 … bars). At most `cap` per tick (a background tab wakes up late).
 */
export function paceTick(pace: number, dtMs: number, carry: number, cap = 30): { bars: number; carry: number } {
  const due = carry + (pace * Math.max(0, dtMs)) / 1000;
  const bars = Math.min(cap, Math.floor(due));
  return { bars, carry: bars === cap ? 0 : due - bars };
}

/* ─────────────────────────── Size in bases ─────────────────────────── */

/** Size buttons: ½ · 1 · 2 · 3 bases (base = the game's defaultQty ≈ a $10k position). */
export const BASE_MULTS = [0.5, 1, 2, 3] as const;
export type BaseMult = (typeof BASE_MULTS)[number];
export function baseQty(base: number, m: number): number {
  return Math.max(1, Math.round(base * m));
}
/** Which base button a size matches (null = a custom size). */
export function multOf(qty: number, base: number): BaseMult | null {
  return BASE_MULTS.find((m) => baseQty(base, m) === qty) ?? null;
}

/* ─────────────────────────── Fake clock ─────────────────────────── */

const FAKE_DAY0 = Date.UTC(2001, 0, 10) / 1000;
const SWING_DAY0 = Date.UTC(2001, 0, 1) / 1000;

/** Intraday fake time → day offset (0 = the play day, −1 = the day before) and New York minutes. */
export function fakeClock(t: number): { day: number; min: number } {
  const rel = t - FAKE_DAY0;
  const day = Math.floor(rel / 86400);
  const min = Math.round((rel - day * 86400) / 60) - 300;
  return { day, min };
}

export function hhmm(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Swing fake time → bar index from the first bar. */
export function swingIndex(t: number): number {
  return Math.round((t - SWING_DAY0) / 86400);
}

/* ─────────────────────────── Errors ─────────────────────────── */

export type StepError = { reason: "buyingPower" | "stop" | "target" | "qty" | "generic"; maxQty?: number };

/** The server's VALIDATION details ({ reason, maxQty }) → what to tell the player. */
export function stepErrorOf(err: unknown): StepError {
  const details = (err as { body?: { details?: unknown } } | null)?.body?.details;
  const d = details && typeof details === "object" && !Array.isArray(details) ? (details as { reason?: unknown; maxQty?: unknown }) : null;
  const reason = d?.reason;
  if (reason === "buyingPower") return { reason, maxQty: typeof d?.maxQty === "number" ? d.maxQty : undefined };
  if (reason === "stop" || reason === "target" || reason === "qty") return { reason };
  return { reason: "generic" };
}

/* ─────────────────────────── Fills log ─────────────────────────── */

/**
 * Label key of each fill in the log (same order as `fills`): a buy that reduces or closes a short — a half close or
 * «Закрыть» — reads «Покрыл» (MAKSIM-41); stop / target / end keep their reason; a flip keeps «Купил».
 */
export function fillLabels(fills: readonly Pick<SimFill, "qty" | "reason">[]): (FillReason | "cover")[] {
  let pos = 0;
  return fills.map((f) => {
    const before = pos;
    pos += f.qty;
    const covers = before < 0 && f.qty > 0 && pos <= 0;
    return covers && (f.reason === "buy" || f.reason === "flat") ? "cover" : f.reason;
  });
}

/* ─────────────────────────── «Найди вход» view ─────────────────────────── */

/** Narrow charts (phones) zoom to the «Найди вход» window instead of the default 150 bars (ILYA-07). */
export const FOCUS_MAX_WIDTH = 768;
const FOCUS_LEAD = 40;
const FOCUS_PAD = 3;
const FOCUS_MIN_BAR_PX = 7;
/** The decision window should be at least this wide on screen. */
const FOCUS_MIN_WINDOW_PX = 64;
/** Price scale + margins (px) taken from the chart width. */
const PRICE_AXIS_PX = 64;

/**
 * Visible logical range that keeps the decision window readable on a narrow chart: up to ~40 bars of lead-in plus the
 * window plus a small right pad, bars at least FOCUS_MIN_BAR_PX wide (and wider for a short window). Null on wide
 * charts, where the default view (150 bars) already leaves the window wide enough.
 */
export function focusRange(win: { from: number; to: number }, widthPx: number): { from: number; to: number } | null {
  if (!(widthPx > 0) || widthPx >= FOCUS_MAX_WIDTH) return null;
  const plot = Math.max(120, widthPx - PRICE_AXIS_PX);
  const winBars = Math.max(1, win.to - win.from + 1);
  const barPx = Math.max(FOCUS_MIN_BAR_PX, FOCUS_MIN_WINDOW_PX / winBars);
  const visible = Math.floor(plot / barPx);
  const lead = Math.max(0, Math.min(FOCUS_LEAD, visible - winBars - FOCUS_PAD));
  return { from: win.from - lead, to: win.to + FOCUS_PAD };
}
