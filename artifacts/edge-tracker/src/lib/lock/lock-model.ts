/**
 * Screen lock «Заблокировать» — the pure part: state machine, storage format, cross-tab merge, shortcut, auto-lock.
 * The store with side effects (localStorage, BroadcastChannel, API) is ./lock-store.ts; the screen is
 * components/lock/lock-screen.tsx. Server side: api-server lib/security/screenLock.ts.
 *
 * One lock per browser profile (every tab shares the token, so every tab shares the lock): a new tab opens locked.
 */

export const MAX_UNLOCK_ATTEMPTS = 5;

/** Fired on window when the API answers 423 SESSION_LOCKED (lib/install-fetch-auth): the server says we are locked. */
export const SESSION_LOCKED_EVENT = "ws-session-locked";
export type QuickCodeKind = "digits" | "phrase";

export type LockState = {
  locked: boolean;
  /** When the lock started (ms), null when unlocked. */
  at: number | null;
  /** From the server (POST /auth/lock): a quick code is set; null = not known yet. */
  hasCode: boolean | null;
  kind: QuickCodeKind | null;
  attemptsLeft: number;
  /** The 5th wrong answer ended the session: every tab signs out. */
  signedOut: boolean;
  /** Change stamp (ms, strictly increasing per writer): the newer state wins across tabs. */
  rev: number;
};

export const UNLOCKED: LockState = { locked: false, at: null, hasCode: null, kind: null, attemptsLeft: MAX_UNLOCK_ATTEMPTS, signedOut: false, rev: 0 };

export type LockEvent =
  | { type: "lock"; at: number }
  | { type: "status"; hasCode: boolean; kind: QuickCodeKind | null; attemptsLeft: number }
  | { type: "fail"; attemptsLeft: number }
  | { type: "unlock" }
  | { type: "signedOut" }
  | { type: "reset" };

const clampAttempts = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.min(MAX_UNLOCK_ATTEMPTS, Math.round(n))) : MAX_UNLOCK_ATTEMPTS);

/** The state machine. `now` stamps `rev` (never moves backwards). Unchanged state is returned as is. */
export function lockReducer(s: LockState, e: LockEvent, now = Date.now()): LockState {
  const rev = Math.max(now, s.rev + 1);
  switch (e.type) {
    case "lock":
      // Locking again keeps the original start and the attempts already spent.
      return s.locked ? s : { ...s, locked: true, at: e.at, attemptsLeft: MAX_UNLOCK_ATTEMPTS, signedOut: false, rev };
    case "status": {
      const attemptsLeft = clampAttempts(e.attemptsLeft);
      if (s.hasCode === e.hasCode && s.kind === e.kind && s.attemptsLeft === attemptsLeft) return s;
      return { ...s, hasCode: e.hasCode, kind: e.kind, attemptsLeft, rev };
    }
    case "fail":
      return { ...s, attemptsLeft: clampAttempts(e.attemptsLeft), rev };
    case "unlock":
      return s.locked ? { ...s, locked: false, at: null, attemptsLeft: MAX_UNLOCK_ATTEMPTS, rev } : s;
    case "signedOut":
      return { ...UNLOCKED, signedOut: true, rev };
    case "reset":
      return s.locked || s.signedOut || s.hasCode !== null ? { ...UNLOCKED, rev } : s;
  }
}

/** Another tab's state replaces ours only when it is newer (equal stamps: keep ours). */
export function mergeRemote(local: LockState, remote: LockState | null): LockState {
  return remote && remote.rev > local.rev ? remote : local;
}

/** localStorage value → state (anything malformed counts as unlocked). */
export function parseLockState(raw: unknown): LockState | null {
  let v: unknown = raw;
  if (typeof raw === "string") {
    try { v = JSON.parse(raw); } catch { return null; }
  }
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const locked = o.locked === true;
  return {
    locked,
    at: locked && typeof o.at === "number" ? o.at : null,
    hasCode: typeof o.hasCode === "boolean" ? o.hasCode : null,
    kind: o.kind === "digits" || o.kind === "phrase" ? o.kind : null,
    attemptsLeft: clampAttempts(o.attemptsLeft),
    signedOut: o.signedOut === true,
    rev: typeof o.rev === "number" && Number.isFinite(o.rev) ? o.rev : 0,
  };
}

export function serializeLockState(s: LockState): string {
  return JSON.stringify(s);
}

// ─── Shortcut ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Ctrl+Alt+L (Mac: ⌃⌥L) — the Linux «lock screen» chord; free in Chrome, Edge, Firefox and Windows (Ctrl+L is the
 * address bar, Win+L the OS lock, Alt+Shift switches the keyboard layout on Windows). Matched on the physical key, so
 * it works on the Russian layout too.
 */
export const LOCK_KEYS = ["Ctrl", "Alt", "L"] as const;

export function isLockShortcut(e: Pick<KeyboardEvent, "ctrlKey" | "altKey" | "shiftKey" | "metaKey" | "code" | "repeat">): boolean {
  return e.ctrlKey && e.altKey && !e.shiftKey && !e.metaKey && !e.repeat && e.code === "KeyL";
}

// ─── Auto-lock ────────────────────────────────────────────────────────────────────────────────────────────

export const AUTO_LOCK_OPTIONS = [0, 5, 10, 15, 30] as const;
export type AutoLockMinutes = (typeof AUTO_LOCK_OPTIONS)[number];

export function parseAutoLock(raw: unknown): AutoLockMinutes {
  const n = Number(raw);
  return (AUTO_LOCK_OPTIONS as readonly number[]).includes(n) ? (n as AutoLockMinutes) : 0;
}

/** Idle long enough to lock by itself? (0 = auto-lock off.) */
export function shouldAutoLock(lastActivityMs: number, nowMs: number, minutes: number): boolean {
  return minutes > 0 && nowMs - lastActivityMs >= minutes * 60_000;
}

// ─── Unlock answer ────────────────────────────────────────────────────────────────────────────────────────

export type UnlockResult =
  | { ok: true }
  | { ok: false; reason: "wrong"; attemptsLeft: number }
  | { ok: false; reason: "signedOut" | "rateLimited" | "network" | "empty" };

/** POST /auth/unlock response (status + body) → what the lock screen does next. */
export function unlockResultOf(status: number, body: unknown): UnlockResult {
  const b = (body && typeof body === "object" ? body : {}) as { code?: unknown; details?: { attemptsLeft?: unknown } };
  if (status >= 200 && status < 300) return { ok: true };
  if (status === 401) return { ok: false, reason: "signedOut" };
  if (status === 429) return { ok: false, reason: "rateLimited" };
  if (status === 403 && b.code === "UNLOCK_CODE_INVALID") {
    const left = clampAttempts(b.details?.attemptsLeft);
    return left === 0 ? { ok: false, reason: "signedOut" } : { ok: false, reason: "wrong", attemptsLeft: left };
  }
  if (status === 400) return { ok: false, reason: "empty" };
  return { ok: false, reason: "network" };
}
