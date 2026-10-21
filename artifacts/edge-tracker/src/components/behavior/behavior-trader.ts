/**
 * Whose behaviour /behavior shows (staff = traders + extras, owner rule 2026-10-21). Pure.
 *   trader → always their own name (the server scopes it anyway).
 *   staff  → a ?trader= link, then the person they picked by hand last time, then their OWN name — never swapped for
 *            «the first trader» because their role is curator / admin (the old bug). Only a staff account without a
 *            trader name falls back to the first person with trades.
 */
import { traderChoices } from "@/components/people/staff-scope";

export function initialBehaviorTrader(o: { staff: boolean; me: string | null; urlTrader: string | null; stored: string | null }): string | null {
  if (!o.staff) return o.me;
  return o.urlTrader?.trim() || o.stored?.trim() || o.me;
}

/** A staff account with no own name and nothing picked: the first person with trades; else null (keep the pick). */
export function fallbackBehaviorTrader(o: { staff: boolean; me: string | null; trader: string | null; names: readonly string[] }): string | null {
  if (!o.staff || o.me || o.trader) return null;
  return traderChoices(o.names, null)[0] ?? null;
}
