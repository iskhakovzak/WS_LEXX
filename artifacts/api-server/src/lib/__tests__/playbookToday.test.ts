/**
 * Playbook «Сегодня» (lib/playbookToday/*): the history relink mapping (old label → new code, exclusions, entry-time
 * window), the pure today builder (windows, codes, cheat lines, grade-A bullets, own edge verdicts, tier locks with the
 * graded-A gateway, picks from the plan), picks validation, plan field keeping, the trading-day window of the untagged
 * counter and the daily quest «tag_yesterday».
 */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

const dbQuery = vi.fn(async (..._a: unknown[]) => ({ rows: [] as unknown[], rowCount: 0 }));
vi.mock("@workspace/db", () => ({ db: {}, pool: { query: (...a: unknown[]) => dbQuery(...a) } }));

const rm = await import("../playbookToday/relinkMap");
const b = await import("../playbookToday/build");
const plan = await import("../playbookToday/plan");
const un = await import("../playbookToday/untagged");
const sg = await import("../playbookToday/suggest");
const e = await import("../quests/engine");
type SetupRow = import("../playbookToday/build").SetupRow;
type EdgeRow = import("../playbookToday/build").EdgeRow;
type QuestData = import("../quests/catalog").QuestData;
type StoredQuest = import("../quests/catalog").StoredQuest;

// ─── relink mapping ─────────────────────────────────────────────────────────

const NEW: import("../playbookToday/relinkMap").RelinkNewSetup[] = [
  { id: 203, code: "1.1", name: "1.1 Gap & Go", timeOfDay: "9:30–9:45 NY" },
  { id: 205, code: "1.3", name: "1.3 ORB 5 минут", timeOfDay: "9:35–10:30 NY" },
  { id: 208, code: "2.1", name: "2.1 VWAP Hold / Reclaim", timeOfDay: "10:00–15:00 NY" },
  { id: 212, code: "3.2", name: "3.2 Ложный пробой", timeOfDay: "9:45–15:30 NY" },
  { id: 217, code: "5.2", name: "5.2 MOC Imbalance", timeOfDay: "15:50–16:00 NY" },
];
const OLD = [
  { id: 45, name: "Opening Range Breakout (ORB)", tags: "ORB,Breakout" },
  { id: 47, name: "Failed Follow Through — Bear Flag Short", tags: "Failed Follow Through,Bear Flag" },
  { id: 12, name: "VWAP Reclaim — Mean Reversion Long", tags: "vwap, mean-reversion" },
  { id: 67, name: "MOC Fade — Closing Reversal", tags: "MOC Imbalance,Fade Trade" },
  { id: 58, name: "OPG Gap Fade — Auction Reversal", tags: "" },
  { id: 65, name: "MOC — Market On Close Order", tags: "" },
  { id: 90, name: "Some Odd Name", tags: "Gap and Go,Other" },
];

