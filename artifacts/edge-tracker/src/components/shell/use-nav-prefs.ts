/** Per-user navigation preferences: pinned favourites and collapsed sidebar groups (localStorage, fail-safe). */
import { useCallback, useEffect, useState } from "react";

const PINS_KEY = "ws_lexx_nav_pins";
const COLLAPSED_KEY = "ws_lexx_nav_collapsed";
const SYNC_EVENT = "ws-nav-prefs";

/** At most this many favourites (the block must stay short — it sits above every group). */
export const MAX_PINS = 7;

/**
 * First-visit defaults; the user's own choice (anything written to localStorage) wins afterwards.
 * - Favourites: the daily trader loop (plan → trades → journal → analytics → playbook), 6 items.
 * - Folded groups: the rarely visited ones (Команда, Академия, Админ). The group holding the current page is
 *   always shown expanded by the sidebar regardless (see sidebar-nav.tsx).
 */
export const DEFAULT_PINS = ["/", "/game-plan", "/trades", "/journal", "/analytics", "/playbook"];
export const DEFAULT_COLLAPSED = ["team", "academy", "admin"];
const DEFAULTS: Record<string, string[]> = { [PINS_KEY]: DEFAULT_PINS, [COLLAPSED_KEY]: DEFAULT_COLLAPSED };

function read(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return DEFAULTS[key] ?? [];
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return DEFAULTS[key] ?? [];
  }
}

function write(key: string, v: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {}
  window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: key }));
}

/** A string-set in localStorage that stays in sync across every component using the same key. */
function useStoredSet(key: string, max = Infinity) {
  const [list, setList] = useState<string[]>(() => read(key));
  useEffect(() => {
    const onSync = (e: Event) => {
      const k = (e as CustomEvent<string>).detail;
      if (k === key) setList(read(key));
    };
    const onStorage = (e: StorageEvent) => { if (e.key === key) setList(read(key)); };
    window.addEventListener(SYNC_EVENT, onSync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(SYNC_EVENT, onSync);
      window.removeEventListener("storage", onStorage);
    };
  }, [key]);
  const toggle = useCallback(
    (id: string) => {
      const cur = read(key);
      if (cur.includes(id)) write(key, cur.filter((x) => x !== id));
      else if (cur.length < max) write(key, [...cur, id]);
    },
    [key, max],
  );
  return [list, toggle] as const;
}

export function usePinnedNav() {
  const [pins, togglePin] = useStoredSet(PINS_KEY, MAX_PINS);
  return { pins, togglePin, isPinned: (href: string) => pins.includes(href), canPin: pins.length < MAX_PINS, maxPins: MAX_PINS };
}

export function useCollapsedGroups() {
  const [collapsed, toggleGroup] = useStoredSet(COLLAPSED_KEY);
  /** Fold the given groups (fold=true) or unfold everything (fold=false). */
  const setAll = useCallback((ids: string[], fold: boolean) => write(COLLAPSED_KEY, fold ? ids : []), []);
  return { collapsed, toggleGroup, setAll, isCollapsed: (id: string) => collapsed.includes(id) };
}
