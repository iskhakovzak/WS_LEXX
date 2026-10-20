/**
 * Two watchlists (Волна 1, item 1.18; owner decision 2, 2026-10-20) — PURE rules, unit-tested in
 * __tests__/watchlistScope.test.ts. No DB, no express.
 *
 *   mine   a trader's personal list: watchlist.owner = his users.id. Read and written by him only (staff included:
 *          a personal list is nobody else's business).
 *   desk   the shared desk list: watchlist.owner IS NULL (every row from before migration 0233). Read by every member
 *          (guests too); written — content and the workflow flags (list / «В игре» / status) — by seniors (ladder stage
 *          «Сеньор», lib/people/stage) and staff (curator / admin).
 * «В вотчлист» from /themes, the screener, analysts and offerings goes to the personal list (the default scope of a
 * write). The viewer's choice of list is remembered in users.settings.watchlistView like themesView.
 */

export const WATCH_SCOPES = ["mine", "desk"] as const;
export type WatchScope = (typeof WATCH_SCOPES)[number];

/** The caller as the rules need it. null = anonymous / inactive / banned. */
export type WatchActor = { id: number; name: string; role: string; guest: boolean; senior: boolean };

const isStaff = (role: string) => role === "curator" || role === "admin";

/** A request value → scope; undefined when absent, "invalid" for anything else. */
export function parseScope(v: unknown): WatchScope | undefined | "invalid" {
  if (v === undefined || v === null || v === "") return undefined;
  const s = String(v).trim().toLowerCase();
  return (WATCH_SCOPES as readonly string[]).includes(s) ? (s as WatchScope) : "invalid";
}

/** May write the desk list: a senior or staff (never a guest). */
export function canEditDesk(a: WatchActor | null | undefined): boolean {
  return !!a && !a.guest && (isStaff(a.role) || a.senior);
}

/** May see a row of `owner` (null = desk). */
export function canReadRow(a: WatchActor | null | undefined, owner: number | null): boolean {
  if (!a) return false;
  if (owner == null) return true;
  return !a.guest && a.id === owner;
}

/** May change / delete / restore / rescore a row of `owner` (null = desk). */
export function canWriteRow(a: WatchActor | null | undefined, owner: number | null): boolean {
  if (!a || a.guest) return false;
  return owner == null ? canEditDesk(a) : a.id === owner;
}

/** The owner value of a scope for this caller (desk → null). A guest has no personal list. */
export function ownerOf(scope: WatchScope, a: WatchActor): number | null {
  return scope === "desk" ? null : a.id;
}

/** Scope a list read uses: the asked one, else the remembered one; a guest only ever reads the desk. */
export function readScope(asked: WatchScope | undefined, remembered: WatchScope, a: WatchActor): WatchScope {
  if (a.guest) return "desk";
  return asked ?? remembered;
}

export type WatchView = { scope: WatchScope };
export const DEFAULT_WATCH_VIEW: WatchView = { scope: "mine" };

/** users.settings.watchlistView (any JSON) → a valid view. */
export function normalizeWatchView(v: unknown): WatchView {
  const scope = parseScope((v as { scope?: unknown } | null | undefined)?.scope);
  return { scope: scope && scope !== "invalid" ? scope : DEFAULT_WATCH_VIEW.scope };
}
