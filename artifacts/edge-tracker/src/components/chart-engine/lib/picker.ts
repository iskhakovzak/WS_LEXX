/**
 * «График и разбор» trade picker — pure helpers (pages/chart-lab.tsx): the /api/trades/page query, the net result and
 * the entry time shown per row.
 */
import type { TradeLike } from "../types";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * «AAPL», «2026-10-14» or «AAPL 2026-10-14» → /api/trades/page filters. `lite=1`: rows + count only — the picker needs
 * no desk summary, curve or preset facets (DEV-02: 2.7 s → 0.1 s).
 */
export function searchParams(text: string, limit = 40): URLSearchParams {
  const p = new URLSearchParams({ limit: String(limit), sort: "date", dir: "desc", lite: "1" });
  const parts = text.trim().split(/\s+/).filter(Boolean);
  const date = parts.find((x) => YMD.test(x));
  const rest = parts.filter((x) => x !== date).join(" ");
  if (date) p.set("date", date);
  if (rest) p.set("q", rest);
  return p;
}

/** Net $ (gross − |fees|), the desk's rule for every result (DENIS-15); null when gross is unknown. */
export function netOf(t: Pick<TradeLike, "pnl" | "fees">): number | null {
  if (t.pnl == null || !Number.isFinite(Number(t.pnl))) return null;
  return Number(t.pnl) - Math.abs(Number(t.fees ?? 0) || 0);
}

/** «14:55» — the first fill (broker wall clock ET) of a trade, when the snapshot has it. */
export function entryTimeOf(t: Pick<TradeLike, "contextSnapshot">): string | null {
  const v = (t.contextSnapshot as { openedAt?: unknown } | null | undefined)?.openedAt;
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(v) ? v.slice(11, 16) : null;
}

