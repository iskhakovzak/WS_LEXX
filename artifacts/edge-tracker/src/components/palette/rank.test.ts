import { describe, expect, it } from "vitest";
import { SCORE, fold, mergeRanges, nextGroupValue, orderGroups, parseQuery, rankItems, scoreText, titleRanges } from "./rank";

// Cyrillic test strings are built from code points so the source stays ASCII (the i18n ratchet counts literals).
const cy = (...cps: number[]) => String.fromCodePoint(...cps);
const SDELKI = cy(0x421, 0x434, 0x435, 0x43b, 0x43a, 0x438); // "Sdelki" in Cyrillic

describe("scoreText", () => {
  it("orders tiers: exact > prefix > word start > substring > letters in order", () => {
    const exact = scoreText("trades", "Trades")!;
    const prefix = scoreText("tra", "Trades")!;
    const word = scoreText("plan", "Game plan")!;
    const sub = scoreText("ade", "Trades")!;
    const seq = scoreText("trd", "Trades")!;
    expect(exact.score).toBe(SCORE.exact);
    expect(exact.score).toBeGreaterThan(prefix.score);
    expect(prefix.score).toBeGreaterThan(word.score);
    expect(word.score).toBeGreaterThan(sub.score);
    expect(sub.score).toBeGreaterThan(seq.score);
  });

  it("returns the matched character ranges", () => {
    expect(scoreText("tra", "Trades")!.ranges).toEqual([[0, 3]]);
    expect(scoreText("plan", "Game plan")!.ranges).toEqual([[5, 9]]);
    expect(scoreText("ade", "Trades")!.ranges).toEqual([[2, 5]]);
    // letters in order: consecutive letters merge
    expect(scoreText("trd", "Trades")!.ranges).toEqual([[0, 2], [3, 4]]);
  });

  it("matches every word of a multi-word query", () => {
    const r = scoreText("plan game", "Game plan for today")!;
    expect(r.score).toBe(SCORE.words);
    expect(r.ranges).toEqual([[0, 4], [5, 9]]);
    expect(scoreText("plan zzz", "Game plan")).toBeNull();
  });

  it("is case-insensitive and treats yo as ye", () => {
    expect(scoreText("NVDA", "nvda")!.score).toBe(SCORE.exact);
    expect(fold(cy(0x401, 0x436))).toBe(cy(0x435, 0x436));
  });

  it("drops scattered letters and skips fuzzy tiers for long texts", () => {
    expect(scoreText("tz", "Trades and analytics overview zone")).toBeNull();
    expect(scoreText("tds", "Trades", { fuzzy: false })).toBeNull();
    expect(scoreText("ade", "Trades", { fuzzy: false })).not.toBeNull();
  });

  it("finds a label typed in the other keyboard layout or script", () => {
    // "Sdelki" typed on the EN layout = "cltkrb"
    const r = scoreText("cltkrb", SDELKI);
    expect(r).not.toBeNull();
    expect(r!.score).toBeLessThan(SCORE.substring);
  });

  it("ignores loose cross-script hits of short queries (a ticker is not a label)", () => {
    // "Pereklyuchit temu" in Cyrillic: "MRK" only matched it through a phonetic skeleton
    const label = cy(0x41f, 0x435, 0x440, 0x435, 0x43a, 0x43b, 0x44e, 0x447, 0x438, 0x442, 0x44c) + " " + cy(0x442, 0x435, 0x43c, 0x443);
    expect(scoreText("MRK", label)).toBeNull();
  });

  it("returns null for an empty query or text", () => {
    expect(scoreText("  ", "Trades")).toBeNull();
    expect(scoreText("a", null)).toBeNull();
  });
});

describe("rankItems", () => {
  const pages = [
    { name: "Analytics", kw: "equity expectancy" },
    { name: "Trades", kw: "positions" },
    { name: "Trainer", kw: "simulator drill" },
    { name: "Ratings", kw: "leaderboard" },
  ];
  const fields = (p: (typeof pages)[number]) => [p.name, { text: p.kw, weight: 0.6 }];

  it("ranks the best title first and keeps input order on ties", () => {
    const hits = rankItems(pages, "tra", fields);
    expect(hits.map((h) => h.item.name)).toEqual(["Trades", "Trainer"]);
  });

  it("finds by a secondary field with a lower score and no title highlight", () => {
    const [hit] = rankItems(pages, "simulator", fields);
    expect(hit.item.name).toBe("Trainer");
    expect(hit.field).toBe(1);
    expect(titleRanges(hit)).toBeUndefined();
    const [title] = rankItems(pages, "trainer", fields);
    expect(titleRanges(title)).toEqual([[0, 7]]);
    expect(title.score).toBeGreaterThan(hit.score);
  });

  it("applies the limit and matches nothing on an empty query", () => {
    expect(rankItems(pages, "a", fields, 2)).toHaveLength(2);
    expect(rankItems(pages, "", fields)).toEqual([]);
  });
});

describe("parseQuery", () => {
  it("detects tickers, strong when typed upper case or with $", () => {
    expect(parseQuery("NVDA")).toMatchObject({ ticker: "NVDA", tickerStrong: true, tradeId: null });
    expect(parseQuery("$nvda")).toMatchObject({ ticker: "NVDA", tickerStrong: true, q: "nvda" });
    expect(parseQuery("nvda")).toMatchObject({ ticker: "NVDA", tickerStrong: false });
    expect(parseQuery("BRK.B").ticker).toBe("BRK.B");
    expect(parseQuery("game plan").ticker).toBeNull();
    expect(parseQuery("toolongword").ticker).toBeNull();
  });

  it("detects #trade ids", () => {
    expect(parseQuery("#123")).toMatchObject({ tradeId: 123, ticker: null, q: "123" });
    expect(parseQuery("  # 42 ")).toMatchObject({ tradeId: 42 });
    expect(parseQuery("#12a").tradeId).toBeNull();
    expect(parseQuery("123").tradeId).toBeNull();
  });
});

describe("orderGroups", () => {
  it("puts a clearly better group first and keeps the default order within a tier", () => {
    const g = [
      { id: "people", best: 420, priority: 1 },
      { id: "pages", best: 980, priority: 3 },
      { id: "actions", best: 400, priority: 2 },
    ];
    expect(orderGroups(g).map((x) => x.id)).toEqual(["pages", "people", "actions"]);
  });
});

describe("nextGroupValue", () => {
  const groups = [["a1", "a2"], [], ["b1"], ["c1", "c2"]];
  it("moves to the first item of the next / previous non-empty group and wraps", () => {
    expect(nextGroupValue(groups, "a2", 1)).toBe("b1");
    expect(nextGroupValue(groups, "b1", 1)).toBe("c1");
    expect(nextGroupValue(groups, "c2", 1)).toBe("a1");
    expect(nextGroupValue(groups, "a1", -1)).toBe("c1");
    expect(nextGroupValue(groups, "c1", -1)).toBe("b1");
  });
  it("starts at the edge when nothing is selected, null when empty", () => {
    expect(nextGroupValue(groups, null, 1)).toBe("a1");
    expect(nextGroupValue(groups, "zz", -1)).toBe("c1");
    expect(nextGroupValue([[], []], "a", 1)).toBeNull();
  });
});

describe("mergeRanges", () => {
  it("merges overlapping and touching ranges", () => {
    expect(mergeRanges([[5, 7], [0, 2], [2, 3], [6, 9]])).toEqual([[0, 3], [5, 9]]);
  });
});
