/**
 * Signature of the trades the honest suggestion path (lib/whatIfHonesty) sees: part of the cache key of a stored
 * verdict, so any engine-relevant change (a PropReports sync, an edited mark, a new trade) gives a new key. sha256 of
 * the canonical JSON of the trades sorted by id, as the first 40 hex characters. Pure, no I/O.
 */
import { createHash } from "node:crypto";
import { round2, type SimTrade } from "./whatIfTypes";

const sorted = (a: readonly string[] | undefined, lower = false) => [...(a ?? [])].map((s) => (lower ? s.trim().toLowerCase() : s)).sort();

export function tradesSignature(trades: readonly SimTrade[]): string {
  const rows = [...trades].sort((a, b) => a.id - b.id).map((t) => [
    t.id, t.day, t.closeDay ?? null, t.entryMin == null ? null : round2(t.entryMin), t.holdSec, t.ticker, t.side, t.qty, t.entry,
    t.gross, t.fees, t.setup, t.grade ?? null, t.trader ?? null, t.imx === true, t.reentry === true, t.sizeRel ?? null, t.hasStop ?? null,
    sorted(t.mistakes), sorted(t.ptags, true),
  ]);
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex").slice(0, 40);
}