describe("relink mapping", () => {
  it("maps old labels to new codes by ordered rules, never an excluded family", () => {
    expect(rm.codeForLabel("Opening Range Breakout (ORB)")).toBe("1.3");
    expect(rm.codeForLabel("Failed Follow Through — Bear Flag Short")).toBe("3.2"); // failed breakout wins over flag
    expect(rm.codeForLabel("VWAP Reclaim — Mean Reversion Long")).toBe("2.1"); // reclaim wins over mean reversion
    expect(rm.codeForLabel("Gap and Go — Earnings Momentum")).toBe("1.1");
    expect(rm.codeForLabel("MOC — Market On Close Order")).toBe("5.2");
    expect(rm.codeForLabel("Пробой LOD")).toBe("2.3"); // auto-classifier class
    expect(rm.codeForLabel("Шорт параболы на моментум-именах")).toBe("3.3");
    for (const x of ["MOC Fade — Closing Reversal", "OPG Gap Fade — Auction Reversal", "IMBX — Opening Imbalance Long",
      "MOC + Options Expiration — Pin Risk Play", "Tape Reading — Order Flow Entry", "Low Float Momentum — Float Rotation", "", null]) {
      expect(rm.codeForLabel(x), String(x)).toBeNull();
    }
  });

  it("parses windows and entry minutes", () => {
    expect(rm.parseWindowMinutes("9:35–10:30 NY")).toEqual({ from: 575, to: 630 });
    expect(rm.parseWindowMinutes("anytime")).toBeNull();
    expect(rm.entryMinuteOf("2026-03-03T09:33:50")).toBe(573);
    expect(rm.entryMinuteOf(null)).toBeNull();
  });

  it("links only inside the new setup's window (± tolerance) and reports the rest", () => {
    const trades = [
      { id: 1, playbookId: 45, setup: "Opening Range Breakout (ORB)", entryMin: 9 * 60 + 40 }, // ORB 9:40 → 1.3
      { id: 2, playbookId: 45, setup: "Opening Range Breakout (ORB)", entryMin: 15 * 60 }, // 15:00 is no ORB → unlinked
      { id: 3, playbookId: 45, setup: "Opening Range Breakout (ORB)", entryMin: 9 * 60 + 30 }, // 9:30 within 5 min of 9:35
      { id: 4, playbookId: 47, setup: null, entryMin: 11 * 60 }, // → 3.2
      { id: 5, playbookId: 67, setup: "MOC Fade — Closing Reversal", entryMin: 15 * 60 + 52 }, // excluded
      { id: 6, playbookId: 58, setup: null, entryMin: 570 }, // OPG excluded
      { id: 7, playbookId: 65, setup: null, entryMin: 15 * 60 + 51 }, // MOC order → 5.2
      { id: 8, playbookId: 90, setup: null, entryMin: 9 * 60 + 31 }, // no rule by name → first tag «Gap and Go» → 1.1
      { id: 9, playbookId: 12, setup: null, entryMin: null }, // no entry time → unlinked
      { id: 10, playbookId: null, setup: null, entryMin: 600 },
    ];
    const { decisions, report } = rm.planRelink(trades, OLD, NEW);
    const to = Object.fromEntries(decisions.map((d) => [d.tradeId, d.to]));
    expect(to).toEqual({ 1: 205, 2: null, 3: 205, 4: 212, 5: null, 6: null, 7: 217, 8: 203, 9: null, 10: null });
    expect(report.linked).toBe(5);
    expect(report.unlinkedReasons).toEqual({ outside_window: 1, excluded: 2, no_time: 1, no_label: 1 });
    expect(report.byNewSetup.find((s) => s.code === "1.3")?.trades).toBe(2);
    const orb = report.byOldLabel.find((r) => r.oldId === 45)!;
    expect(orb).toMatchObject({ trades: 3, linked: 2, outsideWindow: 1, code: "1.3" });
  });

  it("is deterministic (a second plan over the same backup gives the same links)", () => {
    const t = [{ id: 1, playbookId: 45, setup: null, entryMin: 600 }];
    expect(rm.planRelink(t, OLD, NEW).decisions).toEqual(rm.planRelink(t, OLD, NEW).decisions);
  });
});

// ─── today builder ──────────────────────────────────────────────────────────

const setup = (id: number, name: string, timeOfDay: string | null, minTier: string | null, over: Partial<SetupRow> = {}): SetupRow => ({
  id, name, folder: "1 · Open", timeOfDay, entryText: "Timeframe 1m. Buy the break.\nNever chase.", stopText: "Below the range.",
  targetsText: "- ½ at +1R", invalidationText: null,
  notes: "Grades:\nГрейд A — пробой в сторону гэпа и рынка, объём, узкий диапазон.\nГрейд B — …", // i18n-ignore (card text)
  checklistItems: [{ id: "a", text: "Range marked" }, { id: "b", text: "Volume" }], checklist: null, minTier, schemaKey: null, space: "office", ...over,
});
const SETUPS: SetupRow[] = [
  setup(202, "0.1 Утренняя подготовка", "9:00–9:30 NY", "junior", { schemaKey: "routine", folder: "0 · Pre" }), // i18n-ignore
  setup(205, "1.3 ORB 5 минут", "9:35–10:30 NY", "junior", { schemaKey: "orb" }), // i18n-ignore
  setup(203, "1.1 Gap & Go", "9:30–9:45 NY", "trader", { schemaKey: "gap_go" }),
  setup(208, "2.1 VWAP Hold / Reclaim", "10:00–15:00 NY", "junior", { folder: "2 · Trend" }),
  setup(215, "4.2 Gap Fill", "9:35–11:30 NY", "trader", { folder: "4 · News" }),
  setup(213, "3.3 Parabolic Backside", "10:00–15:30 NY", "senior", { folder: "3 · Rev" }),
  setup(217, "5.2 MOC Imbalance", "15:50–16:00 NY", "senior", { folder: "5 · Close", schemaKey: "not_a_key" }),
  setup(300, "My own idea", null, null, { space: "personal", folder: "2 · Trend", notes: null, checklistItems: null, checklist: "- one\n- two" }),
];
const edge = (setupId: number, trades: number, sumR: number, rTrades = trades, gradedA = 0): EdgeRow => ({
  setupId, trades, wins: Math.ceil(trades / 2), decided: trades, rTrades, sumR, lastOn: "2026-10-16", gradedA,
});
const input = (over: Partial<import("../playbookToday/build").TodayInput> = {}) => ({
  date: "2026-10-19", nyMinutes: 500, setups: SETUPS, edges: [] as EdgeRow[], viewer: { staff: false, tier: "junior" }, gateCount: 10,
  planSetups: undefined as unknown, oneR: { usd: 50, source: "limits" as const }, untagged: 3, ...over,
});

