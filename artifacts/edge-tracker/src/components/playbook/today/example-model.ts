/**
 * The real example chart of a cheat sheet — pure logic (no React, no DOM): which example of the setup to show (Tier 1
 * «эталон» first, else the best Tier 2; never a Tier 3 mistake), which part of its day to draw (the pattern, not the
 * whole 4:00–20:00), the candles of that window with VWAP, the bell, the entry / exit marks and the time ticks.
 * Data: GET /api/playbook/:id/examples (the server already hides other traders' $) + the day's 5-minute candles.
 */
import { etParts, sessionVwap, type Candle } from "@/components/chart-engine";
import type { SetupExample } from "../model";

/** The example a cheat sheet shows: Tier 1 by the curator's order, else Tier 2; a trade without a ticker never. */
export function pickExample(list: readonly SetupExample[] | null | undefined): SetupExample | null {
  const ok = (list ?? []).filter((e) => !!e.ticker && !!(e.closeDate ?? e.date));
  const byOrder = (a: SetupExample, b: SetupExample) => a.sortOrder - b.sortOrder || (b.closeDate ?? b.date).localeCompare(a.closeDate ?? a.date);
  return ok.filter((e) => e.tier === 1).sort(byOrder)[0] ?? ok.filter((e) => e.tier === 2).sort(byOrder)[0] ?? null;
}

/** NY minutes of an ISO time, or null. */
export function nyMinuteOf(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? etParts(Math.floor(ms / 1000)).mod : null;
}

/** 581 → "9:41" (the clock traders say, no leading zero). */
export const clockText = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;

/**
 * The part of the day to draw, in NY minutes: an entry in the first half hour shows the run-up from 9:00, a morning
 * entry shows the session from the bell (VWAP / HOD context), an afternoon one the two hours before it; at least
 * 2.5 hours, 30 minutes after the exit, inside the regular session unless the trade itself was outside it.
 */
export function chartWindow(entry: number | null, exit: number | null): { from: number; to: number } {
  if (entry == null) return { from: 570, to: 720 };
  const from = entry < 600 ? 540 : entry < 720 ? 570 : Math.max(570, entry - 120);
  const end = Math.max(exit ?? entry, entry);
  const cap = end >= 960 ? Math.min(1200, end + 15) : 960;
  const to = Math.min(cap, Math.max(end + 30, from + 150));
  return { from: Math.min(from, entry - 15), to: Math.max(to, end + 5) };
}

export type ExampleView = {
  bars: Candle[];
  /** Session VWAP per bar (null before the bell / without volume). */
  vwap: (number | null)[];
  entryIdx: number | null;
  exitIdx: number | null;
  entryPrice: number | null;
  exitPrice: number | null;
  side: "long" | "short";
  /** Did the trade go the right way (exit vs entry by side)? null when a price is missing. */
  win: boolean | null;
  /** The 9:30 bar, when the window starts before it. */
  bellIdx: number | null;
  lo: number;
  hi: number;
  ticks: { idx: number; label: string }[];
};

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

/** Index of the bar that contains `epoch` (the last bar starting at or before it), or null outside the bars. */
function barAt(bars: readonly Candle[], epoch: number | null): number | null {
  if (epoch == null || !bars.length || epoch < bars[0].t) return null;
  let idx = 0;
  for (let i = 0; i < bars.length; i++) if (bars[i].t <= epoch) idx = i; else break;
  return idx;
}

/** The candles of the example's window with everything the chart marks; null when the day has no bars there. */
export function buildExampleView(dayBars: readonly Candle[], ex: Pick<SetupExample, "side" | "entry" | "exit" | "entryTime" | "exitTime">): ExampleView | null {
  const all = dayBars.filter((c) => [c.o, c.h, c.l, c.c].every((v) => Number.isFinite(v)));
  if (all.length < 2) return null;
  const entryEpoch = ex.entryTime ? Math.floor(Date.parse(ex.entryTime) / 1000) : null;
  const exitEpoch = ex.exitTime ? Math.floor(Date.parse(ex.exitTime) / 1000) : null;
  const win = chartWindow(nyMinuteOf(ex.entryTime), nyMinuteOf(ex.exitTime));
  const bars = all.filter((c) => { const m = etParts(c.t).mod; return m >= win.from && m < win.to; });
  if (bars.length < 2) return null;
  const vw = new Map(sessionVwap(all).map((p) => [p.t, p.vwap]));
  const vwap = bars.map((b) => vw.get(b.t) ?? null);
  const entryIdx = Number.isFinite(entryEpoch) ? barAt(bars, entryEpoch) : null;
  const exitIdx = Number.isFinite(exitEpoch) ? barAt(bars, exitEpoch) : null;
  const entryPrice = num(ex.entry);
  const exitPrice = num(ex.exit);
  const side: "long" | "short" = String(ex.side ?? "").toLowerCase().startsWith("s") ? "short" : "long";
  const winTrade = entryPrice != null && exitPrice != null ? (side === "short" ? entryPrice - exitPrice : exitPrice - entryPrice) >= 0 : null;
  let lo = Math.min(...bars.map((b) => b.l));
  let hi = Math.max(...bars.map((b) => b.h));
  for (const p of [entryIdx != null ? entryPrice : null, exitIdx != null ? exitPrice : null, ...vwap]) {
    if (p != null) { lo = Math.min(lo, p); hi = Math.max(hi, p); }
  }
  const first = etParts(bars[0].t).mod;
  const bellIdx = first < 570 ? bars.findIndex((b) => etParts(b.t).mod >= 570) : -1;
  const spanMin = etParts(bars[bars.length - 1].t).mod - first;
  const step = spanMin > 200 ? 60 : 30;
  const ticks: ExampleView["ticks"] = [];
  bars.forEach((b, idx) => {
    const m = etParts(b.t).mod;
    if (m % step === 0 && idx > 0 && idx < bars.length - 1) ticks.push({ idx, label: clockText(m) });
  });
  return { bars, vwap, entryIdx, exitIdx, entryPrice, exitPrice, side, win: winTrade, bellIdx: bellIdx > 0 ? bellIdx : null, lo, hi, ticks };
}
