/**
 * Whose day /journal opens (staff = traders + extras, owner rule 2026-10-21). "" = the whole team (TeamDay).
 *   trader → always their own name.
 *   staff  → a ?trader= link (?trader= empty = the team), then the person picked last time on this device, then their
 *            OWN day — editable, with reflection, close-the-day and EOD like a trader's. The team day is a pick in the
 *            picker and is never restored; a staff account without a trader name opens the team.
 */
import { TEAM } from "@/components/people/staff-scope";

export function initialJournalAccount(o: { staff: boolean; me: string | null; urlTrader: string | null; stored: string | null }): string {
  if (!o.staff) return o.me ?? "";
  if (o.urlTrader != null) return o.urlTrader.trim();
  return o.stored?.trim() || o.me || "";
}

/** The staff picker value of an account ("" = TEAM) and back. */
export const accountToPick = (account: string): string => account || TEAM;
export const pickToAccount = (pick: string): string => (pick === TEAM ? "" : pick);
