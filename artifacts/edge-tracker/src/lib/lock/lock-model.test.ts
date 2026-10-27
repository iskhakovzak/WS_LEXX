import { describe, expect, it } from "vitest";
import {
  MAX_UNLOCK_ATTEMPTS, UNLOCKED, isLockShortcut, lockReducer, mergeRemote, parseAutoLock, parseLockState,
  serializeLockState, shouldAutoLock, unlockResultOf, type LockState,
} from "./lock-model";

const T0 = 1_800_000_000_000;

describe("lock state machine", () => {
  it("lock → locked with the start time and a full set of attempts; locking again changes nothing", () => {
    const s = lockReducer(UNLOCKED, { type: "lock", at: T0 }, T0);
    expect(s).toMatchObject({ locked: true, at: T0, attemptsLeft: MAX_UNLOCK_ATTEMPTS, signedOut: false });
    const again = lockReducer(s, { type: "lock", at: T0 + 5000 }, T0 + 5000);
    expect(again).toBe(s);
  });

  it("server status fills in the code facts; an identical status returns the same object", () => {
    const locked = lockReducer(UNLOCKED, { type: "lock", at: T0 }, T0);
    const s = lockReducer(locked, { type: "status", hasCode: true, kind: "digits", attemptsLeft: 5 }, T0 + 1);
    expect(s).toMatchObject({ hasCode: true, kind: "digits" });
    expect(lockReducer(s, { type: "status", hasCode: true, kind: "digits", attemptsLeft: 5 }, T0 + 2)).toBe(s);
  });

  it("wrong codes count down (clamped), unlock restores the attempts and keeps what we know about the code", () => {
    let s = lockReducer(UNLOCKED, { type: "lock", at: T0 }, T0);
    s = lockReducer(s, { type: "status", hasCode: false, kind: null, attemptsLeft: 5 }, T0);
    s = lockReducer(s, { type: "fail", attemptsLeft: 3 }, T0);
    expect(s.attemptsLeft).toBe(3);
    expect(lockReducer(s, { type: "fail", attemptsLeft: -4 }, T0).attemptsLeft).toBe(0);
    expect(lockReducer(s, { type: "fail", attemptsLeft: 99 }, T0).attemptsLeft).toBe(MAX_UNLOCK_ATTEMPTS);
    const open = lockReducer(s, { type: "unlock" }, T0);
    expect(open).toMatchObject({ locked: false, at: null, attemptsLeft: MAX_UNLOCK_ATTEMPTS, hasCode: false });
    expect(lockReducer(open, { type: "unlock" }, T0)).toBe(open);
  });

  it("signed out: unlocked + flagged; reset forgets everything", () => {
    const locked = lockReducer(UNLOCKED, { type: "lock", at: T0 }, T0);
    const out = lockReducer(locked, { type: "signedOut" }, T0);
    expect(out).toMatchObject({ locked: false, signedOut: true });
    const clean = lockReducer(out, { type: "reset" }, T0);
    expect(clean).toMatchObject({ ...UNLOCKED, rev: clean.rev });
    expect(lockReducer(clean, { type: "reset" }, T0)).toBe(clean);
  });

  it("every change gets a strictly newer stamp, even within one millisecond", () => {
    const a = lockReducer(UNLOCKED, { type: "lock", at: T0 }, T0);
    const b = lockReducer(a, { type: "fail", attemptsLeft: 4 }, T0);
    const c = lockReducer(b, { type: "unlock" }, T0 - 10_000); // a clock that went backwards
    expect(b.rev).toBeGreaterThan(a.rev);
    expect(c.rev).toBeGreaterThan(b.rev);
  });
});

describe("cross-tab merge and storage format", () => {
  const locked: LockState = { ...UNLOCKED, locked: true, at: T0, rev: T0 + 10 };
  it("the newer state wins; equal or older stamps keep ours", () => {
    const mine: LockState = { ...UNLOCKED, rev: T0 };
    expect(mergeRemote(mine, locked)).toBe(locked);
    expect(mergeRemote(locked, { ...UNLOCKED, rev: T0 + 10 })).toBe(locked);
    expect(mergeRemote(locked, { ...UNLOCKED, rev: T0 })).toBe(locked);
    expect(mergeRemote(locked, null)).toBe(locked);
  });

  it("round-trips through localStorage; junk reads as nothing / safe defaults", () => {
    expect(parseLockState(serializeLockState(locked))).toEqual(locked);
    expect(parseLockState("{not json")).toBeNull();
    expect(parseLockState(null)).toBeNull();
    expect(parseLockState("42")).toBeNull();
    expect(parseLockState({ locked: "yes", attemptsLeft: "x", kind: "emoji" })).toEqual({ ...UNLOCKED });
    expect(parseLockState({ locked: false, at: T0 })?.at).toBeNull();
  });
});

describe("shortcut, auto-lock, unlock answers", () => {
  const key = (over: Partial<KeyboardEvent>) => ({ ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, code: "KeyL", repeat: false, ...over }) as KeyboardEvent;
  it("Ctrl+Alt+L by physical key (any layout); not Ctrl+L, Alt+Shift+L, Cmd+Alt+L or a held key", () => {
    expect(isLockShortcut(key({ ctrlKey: true, altKey: true }))).toBe(true);
    expect(isLockShortcut(key({ ctrlKey: true }))).toBe(false);
    expect(isLockShortcut(key({ altKey: true, shiftKey: true }))).toBe(false);
    expect(isLockShortcut(key({ metaKey: true, altKey: true }))).toBe(false);
    expect(isLockShortcut(key({ ctrlKey: true, altKey: true, shiftKey: true }))).toBe(false);
    expect(isLockShortcut(key({ ctrlKey: true, altKey: true, repeat: true }))).toBe(false);
    expect(isLockShortcut(key({ ctrlKey: true, altKey: true, code: "KeyK" }))).toBe(false);
  });

  it("auto-lock: only the offered values, off by default; locks once idle long enough", () => {
    expect(parseAutoLock("10")).toBe(10);
    expect(parseAutoLock("7")).toBe(0);
    expect(parseAutoLock(null)).toBe(0);
    expect(shouldAutoLock(T0, T0 + 4 * 60_000, 5)).toBe(false);
    expect(shouldAutoLock(T0, T0 + 5 * 60_000, 5)).toBe(true);
    expect(shouldAutoLock(T0, T0 + 99 * 60_000, 0)).toBe(false);
  });

  it("maps POST /auth/unlock answers", () => {
    expect(unlockResultOf(200, { ok: true })).toEqual({ ok: true });
    expect(unlockResultOf(403, { code: "UNLOCK_CODE_INVALID", details: { attemptsLeft: 3 } })).toEqual({ ok: false, reason: "wrong", attemptsLeft: 3 });
    expect(unlockResultOf(403, { code: "UNLOCK_CODE_INVALID", details: { attemptsLeft: 0 } })).toEqual({ ok: false, reason: "signedOut" });
    expect(unlockResultOf(401, { code: "UNLOCK_SIGNED_OUT" })).toEqual({ ok: false, reason: "signedOut" });
    expect(unlockResultOf(429, null)).toEqual({ ok: false, reason: "rateLimited" });
    expect(unlockResultOf(400, null)).toEqual({ ok: false, reason: "empty" });
    expect(unlockResultOf(502, null)).toEqual({ ok: false, reason: "network" });
  });
});