describe("today builder", () => {
  it("parses codes, time ranges and windows", () => {
    expect(b.codeFromName("1.3 ORB 5 минут")).toBe("1.3"); // i18n-ignore
    expect(b.codeFromName("ORB 1.3")).toBeNull();
    expect(b.parseTimeRange("9:35–10:30 NY")).toEqual({ from: "09:35", to: "10:30" });
    expect(b.windowOf({ from: "09:00", to: "09:30" })).toBe("premarket");
    expect(b.windowOf({ from: "10:00", to: "15:00" })).toBe("trend"); // mostly the trend window
    expect(b.windowOf({ from: "09:35", to: "11:30" })).toBe("open"); // gap fill stays an open setup
    expect(b.windowOf({ from: "09:30", to: "11:00" })).toBe("open");
    expect(b.windowOf({ from: "15:50", to: "16:00" })).toBe("close");
    expect(b.windowOf(null)).toBeNull();
  });

  it("cheat lines, grade-A bullets and the checklist come from the card", () => {
    expect(b.firstLine("Timeframe 1m. Buy the break.\nNever chase.")).toBe("Timeframe 1m. Buy the break.");
    expect(b.firstLine("- ½ at +1R")).toBe("½ at +1R");
    expect(b.gradeABullets("Грейд A — сильный ход + мелкий откат к VWAP + объём на развороте.")).toEqual(["сильный ход", "мелкий откат к VWAP", "объём на развороте"]); // i18n-ignore
    expect(b.gradeABullets("Grade A — clean range, volume (above 2x, rising), market with us")).toEqual(["clean range", "volume (above 2x, rising)", "market with us"]);
    expect(b.gradeABullets("no grades here")).toEqual([]);
    expect(b.checklistTexts(null, "- one\n- two")).toEqual(["one", "two"]);
  });

  it("builds windows in order with the setups sorted by code", () => {
    const t = b.buildToday(input());
    expect(t.windows.map((w) => [w.key, w.setupIds])).toEqual([
      ["premarket", [202]], ["open", [203, 205, 215]], ["trend", [208, 213, 300]], ["close", [217]],
    ]);
    const orb = t.setups.find((s) => s.id === 205)!;
    expect(orb).toMatchObject({ code: "1.3", schema: "orb", time: { from: "09:35", to: "10:30" }, window: "open", locked: false, minTier: "junior" });
    expect(orb.cheat).toEqual({ entry: "Timeframe 1m. Buy the break.", stop: "Below the range.", target: "½ at +1R", invalidation: null, gradeA: ["пробой в сторону гэпа и рынка", "объём", "узкий диапазон"] }); // i18n-ignore
    expect(t.setups.find((s) => s.id === 217)?.schema).toBeNull(); // unknown picture key
    expect(t.setups.find((s) => s.id === 300)).toMatchObject({ window: "trend", code: null, locked: false, checklist: ["one", "two"] }); // folder fallback
    expect(t.untagged).toBe(3);
    expect(t.oneR).toEqual({ usd: 50, source: "limits" });
  });

  it("edge verdicts: new < 5, careful avg < 0, one best with ≥ 10 R-trades, good otherwise", () => {
    const m = b.edgesOf([edge(1, 4, 3), edge(2, 23, 9.66), edge(3, 12, -1.2), edge(4, 30, 6), edge(5, 40, 30, 8), edge(6, 6, 0, 0)]);
    expect(m.get(1)?.verdict).toBe("new");
    expect(m.get(2)).toMatchObject({ verdict: "best", trades: 23, avgR: 0.42, totalR: 9.66 });
    expect(m.get(3)?.verdict).toBe("careful");
    expect(m.get(4)?.verdict).toBe("good");
    expect(m.get(5)?.verdict).toBe("good"); // higher avg but only 8 trades with an R
    expect(m.get(6)).toMatchObject({ verdict: "good", avgR: null, totalR: null });
    expect(b.edgesOf([edge(1, 20, -2)]).get(1)?.verdict).toBe("careful"); // no best when nothing is positive
  });

  it("locks: a junior sees junior setups open, the rest locked with the unlock condition", () => {
    const t = b.buildToday(input({ edges: [edge(205, 8, 2, 8, 4)] }));
    const s = (id: number) => t.setups.find((x) => x.id === id)!;
    expect(s(202).locked).toBe(false);
    expect(s(205).locked).toBe(false);
    expect(s(203)).toMatchObject({ locked: true, unlock: { key: "unlock.gradeA", params: { count: 10, done: 4, code: "1.3", tier: "trader" } } });
    expect(s(215).unlock).toEqual({ key: "unlock.gradeA", params: { count: 10, done: 0, code: "2.1", tier: "trader" } });
    expect(s(213)).toMatchObject({ locked: true, unlock: { key: "unlock.tier", params: { tier: "senior" } } });
    expect(s(300).locked).toBe(false); // own setup, no tier
  });

  it("a locked setup comes without its rules and checklist (DEV-06); open ones keep them", () => {
    const t = b.buildToday(input());
    const locked = t.setups.find((x) => x.id === 213)!;
    expect(locked).toMatchObject({ locked: true, name: "3.3 Parabolic Backside", minTier: "senior", unlock: { key: "unlock.tier" } });
    expect(locked.cheat).toEqual({ entry: null, stop: null, target: null, invalidation: null, gradeA: [] });
    expect(locked.checklist).toEqual([]);
    expect(t.setups.find((x) => x.id === 205)!.checklist).toEqual(["Range marked", "Volume"]);
    const staff = b.buildToday(input({ viewer: { staff: true, tier: null } }));
    expect(staff.setups.find((x) => x.id === 213)!.cheat.entry).toBe("Timeframe 1m. Buy the break.");
  });

  it("redactLockedSetup keeps the title / tier / time and drops the card fields of a library row", () => {
    const row = { id: 213, name: "3.3", minTier: "trader", timeOfDay: "10:00–15:30 NY", entryText: "x", notes: "y", checklistItems: [{ id: "a", text: "b" }], media: [{ id: 1 }], tags: "t" };
    expect(b.redactLockedSetup(row, { key: "unlock.tier", params: { tier: "trader" } })).toEqual({
      id: 213, name: "3.3", minTier: "trader", timeOfDay: "10:00–15:30 NY", entryText: null, notes: null, checklistItems: [], media: [], tags: "t",
      locked: true, unlock: { key: "unlock.tier", params: { tier: "trader" } },
    });
  });

  it("graded-A trades on the gateway open the setup early; the tier opens everything up to it; staff see all", () => {
    const early = b.buildToday(input({ edges: [edge(205, 12, 3, 12, 10)] }));
    expect(early.setups.find((x) => x.id === 203)?.locked).toBe(false);
    expect(early.setups.find((x) => x.id === 213)?.locked).toBe(true); // senior+ stays tier-only (early unlock: junior → trader only)
    const off = b.buildToday(input({ edges: [edge(205, 12, 3, 12, 10)], gateCount: 0 }));
    expect(off.setups.find((x) => x.id === 203)?.unlock).toEqual({ key: "unlock.tier", params: { tier: "trader" } });
    const trader = b.buildToday(input({ viewer: { staff: false, tier: "trader" } }));
    expect(trader.setups.filter((x) => x.locked).map((x) => x.id).sort()).toEqual([213, 217]);
    const unknown = b.buildToday(input({ viewer: { staff: false, tier: null } }));
    expect(unknown.setups.find((x) => x.id === 203)?.locked).toBe(true); // no stage = junior
    const staff = b.buildToday(input({ viewer: { staff: true, tier: null } }));
    expect(staff.setups.some((x) => x.locked)).toBe(false);
  });

  it("picks come from the plan: known, unlocked, distinct, at most 3", () => {
    expect(b.buildToday(input({ planSetups: [205, 205, 203, 999, 208, 202, 300] })).picks).toEqual([205, 208, 202]);
    expect(b.buildToday(input({ planSetups: "x" })).picks).toEqual([]);
  });
});

