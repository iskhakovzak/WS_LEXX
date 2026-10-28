/**
 * The season of a NY trading day as the desk sees it now (settings «season.*» + the market calendar). Read-only; the
 * pure rules live in ./season.ts. Cached per day for SEASON_TTL_MS (the stops read it on every alert tick).
 */
import { setting } from "../settings/registry";
import { isMarketClosed, sessionFor } from "../marketDays";
import { addDays, isWeekend } from "../tradingDate";
import { seasonOf, type SeasonCfg, type SeasonDay } from "./season";

export function seasonCfg(): SeasonCfg {
  return {
    enabled: setting("season.enabled"), offFrom: setting("season.offFrom"), offTo: setting("season.offTo"),
    quietFactor: setting("season.quietFactor"), trimLimits: setting("season.trimLimits"), holidayEves: setting("season.holidayEves"),
    primeStartDay: setting("season.primeStartDay"), primeWeeks: setting("season.primeWeeks"),
  };
}

/** The nearest weekday before / after `day`. */
function weekday(day: string, step: 1 | -1): string {
  let d = addDays(day, step);
  while (isWeekend(d)) d = addDays(d, step);
  return d;
}

const SEASON_TTL_MS = 60_000;
const cache = new Map<string, { at: number; key: string; value: SeasonDay }>();

export async function seasonDay(day: string): Promise<SeasonDay> {
  const cfg = seasonCfg();
  const key = JSON.stringify(cfg);
  const hit = cache.get(day);
  if (hit && hit.key === key && Date.now() - hit.at < SEASON_TTL_MS) return hit.value;
  const [session, prevClosed, nextClosed] = await Promise.all([
    sessionFor(day), isMarketClosed(weekday(day, -1)), isMarketClosed(weekday(day, 1)),
  ]).catch(() => [null, false, false] as const);
  const value = seasonOf(day, cfg, { earlyClose: session?.earlyClose ?? false, prevClosed, nextClosed });
  if (cache.size > 64) cache.delete(cache.keys().next().value as string);
  cache.set(day, { at: Date.now(), key, value });
  return value;
}
