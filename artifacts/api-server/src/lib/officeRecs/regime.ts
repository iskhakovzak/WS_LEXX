/**
 * «В боковике деск теряет −$X в день» — the desk regime generator (pure). For each desk regime (desk_regime_days) the
 * desk's net per day of that regime over the window, with the 80 % day-bootstrap interval (lib/stats/myEdgeStats).
 * A recommendation when the regime has ≥ REGIME_MIN_DAYS days and the whole interval is below zero: cut the regime's
 * limit multiplier (Админка → Настройки → «Режим рынка и лимиты»). At most REGIME_MAX_RECS, worst first.
 */
import type { EdgeTrade } from "../edgeMap";
import { meDayBootstrap, meHashSeed, type MeDay } from "../stats/myEdgeStats";
import { round, type RawRec } from "./types";

export const REGIME_MIN_DAYS = 8;
export const REGIME_MAX_RECS = 2;

type Ctx = { from: string; to: string; B?: number };

export function deskRegimeLeaks(edge: readonly EdgeTrade[], regimes: ReadonlyMap<string, string>, ctx: Ctx): RawRec[] {
  const byRegime = new Map<string, { days: Map<string, MeDay>; traders: Set<string>; trades: number }>();
  for (const t of edge) {
    const k = regimes.get(t.day);
    if (!k) continue;
    const g = byRegime.get(k) ?? { days: new Map<string, MeDay>(), traders: new Set<string>(), trades: 0 };
    const d = g.days.get(t.day);
    if (d) { d.sum += t.net; d.n++; } else g.days.set(t.day, { sum: t.net, n: 1 });
    g.traders.add(t.trader);
    g.trades++;
    byRegime.set(k, g);
  }
  const out: RawRec[] = [];
  for (const [regime, g] of byRegime) {
    if (g.days.size < REGIME_MIN_DAYS) continue;
    const boot = meDayBootstrap([...g.days.values()], { seed: meHashSeed(`regime|${regime}|${g.trades}`), iters: ctx.B ?? 1000 });
    if (!boot || boot.perDay.hi >= 0) continue;
    const pd = boot.perDay;
    out.push({
      id: `regime:${regime}`,
      kind: "regime",
      audience: "staff",
      priority: round(Math.abs(pd.point), 2),
      confidence: boot.p <= 0.01 ? 3 : boot.p <= 0.05 ? 2 : 1,
      params: { regime, days: g.days.size },
      money: { mean: round(pd.point), lo: round(pd.lo), hi: round(pd.hi), per: "day" },
      rel: null,
      affected: { count: g.traders.size, names: [...g.traders].sort() },
      action: { kind: "risk", href: "/admin?tab=settings" },
      secondary: null,
      basis: { trades: g.trades, days: g.days.size, traders: g.traders.size, from: ctx.from, to: ctx.to, q: round(boot.p, 4) },
    });
  }
  return out.sort((a, b) => b.priority - a.priority).slice(0, REGIME_MAX_RECS);
}
