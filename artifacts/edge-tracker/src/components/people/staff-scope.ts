/**
 * Staff = traders + extras (owner rule 2026-10-21): a curator or an admin trades too, so every personal page opens on
 * their OWN book exactly like a trader's; the desk aggregate is an explicit «Вся команда» pick and another person a
 * pick by name. Pure — the pages and staff-trader-picker share it.
 */
import { comparePersonNames } from "@/i18n";

/** «Вся команда» in a staff trader picker. A UI value only — never sent to the API. */
export const TEAM = "__team__";

export type TraderScope = {
  /** The book to load: a name, or null = the server default (a trader's own book; the desk for team). */
  trader: string | null;
  /** The desk view (staff only): aggregates / team panels instead of one person's book. */
  team: boolean;
  /** The viewer's own book (a trader always; staff on their own name). */
  self: boolean;
};

/**
 * Who a page shows.
 *   trader (not staff)     → own book, `trader: null` (the server scopes it).
 *   staff + team / TEAM    → the desk.
 *   staff + a picked name  → that person (self when it is the viewer).
 *   staff, nothing picked  → the viewer's own name; no own name (a non-trading account) → the desk.
 */
export function resolveTraderScope(o: {
  staff: boolean; me: string | null | undefined; picked?: string | null; team?: boolean;
}): TraderScope {
  if (!o.staff) return { trader: null, team: false, self: true };
  const me = o.me?.trim() || null;
  const picked = o.picked?.trim() || null;
  if (o.team || picked === TEAM) return { trader: null, team: true, self: false };
  if (picked) return { trader: picked, team: false, self: picked === me };
  if (me) return { trader: me, team: false, self: true };
  return { trader: null, team: true, self: false };
}

/** The picker value of a scope: TEAM, or the person's name. */
export function scopePickerValue(s: TraderScope): string {
  return s.team ? TEAM : s.trader ?? "";
}

/**
 * The people of a staff picker after the own-book lead: everyone with trades (traders, curators, admins), the current
 * pick even if it has none, without the viewer and blanks, sorted by display name.
 */
export function traderChoices(names: readonly (string | null | undefined)[], me: string | null | undefined, current?: string | null): string[] {
  const own = me?.trim() || null;
  const set = new Set<string>();
  for (const n of names) {
    const v = n?.trim();
    if (v && v !== "—" && v !== own && v !== TEAM) set.add(v);
  }
  const cur = current?.trim();
  if (cur && cur !== own && cur !== TEAM) set.add(cur);
  return [...set].sort(comparePersonNames);
}
