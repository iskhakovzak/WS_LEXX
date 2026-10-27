/**
 * A local draft of text the person is typing (persistence audit, docs/persistence/AUDIT.md): a reload, a closed sheet
 * or a server that is restarting must not eat a paragraph. The draft lives in localStorage per signed-in account and
 * per `key` (e.g. `trade-review:42`) until the save succeeds (`clear()`), or until the text equals the saved value.
 *
 *   const draft = useTextDraft(open ? `idea:${id ?? "new"}` : null, form, setForm, { base: initialForm });
 *   …on success: draft.clear();
 *
 * - `value` may be a string or a plain object of fields (stored as JSON); `restore` gets the stored draft back once per
 *   key when it differs from `base` (the server copy the form opened with).
 * - Writes are debounced (400 ms) and flushed when the tab is hidden or closed.
 * - `key = null` turns it off (dialog closed, no account). Every storage access is in try/catch.
 */
import * as React from "react";
import { useAuthOptional } from "@/contexts/auth-context";

const PREFIX = "ws_lexx.draft.";
const DEBOUNCE_MS = 400;

type Stored<T> = { v: T; at: string };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function isEmpty(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === "string") return v.trim() === "";
  if (typeof v === "object") return Object.values(v as Record<string, unknown>).every((x) => (typeof x === "string" ? x.trim() === "" : x == null || (Array.isArray(x) && x.length === 0)));
  return false;
}

export function readTextDraft<T>(fullKey: string): T | null {
  try {
    const raw = localStorage.getItem(fullKey);
    if (!raw) return null;
    const p = JSON.parse(raw) as Stored<T>;
    return p && typeof p === "object" && "v" in p ? p.v : null;
  } catch {
    return null;
  }
}

function writeDraft(fullKey: string, v: unknown) {
  try {
    localStorage.setItem(fullKey, JSON.stringify({ v, at: new Date().toISOString() }));
  } catch {
    /* storage full / blocked: the text stays in memory only */
  }
}

function removeDraft(fullKey: string) {
  try {
    localStorage.removeItem(fullKey);
  } catch {
    /* ignore */
  }
}

export type TextDraft = {
  /** Drop the stored draft (call after a successful save or an explicit discard). */
  clear: () => void;
  /** True when the form was refilled from a draft on open (show «Черновик восстановлен» if useful). */
  restored: boolean;
};

export function useTextDraft<T>(key: string | null, value: T, restore: (v: T) => void, opts: { base?: T } = {}): TextDraft {
  const auth = useAuthOptional();
  const account = auth?.user && auth.user.role !== "guest" ? (auth.user.traderName ?? auth.user.role) : null;
  const fullKey = key && account ? `${PREFIX}${account}:${key}` : null;
  const [restored, setRestored] = React.useState(false);
  const loadedFor = React.useRef<string | null>(null);
  const restoreRef = React.useRef(restore);
  restoreRef.current = restore;
  const baseRef = React.useRef(opts.base);
  baseRef.current = opts.base;
  const latest = React.useRef(value);
  latest.current = value;
  const dirty = React.useRef(false);

  // Once per key: bring a stored draft back (when it says more than the saved copy).
  React.useEffect(() => {
    if (!fullKey || loadedFor.current === fullKey) return;
    loadedFor.current = fullKey;
    dirty.current = false;
    const stored = readTextDraft<T>(fullKey);
    if (stored != null && !isEmpty(stored) && !same(stored, baseRef.current) && !same(stored, latest.current)) {
      restoreRef.current(stored);
      setRestored(true);
    } else {
      setRestored(false);
      if (stored != null && same(stored, baseRef.current)) removeDraft(fullKey);
    }
  }, [fullKey]);

  const flush = React.useCallback(() => {
    if (!fullKey || loadedFor.current !== fullKey || !dirty.current) return;
    dirty.current = false;
    const v = latest.current;
    if (isEmpty(v) || same(v, baseRef.current)) removeDraft(fullKey);
    else writeDraft(fullKey, v);
  }, [fullKey]);

  React.useEffect(() => {
    if (!fullKey || loadedFor.current !== fullKey) return;
    dirty.current = true;
    const id = setTimeout(flush, DEBOUNCE_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullKey, JSON.stringify(value)]);

  React.useEffect(() => {
    if (!fullKey) return;
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      flush();
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [fullKey, flush]);

  const clear = React.useCallback(() => {
    dirty.current = false;
    setRestored(false);
    if (fullKey) removeDraft(fullKey);
  }, [fullKey]);

  return { clear, restored };
}
