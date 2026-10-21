/** lib/watchlist/scope.ts — the two-watchlist rules (Волна 1, item 1.18). Pure. */
import { describe, expect, it } from "vitest";
import { canEditDesk, canReadRow, canWriteRow, normalizeWatchView, ownerOf, parseScope, readScope, type WatchActor } from "../watchlist/scope";

const trader: WatchActor = { id: 5, name: "T", role: "trader", guest: false, senior: false };
const senior: WatchActor = { ...trader, id: 7, senior: true };
const curator: WatchActor = { ...trader, id: 8, role: "curator" };
const admin: WatchActor = { ...trader, id: 9, role: "admin" };
const guest: WatchActor = { id: 0, name: "guest", role: "guest", guest: true, senior: false };

describe("watchlist scope rules", () => {
  it("desk list: everyone reads, seniors and staff write", () => {
    for (const a of [trader, senior, curator, admin, guest]) expect(canReadRow(a, null)).toBe(true);
    expect(canReadRow(null, null)).toBe(false);
    expect([trader, senior, curator, admin, guest].map((a) => canWriteRow(a, null))).toEqual([false, true, true, true, false]);
    expect([trader, senior, curator, admin, guest, null].map(canEditDesk)).toEqual([false, true, true, true, false, false]);
  });

  it("personal list: only its owner — staff and seniors included in «nobody else»", () => {
    expect(canReadRow(trader, 5)).toBe(true);
    expect(canWriteRow(trader, 5)).toBe(true);
    for (const a of [senior, curator, admin, guest]) {
      expect(canReadRow(a, 5)).toBe(false);
      expect(canWriteRow(a, 5)).toBe(false);
    }
  });

  it("scope parsing, owner of a scope, the list a read uses", () => {
    expect([parseScope(undefined), parseScope(""), parseScope("Desk"), parseScope("mine"), parseScope("all")]).toEqual([undefined, undefined, "desk", "mine", "invalid"]);
    expect(ownerOf("mine", trader)).toBe(5);
    expect(ownerOf("desk", trader)).toBeNull();
    expect(readScope(undefined, "desk", trader)).toBe("desk");
    expect(readScope("mine", "desk", trader)).toBe("mine");
    expect(readScope("mine", "mine", guest)).toBe("desk");
  });

  it("remembered view: anything unknown → «Свой»", () => {
    expect(normalizeWatchView({ scope: "desk" })).toEqual({ scope: "desk" });
    expect(normalizeWatchView({ scope: "x" })).toEqual({ scope: "mine" });
    expect(normalizeWatchView(null)).toEqual({ scope: "mine" });
  });
});