describe("picks validation", () => {
  const today = b.buildToday(input());
  it("accepts up to 3 distinct open setups", () => {
    expect(b.checkPicks([205, 208, 205], today)).toEqual({ ok: true, ids: [205, 208] });
    expect(b.checkPicks([], today)).toEqual({ ok: true, ids: [] });
  });
  it("refuses more than 3, unknown and locked setups", () => {
    expect(b.checkPicks([202, 205, 208, 300], today)).toEqual({ ok: false, code: "TOO_MANY", max: 3 });
    expect(b.checkPicks([205, 12345], today)).toEqual({ ok: false, code: "SETUP_NOT_FOUND", id: 12345 });
    expect(b.checkPicks([213], today)).toMatchObject({ ok: false, code: "PLAYBOOK_SETUP_LOCKED", id: 213 });
  });
});

describe("plan fields", () => {
  it("a plan save without setups / riskPerTradeUsd keeps the stored ones; null clears", () => {
    expect(plan.keepPlanPicks({ focus: "x" }, { setups: [1, 2], riskPerTradeUsd: 40 })).toEqual({ focus: "x", setups: [1, 2], riskPerTradeUsd: 40 });
    expect(plan.keepPlanPicks({ setups: [3], riskPerTradeUsd: null }, { setups: [1], riskPerTradeUsd: 40 })).toEqual({ setups: [3], riskPerTradeUsd: null });
    expect(plan.keepPlanPicks({ focus: "x" }, null)).toEqual({ focus: "x" });
  });
  it("validates picks in the plan body", () => {
    const body = z.object(plan.PlanPicksFields);
    expect(body.parse({ setups: [5, 5, 6] })).toEqual({ setups: [5, 6] });
    expect(body.safeParse({ setups: [1, 2, 3, 4] }).success).toBe(false);
    expect(body.parse({})).toEqual({});
  });
});

