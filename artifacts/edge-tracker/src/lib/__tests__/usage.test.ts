/**
 * lib/usage.ts — route normalisation (identical to the server allow-list in api-server/src/lib/usage/keys.ts), action
 * dedupe and the signed-in guard (guests and signed-out pages are never tracked).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const post = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => ({ enabled: true })));
vi.mock("@/lib/api/http", () => ({ http: { post } }));
import { __resetUsage, flushUsage, normaliseView, trackAction, trackView } from "@/lib/usage";
import { normaliseView as serverNormalise } from "../../../../api-server/src/lib/usage/keys";

const CASES: [string, string][] = [
  ["/", ""],
  ["/playbook", ""],
  ["/playbook", "?mode=mine&id=42"],
  ["/trades/1234", "?trader=X&tab=notes"],
  ["/chart/AAPL/2026-09-16", ""],
  ["/desk-day", "?ticker=META&date=2026-09-16"],
  [`/trader/${encodeURIComponent("Кирилл Б.")}`, ""],
  ["/ratings", "?tab=quests"],
  ["/admin", "?tab=Usage"],
  ["/a/b/c/d/e", ""],
  ["/x/3f2a9c1e-0b7d-4a1e", "#hash"],
  ["nope", ""],
];

describe("normaliseView", () => {
  it("drops ids, dates, tickers, names and most of the query", () => {
    expect(normaliseView("/trades/1234", "?trader=X&tab=notes")).toBe("/trades/:id?tab=notes");
    expect(normaliseView("/desk-day", "?ticker=META&date=2026-09-16")).toBe("/desk-day");
    expect(normaliseView("/chart/AAPL/2026-09-16")).toBe("/chart/:ticker/:date");
    expect(normaliseView(`/trader/${encodeURIComponent("Кирилл Б.")}`)).toBe("/trader/:param");
  });
  it.each(CASES)("same as the server: %s%s", (path, search) => {
    expect(normaliseView(path, search)).toBe(serverNormalise(path, search));
  });
});

type Store = Record<string, string>;
function stubStorage(store: Store) {
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
  });
}

describe("queue", () => {
  let q: ReturnType<typeof __resetUsage>;
  beforeEach(() => { q = __resetUsage(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("tracks nothing when signed out or as a guest", () => {
    stubStorage({});
    trackView("/trades");
    stubStorage({ ws_lexx_token: "t", ws_lexx_session: JSON.stringify({ role: "guest" }) });
    trackView("/journal");
    trackAction("daily.review");
    expect(q.queued()).toEqual([]);
  });

  it("queues normalised views once per change and dedupes actions for 30 s", () => {
    stubStorage({ ws_lexx_token: "t", ws_lexx_session: JSON.stringify({ role: "trader", traderName: "X" }) });
    trackView("/trades/1");
    trackView("/trades/2"); // same pattern → once
    trackView("/journal");
    trackAction("trainer.start", { mode: "daily" });
    trackAction("trainer.start", { mode: "daily" }); // within 30 s → once
    trackAction("trainer.start", { mode: "free" });
    trackAction("playbook.cheat", { code: "1.3" });
    const got = q.queued().map((e) => [e.kind, e.key, e.meta ?? null]);
    expect(got).toEqual([
      ["view", "/trades/:id", null],
      ["view", "/journal", null],
      ["action", "trainer.start", { mode: "daily" }],
      ["action", "trainer.start", { mode: "free" }],
      ["action", "playbook.cheat", { code: "1.3" }],
    ]);
  });

  it("sends each session's events with that session's token (a new sign-in never takes them over)", () => {
    post.mockClear();
    const store: Store = { ws_lexx_token: "tok-A", ws_lexx_session: JSON.stringify({ role: "trader" }) };
    stubStorage(store);
    trackView("/journal");
    store.ws_lexx_token = "tok-B";
    store.ws_lexx_session = JSON.stringify({ role: "admin" });
    trackView("/admin");
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0]![1]).toMatchObject({ events: [{ kind: "view", key: "/journal" }] });
    expect(post.mock.calls[0]![2]).toMatchObject({ keepalive: true, headers: { Authorization: "Bearer tok-A" } });
    flushUsage();
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[1]![2]).toMatchObject({ headers: { Authorization: "Bearer tok-B" } });
  });
});
