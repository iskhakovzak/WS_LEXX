import { describe, expect, it } from "vitest";
import { dayHints, openingWindow, type HintSource } from "../day-hints";
import { isoWeekKey, stepWeekday } from "../utils";

const base = (over: Partial<HintSource> = {}): HintSource => ({
  summary: { closed: 4, net: -150, winRate: 0.25, feeShareOfGross: null, best: { ticker: "NVDA", net: 20 } },
  timeline: [],
  leaks: [],
  ...over,
});

describe("openingWindow", () => {
  it("counts only 09:30–09:44 ET entries, not premarket", () => {
    const tl = [
      { id: 1, entryTime: "09:27:57", net: 22 },
      { id: 2, entryTime: "09:30:00", net: -50 },
      { id: 3, entryTime: "09:44:59", net: -40.5 },
      { id: 4, entryTime: "09:45:00", net: -30 },
      { id: 5, entryTime: null, net: -1 },
    ];
    expect(openingWindow(tl)).toEqual({ count: 2, net: -90.5, ids: [2, 3] });
  });
});

describe("dayHints", () => {
  it("phrases the opening window as «N сделки в первые 15 минут, −$X»", () => {
    const h = dayHints(base({ timeline: [
      { id: 1, entryTime: "09:31:00", net: -60 },
      { id: 2, entryTime: "09:35:00", net: -40 },
      { id: 3, entryTime: "09:40:00", net: -20 },
    ] }));
    expect(h[0].id).toBe("opening");
    expect(h[0].text).toBe("3 сделки в первые 15 минут, −$120.00");
    expect(h[0].tone).toBe("down");
  });

  it("an opening specialist's green open is not questioned (ROMAN-24); a losing open still is", () => {
    const tl = [
      { id: 1, entryTime: "09:30:10", net: 120 },
      { id: 2, entryTime: "09:31:00", net: 80 },
      { id: 3, entryTime: "09:33:00", net: -20 },
      { id: 4, entryTime: "09:40:00", net: 40 },
    ];
    const green = base({ summary: { closed: 4, net: 220, winRate: 0.75, feeShareOfGross: null, best: { ticker: "AAL", net: 120 } }, timeline: tl });
    expect(dayHints(green).some((h) => h.id === "opening")).toBe(false);
    // A 90-day share below the threshold keeps the hint even on such a day.
    expect(dayHints(green, { openingShare: 0.2 }).some((h) => h.id === "opening")).toBe(true);
    const red = base({ timeline: tl.map((x) => ({ ...x, net: -30 })) });
    expect(dayHints(red)[0].id).toBe("opening");
  });

  it("orders leaks by cost and caps the list", () => {
    const leak = (kind: string, cost: number) => ({ kind, title: kind, detail: "", tradeIds: [], netUsd: -cost, costUsd: cost, severity: "high" as const });
    const h = dayHints(base({ leaks: [leak("a", 10), leak("b", 300), leak("c", 50), leak("d", 5)] }), { untagged: 4, violations: 2 }, 5);
    expect(h.map((x) => x.id)).toEqual(["leak-b", "leak-c", "leak-a", "violations", "untagged"]);
    expect(h[4].text).toBe("У 4 сделок нет сетапа");
  });

  it("praises a clean green day and stays empty without trades", () => {
    expect(dayHints(base({ summary: { closed: 3, net: 300, winRate: 1, feeShareOfGross: 0.02, best: { ticker: "KORU", net: 220.26 } } }))[0].text)
      .toBe("Чистый день: лучшая сделка KORU +$220.26");
    expect(dayHints(base({ summary: { closed: 0, net: 0, winRate: null, feeShareOfGross: null, best: null } }))).toEqual([]);
  });
});

describe("journal dates", () => {
  it("iso week + next trading day", () => {
    expect(isoWeekKey("2026-10-15")).toBe("2026-W42");
    expect(isoWeekKey("2027-01-01")).toBe("2026-W53");
    expect(stepWeekday("2026-10-16", 1)).toBe("2026-10-19");
  });
});
