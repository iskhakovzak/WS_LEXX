/**
 * Screen lock store: the state of ./lock-model.ts kept in localStorage (survives reloads, a new tab opens locked) and
 * synced across tabs by BroadcastChannel + the storage event (the newer `rev` wins). Talks to the API:
 * POST /auth/lock (records the lock server-side and reports whether a quick code is set) and POST /auth/unlock.
 * React reads it with useLockState(); anything else with lockStore.get(). Outside React on purpose: the toaster and the
 * app root read it above the providers.
 */
import { useSyncExternalStore } from "react";
import { http } from "@/lib/api/http";
import {
  SESSION_LOCKED_EVENT, UNLOCKED, lockReducer, mergeRemote, parseAutoLock, parseLockState, serializeLockState, unlockResultOf,
  type AutoLockMinutes, type LockEvent, type LockState, type QuickCodeKind, type UnlockResult,
} from "./lock-model";

const KEY = "ws_lexx_lock";
const CHANNEL = "ws_lexx_lock";
/** After an unlock, a 423 from a request already in flight (or another API process's 3 s cache) is not a new lock. */
const UNLOCK_GRACE_MS = 8_000;

function readStored(): LockState {
  try { return parseLockState(localStorage.getItem(KEY)) ?? UNLOCKED; } catch { return UNLOCKED; }
}

let state: LockState = typeof window === "undefined" ? UNLOCKED : readStored();
let unlockedAt = 0;
const listeners = new Set<() => void>();
let channel: BroadcastChannel | null = null;

function emit() {
  for (const l of listeners) l();
}

// ─── Scroll of the page under the lock (per tab) ──────────────────────────────────────────────────────────
const SCROLL_KEY = "ws_lexx_lock_scroll";

/** Remember where #main-content was scrolled before the routes unmount (restored after the unlock). */
function saveScroll() {
  const top = typeof document === "undefined" ? 0 : document.getElementById("main-content")?.scrollTop ?? 0;
  try { sessionStorage.setItem(SCROLL_KEY, JSON.stringify({ path: location.pathname + location.search, top })); } catch { /* ignore */ }
}

/** The scroll offset saved at the lock, if this tab is still on the same page; read once. */
export function takeSavedScroll(): number | null {
  try {
    const raw = sessionStorage.getItem(SCROLL_KEY);
    sessionStorage.removeItem(SCROLL_KEY);
    const v = raw ? (JSON.parse(raw) as { path?: string; top?: number }) : null;
    return v && v.path === location.pathname + location.search && typeof v.top === "number" && v.top > 0 ? v.top : null;
  } catch {
    return null;
  }
}

/** Fired on window by requestLock(): the lock controller decides (first lock without a code asks for one). */
export const LOCK_REQUEST_EVENT = "ws-lock-request";

/** Header button, user menu, Ctrl+K palette and the shortcut call this (the controller lives in components/lock). */
export function requestLock(): void {
  window.dispatchEvent(new Event(LOCK_REQUEST_EVENT));
}

function persist(next: LockState) {
  try { localStorage.setItem(KEY, serializeLockState(next)); } catch { /* storage blocked: this tab only */ }
  try { channel?.postMessage(next); } catch { /* closed */ }
}

function apply(e: LockEvent): LockState {
  const next = lockReducer(state, e);
  if (next === state) return state;
  if (state.locked && !next.locked) unlockedAt = Date.now();
  if (!state.locked && next.locked) saveScroll();
  state = next;
  persist(next);
  emit();
  return next;
}

function adoptRemote(remote: LockState | null) {
  const next = mergeRemote(state, remote);
  if (next === state) return;
  if (state.locked && !next.locked) unlockedAt = Date.now();
  if (!state.locked && next.locked) saveScroll();
  state = next;
  emit();
}

function connect() {
  if (typeof window === "undefined" || channel !== null) return;
  try {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (ev) => adoptRemote(parseLockState(ev.data));
  } catch { channel = null; }
  window.addEventListener("storage", (ev) => {
    if (ev.key === KEY) adoptRemote(parseLockState(ev.newValue) ?? { ...UNLOCKED, rev: Date.now() });
  });
  window.addEventListener(SESSION_LOCKED_EVENT, () => {
    if (!state.locked && Date.now() - unlockedAt > UNLOCK_GRACE_MS) lockStore.lock();
  });
}

