import { describe, expect, it } from "vitest";
import { RECENT_MAX, parseRecents, pushRecent, readRecents, recentStorageKey, rememberRecent, type RecentItem } from "./recent";

function memory() {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}
const item = (n: number, extra: Partial<RecentItem> = {}): RecentItem => ({ id: `trade-${n}`, kind: "trades", title: `T${n}`, path: "/trades", ...extra });

describe("pushRecent", () => {
  it("puts the item first, removes its older copy and keeps the last 8", () => {
    let list: RecentItem[] = [];
    for (let i = 1; i <= 10; i++) list = pushRecent(list, item(i));
    expect(list).toHaveLength(RECENT_MAX);
    expect(list[0].id).toBe("trade-10");
    expect(list[RECENT_MAX - 1].id).toBe("trade-3");
    list = pushRecent(list, item(5, { title: "again" }));
    expect(list[0]).toMatchObject({ id: "trade-5", title: "again" });
    expect(list.filter((r) => r.id === "trade-5")).toHaveLength(1);
    expect(list).toHaveLength(RECENT_MAX);
  });
});

describe("parseRecents", () => {
  it("keeps well-formed in-app entries only", () => {
    const raw = [
      item(1, { highlight: 1 }),
      { id: "x", title: "no kind", path: "/" },
      { id: "y", kind: "nope", title: "bad kind", path: "/" },
      { id: "z", kind: "page", title: "external", path: "https://evil.example" },
      { id: "w", kind: "page", title: "protocol-relative", path: "//evil.example" },
      item(1),
      { id: "p", kind: "people", title: "A", path: "/curator?trader=A", person: "A", highlight: "no" },
      null,
      "junk",
    ];
    const out = parseRecents(raw);
    expect(out.map((r) => r.id)).toEqual(["trade-1", "p"]);
    expect(out[0].highlight).toBe(1);
    expect(out[1]).not.toHaveProperty("highlight");
    expect(parseRecents({})).toEqual([]);
  });
});

describe("storage", () => {
  it("keeps one list per user", () => {
    const s = memory();
    rememberRecent("Alice", item(1), s);
    rememberRecent("Bob", item(2), s);
    rememberRecent("Alice", item(3), s);
    expect(readRecents("Alice", s).map((r) => r.id)).toEqual(["trade-3", "trade-1"]);
    expect(readRecents("Bob", s).map((r) => r.id)).toEqual(["trade-2"]);
    expect(recentStorageKey(null)).toBe(recentStorageKey("guest"));
    expect(recentStorageKey("A B")).not.toContain(" ");
  });

  it("never throws: broken JSON, throwing storage, no storage", () => {
    const s = memory();
    s.m.set(recentStorageKey("A"), "{not json");
    expect(readRecents("A", s)).toEqual([]);
    const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("quota"); } };
    expect(readRecents("A", throwing)).toEqual([]);
    expect(rememberRecent("A", item(1), throwing).map((r) => r.id)).toEqual(["trade-1"]);
    expect(readRecents("A", null)).toEqual([]);
    expect(rememberRecent("A", item(2), null).map((r) => r.id)).toEqual(["trade-2"]);
  });
});
