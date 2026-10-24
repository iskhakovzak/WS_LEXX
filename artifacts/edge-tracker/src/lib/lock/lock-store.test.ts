/**
 * Cross-tab sync of the screen lock: each fresh import of ./lock-store is one browser tab. They share a fake
 * localStorage and Node's real BroadcastChannel (works across module instances in one process), like tabs of one
 * browser profile. The API is a fetch stub.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Store = typeof import("./lock-store");

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => { m.delete(k); },
    setItem: (k, v) => { m.set(k, String(v)); },
  };
}

let tabs: Store[] = [];
let answer: { status: number; body: unknown } = { status: 200, body: {} };
const calls: { url: string; body: unknown }[] = [];

async function openTab(): Promise<Store> {
  vi.resetModules();
  const tab = await import("./lock-store");
  tab.lockStore.subscribe(() => undefined); // connects the channel, like a mounted component
  tabs.push(tab);
  return tab;
}

const settle = () => new Promise((r) => setTimeout(r, 30));

beforeEach(() => {
  const win = new EventTarget();
  vi.stubGlobal("window", win);
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("sessionStorage", memoryStorage());
  vi.stubGlobal("location", { pathname: "/trades", search: "?view=list" });
  vi.stubGlobal("document", { getElementById: () => ({ scrollTop: 640 }) });
  calls.length = 0;
  answer = { status: 200, body: {} };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.endsWith("/api/auth/lock")) return new Response(JSON.stringify({ locked: true, hasCode: true, kind: "digits", attemptsLeft: 5 }), { status: 200 });
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  }));
});

afterEach(() => {
  for (const t of tabs) t.disposeLockStoreForTests();
  tabs = [];
  vi.unstubAllGlobals();
});

describe("screen lock across tabs", () => {
  it("locking one tab locks the others; a tab opened later starts locked", async () => {
    const a = await openTab();
    const b = await openTab();
    a.lockStore.lock();
    expect(a.lockStore.get().locked).toBe(true);
    await settle();
    expect(b.lockStore.get().locked).toBe(true);
    // The server recorded it and said a code is set.
    expect(calls.some((c) => c.url.endsWith("/api/auth/lock"))).toBe(true);
    expect(a.lockStore.get().hasCode).toBe(true);
    const c = await openTab();
    expect(c.lockStore.get().locked).toBe(true);
  });

  it("unlocking in any tab opens all of them", async () => {
    const a = await openTab();
    const b = await openTab();
    a.lockStore.lock();
    await settle();
    answer = { status: 200, body: { ok: true } };
    const res = await b.lockStore.unlock("1357");
    expect(res).toEqual({ ok: true });
    expect(calls.find((c) => c.url.endsWith("/api/auth/unlock"))?.body).toEqual({ code: "1357" });
    await settle();
    expect(a.lockStore.get().locked).toBe(false);
    expect(b.lockStore.get().locked).toBe(false);
  });

  it("a wrong code shows the same attempts left everywhere; the 5th signs every tab out", async () => {
    const a = await openTab();
    const b = await openTab();
    a.lockStore.lock();
    await settle();
    answer = { status: 403, body: { code: "UNLOCK_CODE_INVALID", details: { attemptsLeft: 2 } } };
    expect(await a.lockStore.unlock("0000")).toEqual({ ok: false, reason: "wrong", attemptsLeft: 2 });
    await settle();
    expect(b.lockStore.get()).toMatchObject({ locked: true, attemptsLeft: 2 });
    answer = { status: 401, body: { code: "UNLOCK_SIGNED_OUT" } };
    expect((await a.lockStore.unlock("0000")).ok).toBe(false);
    await settle();
    expect(b.lockStore.get()).toMatchObject({ locked: false, signedOut: true });
  });

  it("an empty code never reaches the server", async () => {
    const a = await openTab();
    a.lockStore.lock();
    expect(await a.lockStore.unlock("")).toEqual({ ok: false, reason: "empty" });
    expect(calls.some((c) => c.url.endsWith("/api/auth/unlock"))).toBe(false);
  });

  it("a 423 from the server locks the tab, except right after an unlock (requests already in flight)", async () => {
    const { SESSION_LOCKED_EVENT } = await import("./lock-model");
    const a = await openTab();
    window.dispatchEvent(new Event(SESSION_LOCKED_EVENT));
    expect(a.lockStore.get().locked).toBe(true);
    answer = { status: 200, body: { ok: true } };
    await a.lockStore.unlock("1357");
    window.dispatchEvent(new Event(SESSION_LOCKED_EVENT));
    expect(a.lockStore.get().locked).toBe(false);
  });

  it("remembers the page scroll at the lock and hands it back once, on the same page only", async () => {
    const a = await openTab();
    a.lockStore.lock();
    expect(a.takeSavedScroll()).toBe(640);
    expect(a.takeSavedScroll()).toBeNull();
    a.lockStore.reset();
    a.lockStore.lock();
    vi.stubGlobal("location", { pathname: "/journal", search: "" });
    expect(a.takeSavedScroll()).toBeNull();
  });

  it("requestLock goes through the controller event; reset forgets the lock", async () => {
    const a = await openTab();
    const seen = vi.fn();
    window.addEventListener(a.LOCK_REQUEST_EVENT, seen);
    a.requestLock();
    expect(seen).toHaveBeenCalledTimes(1);
    expect(a.lockStore.get().locked).toBe(false); // the controller decides; nothing locks by itself
    a.lockStore.lock();
    a.lockStore.reset();
    expect(a.lockStore.get().locked).toBe(false);
  });
});
