/**
 * «Комиссии съедают бэнд» and «Толпа в одном тикере» — fee and concentration generators (pure).
 *
 * deskFees: the per-trader fee coaching model (lib/feeModel buildFeeModel: fees per share vs gross per share per price
 *   band, a band FLAGGED when even the optimistic 80% bound of its gross per share does not clear 1.5 × fees per share)
 *   run on the whole desk's trades. A flagged band that carries ≥ FEE_MIN_SHARE of the desk's fees becomes a
 *   recommendation: the fee share of gross with its interval (from the day-clustered bounds of gross per share), the
 *   traders whose own trades in the band (≥ 30) do not clear 1.5 × their fees.
 *
 * deskCrowding: the same ticker on the same day traded by ≥ CROWD_MIN_TRADERS traders («a crowd»): mean net per trade
 *   of crowd trades vs the other trades, paired day bootstrap of the difference (one test → q = p). Recommended when
 *   the crowd trades lose (hi80 < 0), do worse than the rest (diff hi80 < 0, p ≤ 0.05) on ≥ CROWD_MIN_CLUSTERS
 *   ticker-days. Also reported: the share of desk days where ≥ 70% of the active traders lost (correlated losses).
 */
import { buildFeeModel, type FeeModelOpts } from "../feeModel";
import { priceKeyOf } from "../tradeFacetBuckets";
import type { SimTrade } from "../whatIfTypes";
import { whatIfAction } from "./leaks";
import { dayDiffBoot, dayRatioBoot } from "./slices";
import { round, type RawRec } from "./types";

export const FEE_MIN_SHARE = 0.05;
export const CROWD_MIN_TRADERS = 3;
export const CROWD_MIN_CLUSTERS = 15;
export const CORRELATED_SHARE = 0.7;
export const CORRELATED_MIN_ACTIVE = 5;

type Ctx = { from: string; to: string; days: number; B?: number; fee?: FeeModelOpts };

const dayOf = (t: SimTrade) => t.closeDay ?? t.day;

export function deskFees(trades: readonly SimTrade[], ctx: Ctx): RawRec[] {
  const rows = trades.filter((t) => t.gross != null);
  if (!rows.length) return [];
  const opts: FeeModelOpts = { minTrades: 30, ratioMin: 1.5, iters: ctx.B ?? 1000, ...ctx.fee };
  const model = buildFeeModel(rows.map((t) => ({ day: dayOf(t), entry: t.entry, qty: t.qty, gross: t.gross, fees: t.fees })), opts);
  const totalFees = model.total.fees;
  const out: RawRec[] = [];
  for (const band of model.bands) {
    if (!band.flagged || totalFees <= 0 || band.fees / totalFees < FEE_MIN_SHARE) continue;
    const inBand = rows.filter((t) => priceKeyOf(t.entry) === band.band);
    const byDay = new Map<string, { gross: number; shares: number; net: number; n: number }>();
    const byTrader = new Map<string, { n: number; gross: number; fees: number }>();
    for (const t of inBand) {
      const d = byDay.get(dayOf(t)) ?? { gross: 0, shares: 0, net: 0, n: 0 };
      d.gross += t.gross ?? 0; d.shares += Math.abs(t.qty ?? 0); d.net += (t.gross ?? 0) - t.fees; d.n += 1;
      byDay.set(dayOf(t), d);
      if (t.trader) {
        const r = byTrader.get(t.trader) ?? { n: 0, gross: 0, fees: 0 };
        r.n += 1; r.gross += t.gross ?? 0; r.fees += t.fees;
        byTrader.set(t.trader, r);
      }
    }
    const gps = dayRatioBoot([...byDay.values()].map((d) => ({ num: d.gross, den: d.shares })), ["office-fee-gps", band.band], ctx.B);
    const net = dayRatioBoot([...byDay.values()].map((d) => ({ num: d.net, den: d.n })), ["office-fee-net", band.band], ctx.B);
    const fps = band.fps ?? 0;
    // Fee share of gross = fps / gps: the higher gross bound gives the lower share. Gross ≤ 0 → «more than all of it» (null).
    const shareOf = (g: number) => (g > 0 ? fps / g : null);
    const affected = [...byTrader.entries()].filter(([, r]) => r.n >= 30 && r.gross < 1.5 * r.fees).sort(([a, x], [b, y]) => (y.fees - y.gross) - (x.fees - x.gross) || a.localeCompare(b)).map(([n]) => n);
    const share = band.feeShareOfGross;
    out.push({
      id: `fees:${band.band}`, kind: "fees", audience: "desk",
      priority: round(Math.max(0, band.fees - Math.max(0, band.gross) / 1.5) / Math.max(1, ctx.days), 2),
      confidence: band.ratio != null && band.ratio < 1 && band.gpsHi80 != null && band.gpsHi80 < fps ? 3 : band.ratio != null && band.ratio < 1 ? 2 : 1,
      params: { band: band.band, trades: band.trades, ratio: band.ratio, feeShareOfDesk: round(band.fees / totalFees, 4), grossNonPositive: band.gross <= 0 ? 1 : 0 },
      money: net ? { mean: round(net.mean), lo: round(net.lo80), hi: round(net.hi80), per: "trade" } : null,
      rel: share != null && gps
        ? { mean: round(share, 4), lo: round(shareOf(gps.hi80) ?? share, 4), hi: round(shareOf(gps.lo80) ?? 9.99, 4), unit: "share" }
        : null,
      affected: { count: affected.length, names: affected },
      action: whatIfAction(band.band === "lt5" ? { type: "priceRange", min: 5 } : null),
      secondary: null,
      basis: { trades: band.trades, days: band.days, traders: byTrader.size, from: ctx.from, to: ctx.to, q: null },
    });
  }
  return out.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id)).slice(0, 2);
}

