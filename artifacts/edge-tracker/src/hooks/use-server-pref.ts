/**
 * A small personal thing kept on the account (`users.settings.prefs[key]` via PUT /api/users/me/settings, merged per key
 * by the API — lib/people/uiPrefs.ts), so it follows the person to another device and survives a cleared browser
 * (persistence audit, docs/persistence/AUDIT.md). Saved trade views, note templates, quick replies, bookmarks…
 *
 *   const [views, setViews] = useServerPref<SavedView[]>("trades.views", [], { legacyKey: "ws_lexx_trade_views", parse });
 *
 * - First paint: the local mirror of this account (instant), then the server copy wins once it arrives.
 * - `legacyKey`: the old browser-only localStorage key; read once when the server has nothing yet and written up, so
 *   nobody loses what they kept before.
 * - Writes: memory + local mirror at once, the server after a short pause; a failed write keeps the local copy marked
 *   «pending» and is retried on the next load. Guests / signed-out: local only.
 */
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "@/lib/api/http";
import { useAuthOptional } from "@/contexts/auth-context";

const SETTINGS_API = "/api/users/me/settings";
export const SERVER_PREFS_QUERY_KEY = ["users-me-settings", "prefs"] as const;
const MIRROR = "ws_lexx.pref.";
const SAVE_DELAY_MS = 600;

type Mirror = { v: unknown; pending: boolean };

function readMirror(k: string): Mirror | null {
  try {
    const raw = localStorage.getItem(k);
    if (!raw) return null;
    const p = JSON.parse(raw) as Mirror;
    return p && typeof p === "object" && "v" in p ? { v: p.v, pending: p.pending === true } : null;
  } catch {
    return null;
  }
}

function writeMirror(k: string, m: Mirror | null) {
  try {
    if (m) localStorage.setItem(k, JSON.stringify(m));
    else localStorage.removeItem(k);
  } catch {
    /* storage blocked: memory + server only */
  }
}

function readLegacy(key: string | undefined): unknown {
  if (!key) return undefined;
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return undefined;
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  } catch {
    return undefined;
  }
}

export async function putServerPref(key: string, value: unknown): Promise<void> {
  await http.put(SETTINGS_API, { prefs: { [key]: value ?? null } });
}

export function useServerPref<T>(
  key: string,
  fallback: T,
  opts: { legacyKey?: string; parse?: (raw: unknown) => T | null } = {},
): [T, (next: T | ((cur: T) => T)) => void, { synced: boolean }] {
  const auth = useAuthOptional();
  const member = !!auth?.user && auth.user.role !== "guest";
  const account = member ? (auth!.user!.traderName ?? auth!.user!.role) : "local";
  const mirrorKey = `${MIRROR}${account}:${key}`;
  const parse = React.useCallback((raw: unknown): T | null => {
    if (raw === undefined || raw === null) return null;
    return opts.parse ? opts.parse(raw) : (raw as T);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const qc = useQueryClient();
  const server = useQuery({
    queryKey: SERVER_PREFS_QUERY_KEY,
    queryFn: async () => {
      const r = await http.get<{ settings?: { prefs?: Record<string, unknown> } } | null>(SETTINGS_API);
      return r?.settings?.prefs ?? {};
    },
    enabled: member,
    staleTime: 60_000,
  });

  // `legacy`: the value came from the old browser-only key — written up only when the account has none yet (another
  // device's newer list is never overwritten by an old browser copy).
  const [state, setState] = React.useState<{ v: T; pending: boolean; legacy?: boolean }>(() => {
    const m = readMirror(mirrorKey);
    const fromMirror = m ? parse(m.v) : null;
    if (fromMirror != null) return { v: fromMirror, pending: m!.pending };
    const legacy = parse(readLegacy(opts.legacyKey));
    return legacy != null && JSON.stringify(legacy) !== JSON.stringify(fallback) ? { v: legacy, pending: false, legacy: true } : { v: fallback, pending: false };
  });
  const stateRef = React.useRef(state);
  stateRef.current = state;
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const push = React.useCallback(
    (v: T) => {
      if (!member) return;
      putServerPref(key, v)
        .then(() => {
          if (stateRef.current.v !== v) return; // a newer edit is on its way
          setState((s) => ({ ...s, pending: false, legacy: false }));
          writeMirror(mirrorKey, { v, pending: false });
          qc.setQueryData<Record<string, unknown>>(SERVER_PREFS_QUERY_KEY, (cur) => ({ ...(cur ?? {}), [key]: v }));
        })
        .catch(() => {
          /* the global mutation toast is not involved here: the local copy stays pending and is retried on next load */
        });
    },
    [member, key, mirrorKey, qc],
  );

  // The server answered: its value wins, unless this browser holds an edit not saved yet (then write that one up).
  const reconciled = React.useRef(false);
  React.useEffect(() => {
    if (!server.data || reconciled.current) return;
    reconciled.current = true;
    const cur = stateRef.current;
    const fromServer = parse(server.data[key]);
    if (cur.pending || (fromServer == null && cur.legacy)) {
      push(cur.v);
      return;
    }
    if (fromServer != null) {
      setState({ v: fromServer, pending: false });
      writeMirror(mirrorKey, { v: fromServer, pending: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server.data]);

  const set = React.useCallback(
    (next: T | ((cur: T) => T)) => {
      const v = typeof next === "function" ? (next as (cur: T) => T)(stateRef.current.v) : next;
      const s = { v, pending: member };
      stateRef.current = s;
      setState(s);
      writeMirror(mirrorKey, s);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => push(v), SAVE_DELAY_MS);
    },
    [member, mirrorKey, push],
  );

  // Leaving the page with a write still waiting: send it now.
  React.useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        if (stateRef.current.pending) push(stateRef.current.v);
      }
    },
    [push],
  );

  return [state.v, set, { synced: !state.pending && !!server.data }];
}