describe("untagged window", () => {
  it("the last 5 trading days start 4 weekdays back (weekend: from the Friday before)", () => {
    expect(un.weekdaysBack("2026-10-16", 5)).toBe("2026-10-12"); // Fri → Mon
    expect(un.weekdaysBack("2026-10-18", 5)).toBe("2026-10-12"); // Sun → Mon
    expect(un.weekdaysBack("2026-10-20", 5)).toBe("2026-10-14"); // Tue → Wed before
    expect(un.untaggedOf(new Map([["a", { trades: 3, tagged: 1 }], ["b", { trades: 2, tagged: 2 }]]))).toBe(2);
  });

  it("untaggedTrades — the one «без сетапа» number for a period, with its days", async () => {
    dbQuery.mockResolvedValueOnce({ rows: [{ d: "2026-10-14", trades: 4, tagged: 1 }, { d: "2026-10-15", trades: 2, tagged: 2 }], rowCount: 2 });
    const r = await un.untaggedTrades("Илья Ш.", "2026-10-13", "2026-10-19");
    expect(r).toMatchObject({ from: "2026-10-13", to: "2026-10-19", trades: 6, tagged: 3, untagged: 3 });
    expect(r.byDay.get("2026-10-14")).toEqual({ trades: 4, tagged: 1 });
    const [sql, params] = dbQuery.mock.calls.at(-1)! as [string, unknown[]];
    expect(params).toEqual(["Илья Ш.", "2026-10-13", "2026-10-19"]);
    expect(sql).toMatch(/p\.deleted_at IS NULL/); // a link to a deleted (old) setup is no setup
    expect(sql).toMatch(/playbook_inbox_dismissed/); // «Не для плейбука» counts as handled
  });
});

