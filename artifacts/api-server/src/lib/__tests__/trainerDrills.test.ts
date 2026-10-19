/**
 * «Найди вход»: drill building (window, context, fake times), scoring / verdicts, and the no-leak rule of the service
 * (store and archive replaced by in-memory fakes).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SimBar } from "../sim/engine";
import { buildDrill, entryOffset, scoreAnswer, splitSetupName, verdictOf } from "../trainer/drills";

const DAY = "2026-10-08";
const TICKER = "QZXW";
const ny = (date: string, min: number) => Date.parse(`${date}T${String(Math.floor(min / 60) + 4).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}:00Z`) / 1000;
function day(date: string): SimBar[] {
  const out: SimBar[] = [];
  let p = 37.1;
  for (let m = 240; m < 1200; m++) {
    const o = p; p = Math.round((p + Math.sin(m / 9) * 0.05) * 100) / 100;
    out.push({ t: ny(date, m), o, h: Math.max(o, p) + 0.02, l: Math.min(o, p) - 0.02, c: p, v: 1000 });
  }
  return out;
}
const BARS = day(DAY);
const REAL = new Set(BARS.map((b) => b.t));
const ENTRY_AT = ny(DAY, 9 * 60 + 47) + 20; // 09:47:20
const ENTRY_PX = 37.4317;

describe("drill building", () => {
  it("puts the real entry inside the window, shows bars only up to the window end, fake times", () => {
    const b = buildDrill({ drillId: 7, day: DAY, dayBars: BARS, entryAt: ENTRY_AT, entryPrice: ENTRY_PX, windowBars: 12 })!;
    expect(b).not.toBeNull();
    expect(b.window.to - b.window.from + 1).toBe(12);
    expect(b.bars).toHaveLength(b.window.to + 1);
    expect(b.ideal.barIndex).toBeGreaterThanOrEqual(b.window.from + 2);
    expect(b.ideal.barIndex).toBeLessThanOrEqual(b.window.to - 2);
    expect(b.ideal.price).toBe(ENTRY_PX);
    expect(b.bars[b.ideal.barIndex].t).toBe(ny(DAY, 9 * 60 + 47));
    for (const t of b.times) expect(REAL.has(t)).toBe(false);
    expect(new Date(b.times[0] * 1000).getUTCFullYear()).toBe(2001);
    expect(b.after.length).toBeGreaterThan(0);
    expect(b.after[0].t).toBeGreaterThan(b.bars[b.bars.length - 1].t);
    expect(b.atr).toBeGreaterThan(0);
  });

  it("the entry offset is stable per drill and varies between drills", () => {
    expect(entryOffset(7, 12)).toBe(entryOffset(7, 12));
    const offs = new Set(Array.from({ length: 30 }, (_, i) => entryOffset(i + 1, 12)));
    expect(offs.size).toBeGreaterThan(3);
    for (const o of offs) { expect(o).toBeGreaterThanOrEqual(2); expect(o).toBeLessThanOrEqual(9); }
  });

  it("refuses a fill outside the bars or without context", () => {
    expect(buildDrill({ drillId: 1, day: DAY, dayBars: BARS, entryAt: ny("2026-10-09", 600), entryPrice: 1, windowBars: 12 })).toBeNull();
    expect(buildDrill({ drillId: 1, day: DAY, dayBars: BARS, entryAt: ny(DAY, 241), entryPrice: 1, windowBars: 12 })).toBeNull();
  });
});

describe("drill scoring", () => {
  const ideal = { barIndex: 100, price: 50 };
  const tol = { bars: 6, atr: 1.5 };
  it("100 on the spot, falls with bars and ATR distance, 0 far away", () => {
    expect(scoreAnswer(ideal, { barIndex: 100, price: 50 }, 0.2, tol)).toBe(100);
    expect(scoreAnswer(ideal, { barIndex: 103, price: 50 }, 0.2, tol)).toBe(75);
    expect(scoreAnswer(ideal, { barIndex: 100, price: 50.15 }, 0.2, tol)).toBe(75); // 0.75 ATR of 1.5
    expect(scoreAnswer(ideal, { barIndex: 120, price: 55 }, 0.2, tol)).toBe(0);
  });
  it("verdicts", () => {
    expect(verdictOf(ideal, { barIndex: 100, price: 50.04 }, 0.2, 99, 70)).toBe("exact");
    expect(verdictOf(ideal, { barIndex: 101, price: 50 }, 0.2, 92, 70)).toBe("close");
    expect(verdictOf(ideal, { barIndex: 96, price: 50 }, 0.2, 40, 70)).toBe("early");
    expect(verdictOf(ideal, { barIndex: 104, price: 50 }, 0.2, 40, 70)).toBe("late");
    expect(verdictOf(ideal, { barIndex: 100, price: 52 }, 0.2, 50, 70)).toBe("price");
  });
  it("splits office setup names", () => {
    expect(splitSetupName("1.3 ORB 5 минут")).toEqual({ code: "1.3", name: "ORB 5 минут" });
    expect(splitSetupName("My setup")).toEqual({ code: null, name: "My setup" });
  });
});

/* ─────────────────────────── service: no leak ─────────────────────────── */

