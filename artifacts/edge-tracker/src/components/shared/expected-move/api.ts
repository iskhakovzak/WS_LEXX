/**
 * Expected move on earnings (api GET /expected-move, lib/expectedMove/*): the implied snapshot taken before the report,
 * else the historical average — the source always travels with the number.
 */
import { queryOptions } from "@tanstack/react-query";
import { http } from "@/lib/api/http";
import { STALE } from "@/lib/api/keys";

export type EmSource = "implied" | "historical";
export type ExpectedMove = {
  ticker: string;
  reportDate: string;
  timing: "bmo" | "amc" | null;
  reactionDate: string;
  emPct: number | null;
  source: EmSource | null;
  quarters: number | null;
  priorClose: number | null;
  levels: { up: number; down: number } | null;
  reaction: { movePct: number; broken: boolean | null } | null;
};

export function expectedMoveQuery(ticker: string, date?: string) {
  const t = ticker.trim().toUpperCase();
  return queryOptions({
    queryKey: ["expected-move", t, date ?? "today"] as const,
    queryFn: ({ signal }) => http.get<{ date: string; items: ExpectedMove[] }>("/api/expected-move", { query: { tickers: t, date }, signal })
      .then((d) => d.items.find((x) => x.ticker === t) ?? null),
    staleTime: STALE.long,
    enabled: /^[A-Z][A-Z0-9.-]{0,9}$/.test(t),
  });
}
