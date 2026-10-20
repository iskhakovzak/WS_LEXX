import { describe, expect, it, vi } from "vitest";

const get = vi.hoisted(() => vi.fn(async (_url: string, opts?: { query?: { ids?: string } }) => ({
  items: Object.fromEntries((opts?.query?.ids ?? "").split(",").filter((id) => id !== "3").map((id) => [id, { playbookId: 205, name: "1.3 ORB 5 минут", confidence: 0.7 }])),
})));
vi.mock("@/lib/api/http", () => ({ http: { get, post: vi.fn() } }));

const M = await import("./setup-picker");
const S = (id: number, name: string, locked = false) => ({ id, code: name.split(" ")[0], name, folder: null, locked });

describe("setup picker (wave 1, 1.2)", () => {
  it("lists only the setups the viewer may tag with, filtered by name or number", () => {
    const list = [S(205, "1.3 ORB 5 минут"), S(213, "3.3 Parabolic Backside", true), S(211, "3.1 VWAP Fade")];
    expect(M.taggableSetups(list).map((s) => s.id)).toEqual([205, 211]);
    expect(M.filterSetups(M.taggableSetups(list), "3.").map((s) => s.id)).toEqual([211]);
    expect(M.filterSetups(list, "vwap").map((s) => s.id)).toEqual([211]);
    expect(M.taggableSetups(undefined)).toEqual([]);
  });

  it("a suggestion is wanted only for a closed trade without a setup link or text", () => {
    expect(M.wantsSuggestion({ id: 1, setup: null, playbookId: null, result: "win" })).toBe(true);
    expect(M.wantsSuggestion({ id: 1, setup: "1.3 ORB 5 минут", playbookId: 205, result: "win" })).toBe(false);
    expect(M.wantsSuggestion({ id: 1, setup: " ", playbookId: 205, result: "loss" })).toBe(false);
    expect(M.wantsSuggestion({ id: 1, setup: null, playbookId: null, result: "open" })).toBe(false);
  });

  it("rows rendered together share one request; a trade without a mapped suggestion gets null", async () => {
    get.mockClear();
    const [a, b, c] = await Promise.all([M.loadSuggestion(1), M.loadSuggestion(2), M.loadSuggestion(3)]);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0]![1]).toEqual({ query: { ids: "1,2,3" } });
    expect(a).toEqual({ playbookId: 205, name: "1.3 ORB 5 минут", confidence: 0.7 });
    expect(b?.playbookId).toBe(205);
    expect(c).toBeNull();
  });
});
