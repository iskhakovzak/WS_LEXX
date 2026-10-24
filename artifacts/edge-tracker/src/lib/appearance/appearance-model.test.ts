import { describe, expect, it } from "vitest";
import { DEFAULT_APPEARANCE, MAX_LOOKS, appearanceSchema, parseAppearance, parseStored, storedAppearanceSchema } from "./model";
import { classifyPnl, getBeRange, setBeRange } from "./be-range";
import { visualResult } from "@/lib/trade-result";
import { initHistory, pushHistory, redoHistory, undoHistory } from "./history";

describe("break-even range (display classification only)", () => {
  it("classifies dollar results with and without a range", () => {
    expect(classifyPnl(12.5, 0)).toBe("win");
    expect(classifyPnl(-0.01, 0)).toBe("loss");
    expect(classifyPnl(0, 0)).toBe("flat");
    expect(classifyPnl(null, 5)).toBe("none");
    expect(classifyPnl(Number.NaN, 5)).toBe("none");
    expect(classifyPnl(4.99, 5)).toBe("be");
    expect(classifyPnl(-5, 5)).toBe("be"); // the edge counts as break-even
    expect(classifyPnl(5.01, 5)).toBe("win");
    expect(classifyPnl(-5.01, 5)).toBe("loss");
    expect(classifyPnl(0, 5)).toBe("be");
  });

  it("only relabels what a row shows: the stored result is kept outside the range or without a P&L", () => {
    expect(visualResult("win", 3, 5)).toBe("be");
    expect(visualResult("loss", -2, 5)).toBe("be");
    expect(visualResult("win", 30, 5)).toBe("win");
    expect(visualResult("loss", null, 5)).toBe("loss");
    expect(visualResult("be", 40, 5)).toBe("be"); // a stored BE is never turned into a win
    expect(visualResult("win", 3, 0)).toBe("win");
  });

  it("the shared store notifies and ignores junk", () => {
    setBeRange(10);
    expect(getBeRange()).toBe(10);
    expect(classifyPnl(9)).toBe("be");
    setBeRange(-3);
    expect(getBeRange()).toBe(0);
    setBeRange(Number.POSITIVE_INFINITY);
    expect(getBeRange()).toBe(0);
  });
});

describe("appearance settings schema", () => {
  it("fills every field from nothing (old clients, a fresh profile)", () => {
    expect(parseAppearance(undefined)).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance({})).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance("junk")).toEqual(DEFAULT_APPEARANCE);
  });

  it("keeps valid fields and resets only the broken ones", () => {
    const a = parseAppearance({ accent: "#12ab34", font: "comic", density: "spacious", money: { win: "red", loss: "#ff0000", be: null, beRange: 99999 } });
    expect(a.accent).toBe("#12ab34");
    expect(a.font).toBe("inter");
    expect(a.density).toBe("spacious");
    expect(a.money.win).toBeNull();
    expect(a.money.loss).toBe("#ff0000");
    expect(a.money.beRange).toBe(0);
  });

  it("refuses CSS injection through colour fields", () => {
    expect(appearanceSchema.parse({ accent: "red;}body{display:none" }).accent).toBe("ink");
    expect(appearanceSchema.parse({ lines: "url(javascript:1)" }).lines).toBe("theme");
  });

  it("stored block: at most 5 looks, broken looks dropped", () => {
    const look = (i: number) => ({ id: `l${i}`, name: `Look ${i}`, theme: "platinum", settings: DEFAULT_APPEARANCE });
    const s = parseStored({ v: 1, current: { accent: "blue" }, looks: [look(1), { id: "", name: "x" }, look(2), look(3), look(4), look(5), look(6)] });
    expect(s.current.accent).toBe("blue");
    expect(s.looks.map((l) => l.id)).toEqual(["l1", "l2", "l3", "l4", "l5"]);
    expect(s.looks).toHaveLength(MAX_LOOKS);
    expect(storedAppearanceSchema.safeParse({ v: 1, current: DEFAULT_APPEARANCE, looks: Array.from({ length: 6 }, (_, i) => look(i)) }).success).toBe(true); // .catch → []
  });
});

describe("undo / redo", () => {
  it("walks back and forth and drops redo on a new change", () => {
    let h = initHistory(1);
    h = pushHistory(h, 2);
    h = pushHistory(h, 3);
    h = undoHistory(h);
    expect(h.present).toBe(2);
    h = redoHistory(h);
    expect(h.present).toBe(3);
    h = undoHistory(undoHistory(h));
    expect(h.present).toBe(1);
    h = pushHistory(h, 9);
    expect(h.future).toEqual([]);
    expect(undoHistory(initHistory(5)).present).toBe(5);
    expect(pushHistory(h, 9)).toBe(h); // same value: no new step
  });
});