const attempts: { drillId: number; first: boolean; score: number }[] = [];
const DRILL = {
  id: 41, setupId: 205, setupName: "1.3 ORB 5 минут", source: "playbook_example" as const, trader: "Кирилл Б.",
  ticker: TICKER, day: DAY, side: "long" as const, entryAt: ENTRY_AT, entryPrice: ENTRY_PX,
};

vi.mock("../trainer/drillStore", () => ({
  ensureDrills: vi.fn(async () => 0),
  servableDrills: vi.fn(async (_u: number, trader: string) => (trader === DRILL.trader ? [] : [{ ...DRILL, answered: false, lastAnsweredAt: null }])),
  avgScoreBySetup: vi.fn(async () => new Map()),
  drillById: vi.fn(async (id: number) => (id === DRILL.id ? DRILL : null)),
  disableDrill: vi.fn(async () => undefined),
  insertAttempt: vi.fn(async (a: { drillId: number; score: number }) => {
    const first = !attempts.some((x) => x.drillId === a.drillId);
    attempts.push({ drillId: a.drillId, first, score: a.score });
    return first;
  }),
}));
vi.mock("../sim/store", async (orig) => ({
  ...(await orig<typeof import("../sim/store")>()),
  loadDayBars: vi.fn(async () => ({ bars: BARS, tf: "1m", prevClose: 37 })),
}));

const viewer = { id: 2, name: "Артур", staff: false };

describe("drill service", () => {
  beforeEach(async () => {
    attempts.length = 0;
    (await import("../trainer/drillService"))._resetDrillMemo();
  });

  it("serves bars and the window only — no ticker, date, real time or reference entry", async () => {
    const { nextDrill } = await import("../trainer/drillService");
    const d = await nextDrill(viewer, null, () => 0.5);
    const json = JSON.stringify(d);
    expect(json).not.toContain(TICKER);
    expect(json).not.toContain(DAY);
    expect(json).not.toContain(String(ENTRY_PX));
    expect(json).not.toContain("Кирилл");
    for (const b of d.bars) expect(REAL.has(b.t)).toBe(false);
    expect(Object.keys(d).sort()).toEqual(["bars", "id", "setupCode", "setupId", "setupName", "side", "tf", "window"]);
    expect(d.bars).toHaveLength(d.window.to + 1);
    expect(d).toMatchObject({ setupCode: "1.3", setupName: "ORB 5 минут", side: "long", tf: "1m" });
  });

  it("never serves a trader his own trade", async () => {
    const { nextDrill } = await import("../trainer/drillService");
    await expect(nextDrill({ id: 9, name: "Кирилл Б.", staff: false }, null)).rejects.toMatchObject({ status: 404 });
  });

  it("answers with the score, the reveal and the bars after; mastery only on the first passing answer", async () => {
    const { nextDrill, answerDrill } = await import("../trainer/drillService");
    const d = await nextDrill(viewer, null, () => 0.5);
    const b = buildDrill({ drillId: DRILL.id, day: DAY, dayBars: BARS, entryAt: ENTRY_AT, entryPrice: ENTRY_PX, windowBars: 12 })!;
    const a = await answerDrill(viewer, d.id, { barIndex: b.ideal.barIndex, price: ENTRY_PX });
    expect(a.score).toBe(100);
    expect(a.masteryDelta).toBe(1);
    expect(a.revealed).toEqual({ ticker: TICKER, date: DAY, source: "playbook_example" });
    expect(a.explanation.key).toBe("trainer.findEntry.verdict.exact");
    expect(a.barsAfter.length).toBeGreaterThan(0);
    expect(a.barsAfter[0].t).toBeGreaterThan(d.bars[d.bars.length - 1].t);
    const again = await answerDrill(viewer, d.id, { barIndex: b.ideal.barIndex, price: ENTRY_PX });
    expect(again.masteryDelta).toBe(0);
    await expect(answerDrill(viewer, d.id, { barIndex: 99999, price: 1 })).rejects.toMatchObject({ status: 400 });
  });
});
