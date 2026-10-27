import { describe, expect, it } from "vitest";
import { adoptFormerNames, moveNameKeys } from "./rename-local";

function memory(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return {
    m,
    get length() { return m.size; },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
  };
}

const OLD = "Закир";
const NEW = "Zakir Iskhakov";

describe("rename-local", () => {
  it("moves name-keyed entries and picked trader names; other people and other keys stay", () => {
    const s = memory({
      [`ws-feed-state:${OLD}`]: "feed",
      [`journal-day:v2:${OLD}:2026-10-20`]: "draft",
      [`journal-day:v2:${OLD} X:2026-10-20`]: "someone else",
      [`ws_lexx_nav_simple:${OLD}`]: "1",
      [`ws_lexx.shareCard.prefs.${OLD}`]: "{}",
      "behavior.trader.v2": OLD,
      "dayReport.trader": "chert",
      "ws.simulator.prefs.v1": JSON.stringify({ period: "m", trader: OLD }),
      "ws_lexx_token": "t",
    });
    expect(moveNameKeys(s, OLD, NEW)).toBe(6);
    expect(Object.fromEntries(s.m)).toEqual({
      [`ws-feed-state:${NEW}`]: "feed",
      [`journal-day:v2:${NEW}:2026-10-20`]: "draft",
      [`journal-day:v2:${OLD} X:2026-10-20`]: "someone else",
      [`ws_lexx_nav_simple:${NEW}`]: "1",
      [`ws_lexx.shareCard.prefs.${NEW}`]: "{}",
      "behavior.trader.v2": NEW,
      "dayReport.trader": "chert",
      "ws.simulator.prefs.v1": JSON.stringify({ period: "m", trader: NEW }),
      "ws_lexx_token": "t",
    });
  });

  it("an entry already under the new name wins", () => {
    const s = memory({ [`ws-feed-state:${OLD}`]: "old", [`ws-feed-state:${NEW}`]: "new" });
    moveNameKeys(s, OLD, NEW);
    expect(Object.fromEntries(s.m)).toEqual({ [`ws-feed-state:${NEW}`]: "new" });
  });

  it("adoptFormerNames: every earlier name from the sign-in moves to the current one; junk is ignored", () => {
    const s = memory({ [`ws-feed-state:${OLD}`]: "feed", "ws_lexx_nav_simple:Zakir": "1", "dayReport.trader": OLD });
    expect(adoptFormerNames([OLD, "Zakir", 42, null], NEW, s)).toBe(3);
    expect(Object.fromEntries(s.m)).toEqual({ [`ws-feed-state:${NEW}`]: "feed", [`ws_lexx_nav_simple:${NEW}`]: "1", "dayReport.trader": NEW });
    expect(adoptFormerNames(undefined, NEW, s)).toBe(0);
    expect(adoptFormerNames([OLD], NEW, s)).toBe(0);
  });
});
