/**
 * Per-viewer view of the desk recommendations (pure). Mirrors the office page's own rules (routes/officeStats):
 *
 *   admin    everything: $, names, the «create a desk rule» link;
 *   curator  no $ (the office page shows them % of capital only) — `money` and every `…Usd` param are dropped; names
 *            only of traders their `team.read` scope covers (null scope = the whole desk);
 *   trader   staff-only kinds removed, no $, no names, no staff links — anonymised desk aggregates;
 *   then the viewer's «скрыть на неделю» entries (users.settings.officeRecsHidden: id → until YYYY-MM-DD) are moved
 *   out of `recs` into `hidden`.
 */
import type { OfficeRec } from "./types";

export type RecViewer = { role: "admin" | "curator" | "trader"; scope: readonly string[] | null };

export const HIDE_DAYS = 7;
export const MAX_HIDDEN = 50;

function stripMoney(r: OfficeRec): OfficeRec {
  const params: OfficeRec["params"] = {};
  for (const [k, v] of Object.entries(r.params)) if (!/Usd$/.test(k)) params[k] = v;
  return { ...r, params, money: null };
}

export function redactRecs(recs: readonly OfficeRec[], viewer: RecViewer): OfficeRec[] {
  if (viewer.role === "admin") return recs.map((r) => ({ ...r, affected: { ...r.affected, names: [...r.affected.names] } }));
  if (viewer.role === "curator") {
    const ok = viewer.scope == null ? null : new Set(viewer.scope);
    return recs.map((r) => {
      const s = stripMoney(r);
      return { ...s, affected: { count: r.affected.count, names: ok ? r.affected.names.filter((n) => ok.has(n)) : [...r.affected.names] } };
    });
  }
  return recs
    .filter((r) => r.audience === "desk")
    .map((r) => {
      const s = stripMoney(r);
      const action = s.action && s.action.kind === "whatif" ? { ...s.action, href: s.action.href.replace("trader=__all__&", "").replace("?trader=__all__", "") } : s.action;
      return { ...s, action, secondary: null, affected: { count: r.affected.count, names: [] } };
    });
}

/** Valid, still-active hidden entries (until ≥ today), at most MAX_HIDDEN. */
export function activeHidden(raw: unknown, today: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [id, until] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof until === "string" && /^\d{4}-\d{2}-\d{2}$/.test(until) && until >= today && id.length <= 80) out[id] = until;
    if (Object.keys(out).length >= MAX_HIDDEN) break;
  }
  return out;
}

export function splitHidden(recs: readonly OfficeRec[], hidden: Record<string, string>): { recs: OfficeRec[]; hidden: { id: string; until: string; kind: OfficeRec["kind"] }[] } {
  const shown: OfficeRec[] = [];
  const off: { id: string; until: string; kind: OfficeRec["kind"] }[] = [];
  for (const r of recs) {
    if (hidden[r.id]) off.push({ id: r.id, until: hidden[r.id], kind: r.kind });
    else shown.push(r);
  }
  return { recs: shown, hidden: off };
}