export function deskCrowding(trades: readonly SimTrade[], ctx: Ctx): RawRec[] {
  const rows = trades.filter((t) => t.gross != null && t.trader);
  const crowd = new Map<string, Set<string>>();
  for (const t of rows) {
    const k = `${dayOf(t)}|${t.ticker.toUpperCase()}`;
    const s = crowd.get(k) ?? new Set<string>();
    s.add(t.trader!);
    crowd.set(k, s);
  }
  const crowded = new Set([...crowd.entries()].filter(([, s]) => s.size >= CROWD_MIN_TRADERS).map(([k]) => k));
  if (crowded.size < CROWD_MIN_CLUSTERS) return [];
  const days = new Map<string, { an: number; ad: number; bn: number; bd: number }>();
  const tickerNet = new Map<string, number>();
  const losers = new Map<string, number>();
  let crowdTrades = 0;
  for (const t of rows) {
    const k = `${dayOf(t)}|${t.ticker.toUpperCase()}`;
    const net = (t.gross ?? 0) - t.fees;
    const d = days.get(dayOf(t)) ?? { an: 0, ad: 0, bn: 0, bd: 0 };
    if (crowded.has(k)) {
      d.an += net; d.ad += 1; crowdTrades += 1;
      tickerNet.set(t.ticker.toUpperCase(), (tickerNet.get(t.ticker.toUpperCase()) ?? 0) + net);
      losers.set(t.trader!, (losers.get(t.trader!) ?? 0) + net);
    } else { d.bn += net; d.bd += 1; }
    days.set(dayOf(t), d);
  }
  const list = [...days.values()];
  const own = dayRatioBoot(list.filter((d) => d.ad > 0).map((d) => ({ num: d.an, den: d.ad })), ["office-crowd"], ctx.B);
  const diff = dayDiffBoot(list, ["office-crowd-diff"], ctx.B);
  if (!own || !diff || !(own.hi80 < 0) || !(diff.hi80 < 0) || diff.pGe0 > 0.05) return [];
  // Correlated losses: desk days where ≥ 70% of the (≥ 5) active traders closed red.
  const traderDay = new Map<string, Map<string, number>>();
  for (const t of rows) {
    const m = traderDay.get(dayOf(t)) ?? new Map<string, number>();
    m.set(t.trader!, (m.get(t.trader!) ?? 0) + (t.gross ?? 0) - t.fees);
    traderDay.set(dayOf(t), m);
  }
  const busy = [...traderDay.values()].filter((m) => m.size >= CORRELATED_MIN_ACTIVE);
  const redDays = busy.filter((m) => [...m.values()].filter((v) => v < 0).length / m.size >= CORRELATED_SHARE).length;
  const worst = [...tickerNet.entries()].filter(([, v]) => v < 0).sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([k]) => k);
  const affected = [...losers.entries()].filter(([, v]) => v < 0).sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).map(([n]) => n);
  return [{
    id: "crowding:desk", kind: "crowding", audience: "desk",
    priority: round((-own.mean * crowdTrades) / Math.max(1, ctx.days), 2),
    confidence: diff.pGe0 <= 0.01 && own.hi80 < 0 ? 3 : 2,
    params: {
      clusters: crowded.size, crowdShare: round(crowdTrades / rows.length, 4), tickers: worst.join(", "),
      redDays, busyDays: busy.length, minTraders: CROWD_MIN_TRADERS,
    },
    money: { mean: round(own.mean), lo: round(own.lo80), hi: round(own.hi80), per: "trade" },
    rel: null,
    affected: { count: affected.length, names: affected },
    action: { kind: "risk", href: "/risk" },
    secondary: null,
    basis: { trades: crowdTrades, days: list.filter((d) => d.ad > 0).length, traders: losers.size, from: ctx.from, to: ctx.to, q: round(diff.pGe0, 4) },
  }];
}