describe("«В плейбук» preselect (ROMAN-09)", () => {
  const office = [
    { id: 202, name: "0.1 Утренняя подготовка", timeOfDay: "9:00–9:30 NY", space: "office", canAddExamples: true }, // i18n-ignore
    { id: 204, name: "1.2 Opening Drive", timeOfDay: "9:30–9:45 NY", space: "office", canAddExamples: true },
    { id: 205, name: "1.3 ORB 5 минут", timeOfDay: "9:35–10:30 NY", space: "office", canAddExamples: true }, // i18n-ignore
    { id: 208, name: "2.1 VWAP Hold / Reclaim", timeOfDay: "10:00–15:00 NY", space: "office", canAddExamples: true },
    { id: 213, name: "3.3 Parabolic Backside", timeOfDay: "10:00–15:30 NY", space: "office", canAddExamples: true },
  ];
  it("the broker strategy maps to a setup inside its window", () => {
    expect(sg.suggestByTrade({ setup: "Parabolic Short — Extended Stock", openedAt: "2026-10-16T11:05:00" }, office)[0]).toMatchObject({ id: 213, via: "strategy", time: "11:05" });
    // outside the window: no strategy match, only time-based suggestions
    expect(sg.suggestByTrade({ setup: "Opening Range Breakout (ORB)", openedAt: "2026-10-16T14:00:00" }, office).every((x) => x.via === "time")).toBe(true);
  });
  it("by entry time the narrowest window first, never the morning routine", () => {
    const r = sg.suggestByTrade({ setup: null, openedAt: "2026-10-16T09:40:00" }, office);
    expect(r.map((x) => x.id)).toEqual([204, 205]);
    expect(r.some((x) => x.id === 202)).toBe(false);
    expect(sg.suggestByTrade({ setup: null, openedAt: null }, office)).toEqual([]);
    // an OPG / IMBX auction trade has no office setup: nothing is guessed by time
    expect(sg.suggestByTrade({ setup: "IMBX — Opening Imbalance Short", openedAt: "2026-10-16T09:31:00" }, office)).toEqual([]);
  });
});

// ─── quest tag_yesterday ────────────────────────────────────────────────────

const ON = { enabled: true, onboarding: false, daily: true, weekly: false, monthly: false, curator: false };
function data(over: Partial<QuestData> = {}): QuestData {
  return {
    today: "2026-10-14", minutes: 17 * 60, lastFinished: "2026-10-14", tradingDay: true,
    user: { mustChangeSecret: false, telegram: true }, plans: new Map(), ledger: [], reviews: [], focus: [], games: [], gamePlans: [],
    deskDayOpens: [], monthStops: [], stopKnown: false, lastTickerDay: null, replayTradeId: null, ...over,
  };
}
const tagQuest = (d: QuestData, store: StoredQuest[] = []) => e.planQuests(d, store, { onboarding: false }, ON).create.find((q) => q.template === "tag_yesterday");

describe("quest tag_yesterday", () => {
  it("is offered for the last finished day while some of its trades are untagged", () => {
    const q = tagQuest(data({ tagDays: new Map([["2026-10-14", { trades: 4, tagged: 1 }]]) }));
    expect(q).toMatchObject({ period: "2026-10-14", startsOn: "2026-10-14", endsOn: "2026-10-15", target: 4, progress: 1, status: "active" });
    expect(tagQuest(data({ tagDays: new Map([["2026-10-14", { trades: 4, tagged: 4 }]]) }))).toBeUndefined(); // nothing to tag
    expect(tagQuest(data({ tagDays: new Map() }))).toBeUndefined(); // no trades that day
    expect(tagQuest(data())).toBeUndefined(); // older loaders without tagDays
  });

  it("caps the target (quests.tagYesterdayMax) and completes when that many are tagged", () => {
    const d = data({ tagDays: new Map([["2026-10-14", { trades: 25, tagged: 0 }]]) });
    const q = tagQuest(d)!;
    expect(q.target).toBe(10);
    const stored: StoredQuest = { id: 1, trader: "x", params: {}, assignedBy: null, note: null, ...q, status: "active" };
    expect(e.evaluateQuest(data({ tagDays: new Map([["2026-10-14", { trades: 25, tagged: 7 }]]) }), stored)).toMatchObject({ progress: 7, status: "active" });
    expect(e.evaluateQuest(data({ tagDays: new Map([["2026-10-14", { trades: 25, tagged: 12 }]]) }), stored)).toMatchObject({ progress: 10, status: "done" });
    // Past its last day (the next trading day) without enough tags → expired.
    expect(e.evaluateQuest(data({ today: "2026-10-16", tagDays: new Map([["2026-10-14", { trades: 25, tagged: 3 }]]) }), stored).status).toBe("expired");
  });
});