type LockStatus = { hasCode?: unknown; kind?: unknown; attemptsLeft?: unknown };

function applyStatus(body: LockStatus | null) {
  if (!body || typeof body.hasCode !== "boolean") return;
  const kind = body.kind === "digits" || body.kind === "phrase" ? (body.kind as QuickCodeKind) : null;
  apply({ type: "status", hasCode: body.hasCode, kind, attemptsLeft: typeof body.attemptsLeft === "number" ? body.attemptsLeft : state.attemptsLeft });
}

/** Any status comes back as data (the unlock answers 403 / 401 / 429 on purpose); a network failure throws. */
async function post(path: string, body?: unknown): Promise<{ status: number; body: unknown }> {
  const r = await http.raw(`/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    throwOnError: false,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

export const lockStore = {
  get: (): LockState => state,
  subscribe(fn: () => void): () => void {
    connect();
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  /** Lock now (screen first, then the server). Offline still locks: unlock always checks the code on the server. */
  lock(): void {
    connect();
    if (state.locked) return;
    apply({ type: "lock", at: Date.now() });
    void post("/auth/lock").then((r) => { if (r.status === 200) applyStatus(r.body as LockStatus); }).catch(() => undefined);
  },
  /** Re-read the server status (attempts left, code set) — the lock screen on mount. */
  async refreshStatus(): Promise<void> {
    try {
      const r = await http.raw("/api/auth/lock", { throwOnError: false });
      if (r.ok) applyStatus((await r.json().catch(() => null)) as LockStatus);
    } catch { /* offline */ }
  },
  /** `beforeApply` (the success animation) runs once the server said yes and before the screen goes away. */
  async unlock(code: string, opts: { beforeApply?: () => Promise<void> } = {}): Promise<UnlockResult> {
    if (!code) return { ok: false, reason: "empty" };
    let res: UnlockResult;
    try {
      const r = await post("/auth/unlock", { code });
      res = unlockResultOf(r.status, r.body);
    } catch {
      res = { ok: false, reason: "network" };
    }
    if (res.ok) {
      try { await opts.beforeApply?.(); } catch { /* an animation never blocks the unlock */ }
      apply({ type: "unlock" });
    }
    else if (res.reason === "wrong") apply({ type: "fail", attemptsLeft: res.attemptsLeft });
    else if (res.reason === "signedOut") apply({ type: "signedOut" });
    return res;
  },
  /** Sign-out / sign-in: forget the lock (and the signed-out flag once handled). */
  reset(): void {
    apply({ type: "reset" });
  },
};

export function useLockState(): LockState {
  return useSyncExternalStore(lockStore.subscribe, lockStore.get, () => UNLOCKED);
}

// ─── Per-browser preferences (Settings → Безопасность) ───────────────────────────────────────────────────

const AUTO_KEY = "ws_lexx_autolock";
const NO_CODE_KEY = "ws_lexx_lock_nocode";
const PREFS_EVENT = "ws-lock-prefs";

function readLocal(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeLocal(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* storage blocked */ }
  window.dispatchEvent(new Event(PREFS_EVENT));
}

function subscribePrefs(fn: () => void): () => void {
  const onStorage = (e: StorageEvent) => { if (e.key === AUTO_KEY || e.key === NO_CODE_KEY) fn(); };
  window.addEventListener(PREFS_EVENT, fn);
  window.addEventListener("storage", onStorage);
  return () => { window.removeEventListener(PREFS_EVENT, fn); window.removeEventListener("storage", onStorage); };
}

/** Auto-lock after N idle minutes on this browser (0 = off). */
export const readAutoLock = (): AutoLockMinutes => parseAutoLock(readLocal(AUTO_KEY));
export const writeAutoLock = (m: AutoLockMinutes) => writeLocal(AUTO_KEY, m ? String(m) : null);
export function useAutoLock(): AutoLockMinutes {
  return useSyncExternalStore(subscribePrefs, readAutoLock, () => 0 as AutoLockMinutes);
}

/** «Пока без кода» was chosen on the first lock: do not ask again on this browser. */
export const noCodeAccepted = (): boolean => readLocal(NO_CODE_KEY) === "1";
export const acceptNoCode = (on = true) => writeLocal(NO_CODE_KEY, on ? "1" : null);

/** Tests only: close this tab's channel (a store module instance = one simulated tab). */
export function disposeLockStoreForTests(): void {
  channel?.close();
}
