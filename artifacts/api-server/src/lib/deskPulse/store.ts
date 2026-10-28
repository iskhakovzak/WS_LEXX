/**
 * The desk pulse of a window (read-only; pure rules in ./pulse.ts): every PropReports trade of the desk whose entry
 * day is in [to − pulse.windowDays, to], its family from the archived day (./family, ./dayBars) and its timing from
 * the fills (lib/sessionFlow/timing). Cached per window and settings for PULSE_TTL_MS — the Big7 board and the morning
 * brief of every trader read the same answer.
 */
import { setting } from "../settings/registry";
import { addDays, nyDate } from "../tradingDate";
import { TtlCache } from "../hotCache";
import { flowTrades } from "../sessionFlow/load";
import { timingOf } from "../sessionFlow/timing";
import type { FlowTrade } from "../sessionFlow/types";
import { barKey, dayBarsOf } from "./dayBars";
import { familyOf, gapOf, type Family } from "./family";
import { deskPulse, pulseFor, type Pulse, type PulseCfg, type PulseTrade } from "./pulse";

export const pulseCfg = (): PulseCfg => ({ minTrades: setting("pulse.minTrades"), minTraders: setting("pulse.minTraders") });

export type DeskPulse = Pulse & { from: string; to: string; windowDays: number; minTrades: number; minTraders: number };

const PULSE_TTL_MS = 10 * 60_000;
const cache = new TtlCache<string, Promise<DeskPulse>>(PULSE_TTL_MS);

/** Families of `trades` from their archived day (null without the day or without a side). */
export async function familiesOf(trades: readonly Pick<FlowTrade, "id" | "ticker" | "day" | "side">[]): Promise<Map<number, Family | null>> {
  const bars = await dayBarsOf(trades.map((t) => ({ ticker: t.ticker, day: t.day })));
  const gap = setting("pulse.gapPct");
  return new Map(trades.map((t) => {
    const b = bars.get(barKey(t.day, t.ticker));
    return [t.id, b ? familyOf(gapOf(b), t.side, gap) : null];
  }));
}

export function toPulseTrades(trades: readonly FlowTrade[], families: ReadonlyMap<number, Family | null>): PulseTrade[] {
  return trades.map((t) => ({ ...t, family: families.get(t.id) ?? null, timing: timingOf(t) }));
}

async function compute(from: string, to: string, windowDays: number, cfg: PulseCfg): Promise<DeskPulse> {
  const trades = (await flowTrades(null, from, to)).filter((t) => t.result !== "open");
  const families = await familiesOf(trades);
  return { ...deskPulse(toPulseTrades(trades, families), cfg), from, to, windowDays, ...cfg };
}

/** The whole desk's cells (every number: staff view). */
export function deskPulseOf(to: string = nyDate()): Promise<DeskPulse> {
  const windowDays = setting("pulse.windowDays");
  const cfg = pulseCfg();
  const from = addDays(to, -windowDays);
  const key = JSON.stringify({ from, to, cfg, gap: setting("pulse.gapPct") });
  const hit = cache.get(key);
  if (hit) return hit;
  const p = compute(from, to, windowDays, cfg);
  cache.set(key, p);
  p.catch(() => cache.delete(key));
  return p;
}

/** The pulse as the viewer may see it (./pulse pulseFor). */
export async function pulseView(staff: boolean, to?: string): Promise<DeskPulse> {
  const p = await deskPulseOf(to);
  return { ...p, ...pulseFor(p, staff, p) };
}
