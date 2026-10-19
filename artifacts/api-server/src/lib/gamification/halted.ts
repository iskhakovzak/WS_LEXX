/**
 * Risk halt as gamification reads it (owner decision 2026-10-19, OWNER-09): while a trader is halted by the risk desk
 * (daily / weekly stop or max drawdown — routes/risk.ts deskSnapshot → metrics.stop.halted, the RISK area owns it) he
 * shows no title and takes no place in the public season top. Nothing is written here (deskSnapshot itself records the
 * day's stop alerts, deduplicated, exactly as every /risk/desk read does); cached HALT_TTL_MS per trader so rankings stay
 * cheap. A failed read is «not halted» (gamification never blocks on the risk desk).
 */
import { logger } from "../logger";
import { nyDate } from "../tradingDate";

export const HALT_TTL_MS = 60_000;

type Source = (names: readonly string[], today: string) => Promise<Set<string>>;

const fromRiskDesk: Source = async (names, today) => {
  // Loaded on first use: the risk router is heavy, and the pure gamification modules stay importable without it.
  const { deskSnapshot } = await import("../../routes/risk");
  const { rows } = await deskSnapshot(today, null, "ru", names);
  return new Set(rows.filter((r) => r.metrics.stop.halted).map((r) => r.trader));
};

let source: Source = fromRiskDesk;
const cache = new Map<string, { at: number; halted: boolean }>();

/** Replaces the risk source (tests); null restores the risk desk. Clears the cache. */
export function setHaltSource(fn: Source | null): void {
  source = fn ?? fromRiskDesk;
  cache.clear();
}

/** The halted ones among `names`. */
export async function haltedTraders(names: readonly string[], now = new Date()): Promise<Set<string>> {
  const out = new Set<string>();
  const missing: string[] = [];
  for (const n of new Set(names)) {
    const hit = cache.get(n);
    if (hit && Date.now() - hit.at < HALT_TTL_MS) {
      if (hit.halted) out.add(n);
    } else missing.push(n);
  }
  if (!missing.length) return out;
  try {
    const halted = await source(missing, nyDate(now));
    for (const n of missing) {
      cache.set(n, { at: Date.now(), halted: halted.has(n) });
      if (halted.has(n)) out.add(n);
    }
  } catch (err) {
    logger.warn({ err: (err as Error)?.message }, "gamification: risk halt read failed");
  }
  if (cache.size > 1000) for (const [k, v] of cache) if (Date.now() - v.at > HALT_TTL_MS) cache.delete(k);
  return out;
}
