/**
 * «Recent» of the command palette: the last 8 things opened from it (trades, tickers, pages, people, setups…), kept in
 * localStorage per signed-in user. Every storage access is guarded: private mode, a full quota or blocked site data
 * just mean no recents, never an error.
 */

/** Result kinds (their labels: shell `palette.sections.*`, people: `palette.people.heading`). */
export type RecentKind = "trades" | "ideas" | "playbook" | "feed" | "research" | "events" | "page" | "ticker" | "people";

export type RecentItem = {
  id: string;
  kind: RecentKind;
  /** Title at save time (pages and people are re-labelled in the current language when shown). */
  title: string;
  subtitle?: string;
  path: string;
  /** Trade / feed row to highlight on the target page. */
  highlight?: number;
  /** Stored name of a person (shown through personName). */
  person?: string;
  /** An office setup: opens its cheat sheet over the current page. */
  sheetId?: number;
};

export const RECENT_MAX = 8;
const KINDS: ReadonlySet<string> = new Set<RecentKind>(["trades", "ideas", "playbook", "feed", "research", "events", "page", "ticker", "people"]);

type KV = Pick<Storage, "getItem" | "setItem">;

/** localStorage, or null where reading it throws (sandboxed frames, disabled storage). */
export function browserStorage(): KV | null {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** One list per user (the stored name is the id everywhere); a signed-out session shares «guest». */
export function recentStorageKey(user: string | null | undefined): string {
  return `ws_lexx.palette.recent.${encodeURIComponent(user || "guest")}`;
}

const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const int = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

/** Well-formed entries only (old or hand-edited data is dropped, not trusted), at most RECENT_MAX, ids unique. */
export function parseRecents(raw: unknown): RecentItem[] {
  if (!Array.isArray(raw)) return [];
  const out: RecentItem[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (!str(o.id) || !str(o.title) || !str(o.path) || !str(o.kind) || !KINDS.has(o.kind) || seen.has(o.id)) continue;
    // In-app paths only: a stored entry must never navigate off the site.
    if (!o.path.startsWith("/") || o.path.startsWith("//")) continue;
    seen.add(o.id);
    out.push({
      id: o.id,
      kind: o.kind as RecentKind,
      title: o.title,
      path: o.path,
      ...(str(o.subtitle) ? { subtitle: o.subtitle } : {}),
      ...(int(o.highlight) ? { highlight: o.highlight } : {}),
      ...(str(o.person) ? { person: o.person } : {}),
      ...(int(o.sheetId) ? { sheetId: o.sheetId } : {}),
    });
    if (out.length >= RECENT_MAX) break;
  }
  return out;
}

/** `item` first, an older copy of it removed, the list cut to `max`. */
export function pushRecent(list: readonly RecentItem[], item: RecentItem, max = RECENT_MAX): RecentItem[] {
  return [item, ...list.filter((r) => r.id !== item.id)].slice(0, max);
}

export function readRecents(user: string | null | undefined, storage: KV | null = browserStorage()): RecentItem[] {
  if (!storage) return [];
  try {
    return parseRecents(JSON.parse(storage.getItem(recentStorageKey(user)) || "[]"));
  } catch {
    return [];
  }
}

/** Saves `item` as the newest recent and returns the new list (the old list when storage is unavailable). */
export function rememberRecent(user: string | null | undefined, item: RecentItem, storage: KV | null = browserStorage()): RecentItem[] {
  const next = pushRecent(readRecents(user, storage), item);
  if (!storage) return next;
  try {
    storage.setItem(recentStorageKey(user), JSON.stringify(next));
  } catch {
    /* quota / blocked: keep the list in memory for this session */
  }
  return next;
}
