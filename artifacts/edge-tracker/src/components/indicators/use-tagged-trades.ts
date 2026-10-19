// Tagged trades for «Справочник» stats: GET /api/indicators/tagged-trades?enc=2 (columnar, ten fields, ~1.7 MB for the whole
// desk) instead of GET /api/trades?tagged=1 (every column, ~60 MB). An API build without the slim route (404)
// falls back to the full list, so the page works on both.
import { useQuery } from "@tanstack/react-query";
import type { Trade } from "@workspace/api-client-react";
import { http } from "@/lib/api/http";
import { nullIfMissing } from "@/lib/api/errors";
import { STALE } from "@/lib/api/keys";

/** The fields the indicator stats read. */
export type StatTrade = Pick<Trade, "id" | "ticker" | "date" | "result" | "rMultiple" | "pnl" | "fees" | "tags" | "setup" | "horizon">;

type Columnar = {
  n: number; dict: string[];
  id: number[]; ticker: number[]; date: string[]; result: number[]; r: (number | null)[];
  pnl: (number | null)[]; fees: (number | null)[]; tags: number[]; setup: number[]; horizon: number[];
};
/** ?enc=2: dates as indexes into `dates`, ids as deltas from the previous id (api-server encodeTaggedCompact). */
type Compact = Omit<Columnar, "id" | "date"> & { enc: 2; idDelta: number[]; dates: string[]; date: number[] };

/** Columnar payload (plain or enc=2) → rows (dictionary index -1 = null). Exported for tests. */
export function decodeTagged(c: Columnar | Compact): StatTrade[] {
  const s = (k: number | undefined) => (k == null || k < 0 ? null : c.dict[k] ?? null);
  const compact = "enc" in c && c.enc === 2 ? c : null;
  const out: StatTrade[] = new Array(c.n);
  let id = 0;
  for (let i = 0; i < c.n; i++) {
    id = compact ? id + compact.idDelta[i] : (c as Columnar).id[i];
    out[i] = {
      id,
      ticker: s(c.ticker[i]) ?? "",
      date: compact ? compact.dates[compact.date[i]] ?? "" : (c as Columnar).date[i],
      result: s(c.result[i]) ?? "",
      rMultiple: c.r[i],
      pnl: c.pnl[i],
      fees: c.fees[i],
      tags: s(c.tags[i]),
      setup: s(c.setup[i]),
      horizon: s(c.horizon[i]),
    } as StatTrade;
  }
  return out;
}


export function useTaggedTrades() {
  return useQuery<StatTrade[]>({
    queryKey: ["indicators", "tagged-trades"],
    staleTime: STALE.long,
    queryFn: async ({ signal }) => {
      const slim = await http.get<Columnar | Compact>("/api/indicators/tagged-trades?enc=2", { signal }).catch(nullIfMissing);
      if (slim && (Array.isArray((slim as Compact).idDelta) || Array.isArray((slim as Columnar).id))) return decodeTagged(slim);
      const full = await http.get<Trade[]>("/api/trades?tagged=1", { signal }).catch(nullIfMissing);
      return Array.isArray(full) ? full : [];
    },
  });
}
