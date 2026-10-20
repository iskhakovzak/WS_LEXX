/**
 * POST /api/options/ai-analyze — the compact chain table the model sees: ATM ±10 strikes, one line per strike with
 * the call and the put. Accepts the GET /api/options/chain contract shape (lib/options/types ChainContract); IV and
 * Δ are added when the chain carries them (Yahoo), so the model reasons on the same numbers the trader sees.
 */
export type AiContractRow = {
  strike: number;
  bid?: number;
  ask?: number;
  mid?: number;
  volume?: number;
  openInterest?: number;
  inTheMoney?: boolean;
  iv?: number | null;
  greeks?: { delta?: number } | null;
};

const fin = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const fmt = (n: unknown) => (fin(n) ? n.toFixed(2) : "n/a");

function cell(c: AiContractRow | undefined): string {
  if (!c) return "n/a";
  const iv = fin(c.iv) ? ` iv=${c.iv.toFixed(1)}%` : "";
  const delta = fin(c.greeks?.delta) ? ` delta=${c.greeks.delta.toFixed(2)}` : "";
  return `bid=${fmt(c.bid)} ask=${fmt(c.ask)} mid=${fmt(c.mid)} vol=${fin(c.volume) ? c.volume : 0} oi=${fin(c.openInterest) ? c.openInterest : 0}${iv}${delta}${c.inTheMoney ? " ITM" : ""}`;
}

export function aiChainTable(spot: number, strikes: unknown, calls: AiContractRow[], puts: AiContractRow[]): string {
  const fromList = Array.isArray(strikes) ? strikes.filter(fin) : [];
  const sorted = [...new Set(fromList.length ? fromList : [...calls, ...puts].map((c) => c.strike).filter(fin))].sort((a, b) => a - b);
  const atmIdx = Math.max(0, sorted.findIndex((s) => s >= spot));
  const relevant = sorted.slice(Math.max(0, atmIdx - 9), Math.min(sorted.length, atmIdx + 10));
  const step = sorted.length > 1 ? sorted[1] - sorted[0] : 0;
  const callMap = new Map(calls.map((c) => [c.strike, c]));
  const putMap = new Map(puts.map((p) => [p.strike, p]));
  return relevant.map((k) => {
    const atmTag = step > 0 && Math.abs(k - spot) <= step * 0.6 ? " ← ATM" : "";
    return `$${k.toFixed(1)}${atmTag} | C: ${cell(callMap.get(k))} | P: ${cell(putMap.get(k))}`;
  }).join("\n");
}
