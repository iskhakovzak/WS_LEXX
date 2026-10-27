/**
 * One piece of a screen's navigation context kept in the URL (`?tab=`, `?trader=`, `?day=`…) so a reload, a shared
 * link and back/forward keep it (persistence audit, docs/persistence/AUDIT.md).
 *
 *   const [tab, setTab] = useSearchParam("tab", "overview", { allowed: ["overview", "limits"] });
 *   const [trader, setTrader] = useSearchParam("trader", "", { storageKey: "risk.trader" });
 *
 * - Read: the URL param (reactive: an in-app link to the same page with a new value is followed) → the optional
 *   localStorage copy (a bare URL still opens on the last choice) → `fallback`. A value outside `allowed` is ignored.
 * - Write: history replace (no new history entry), every other param kept; the fallback / "" / null removes the param.
 *   With `storageKey` the value is also remembered in localStorage (try/catch: private mode keeps it in the URL only).
 */
import * as React from "react";
import { useSearch } from "wouter";

const LS_PREFIX = "ws_lexx.url.";

function readLs(key: string | undefined): string | null {
  if (!key) return null;
  try {
    return localStorage.getItem(LS_PREFIX + key);
  } catch {
    return null;
  }
}

function writeLs(key: string | undefined, v: string | null) {
  if (!key) return;
  try {
    if (v == null || v === "") localStorage.removeItem(LS_PREFIX + key);
    else localStorage.setItem(LS_PREFIX + key, v);
  } catch {
    /* storage unavailable: the URL still carries it */
  }
}

/** Replace the current URL's params (null / "" / equal to `defaults[k]` removes k). Pure on its inputs; no navigation. */
export function replaceSearchParams(updates: Record<string, string | null | undefined>, defaults: Record<string, string> = {}) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  for (const [k, v] of Object.entries(updates)) {
    if (v == null || v === "" || defaults[k] === v) url.searchParams.delete(k);
    else url.searchParams.set(k, v);
  }
  const next = `${url.pathname}${url.search}${url.hash}`;
  const cur = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next !== cur) window.history.replaceState(window.history.state, "", next);
}

export type SearchParamOptions = {
  /** Accepted values; anything else (a stale or hand-edited link) falls back. */
  allowed?: readonly string[];
  /** Also remember the last choice in localStorage under this key (for a bare URL). */
  storageKey?: string;
};

export function useSearchParam(name: string, fallback: string, opts: SearchParamOptions = {}): [string, (v: string | null) => void] {
  const search = useSearch();
  const { allowed, storageKey } = opts;
  const ok = React.useCallback((v: string | null): v is string => v != null && v !== "" && (!allowed || allowed.includes(v)), [allowed]);
  const fromUrl = new URLSearchParams(search).get(name);
  // The local choice made on this page (covers the moment before wouter re-renders on replaceState).
  const [local, setLocal] = React.useState<string | null>(() => (ok(fromUrl) ? null : readLs(storageKey)));
  const value = ok(fromUrl) ? fromUrl : ok(local) ? local : fallback;

  const set = React.useCallback(
    (v: string | null) => {
      const next = v == null || v === "" ? null : v;
      setLocal(next ?? fallback);
      writeLs(storageKey, next === fallback ? null : next);
      replaceSearchParams({ [name]: next }, { [name]: fallback });
    },
    [name, fallback, storageKey],
  );
  return [value, set];
}

/** Numeric id variant (`?id=42`): null when absent or not a positive integer. */
export function useSearchParamId(name: string): [number | null, (v: number | null) => void] {
  const [raw, setRaw] = useSearchParam(name, "");
  const n = Number(raw);
  const value = raw && Number.isInteger(n) && n > 0 ? n : null;
  const set = React.useCallback((v: number | null) => setRaw(v == null ? null : String(v)), [setRaw]);
  return [value, set];
}
