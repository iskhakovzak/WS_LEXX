/**
 * «Задача дня» service rules with the stores faked: current challenge date, idempotent pick, reveal / ranking
 * visibility, start / resume / closed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChallengeRow } from "../trainer/dailyStore";

const DAY_BARS_DATE = "2026-10-01";
let challenges = new Map<string, ChallengeRow>();
let games: { userId: number; id: number; status: string; name: string; r: number; trades: number }[] = [];
const saved: string[] = [];

vi.mock("../marketDays", () => ({
  isMarketClosed: vi.fn(async (d: string) => { const wd = new Date(`${d}T00:00:00Z`).getUTCDay(); return wd === 0 || wd === 6; }),
}));
vi.mock("../trainer/dailyStore", () => ({
  challengeOf: vi.fn(async (d: string) => challenges.get(d) ?? null),
  savePick: vi.fn(async (p: ChallengeRow) => { saved.push(p.date); if (!challenges.has(p.date)) challenges.set(p.date, p); return challenges.get(p.date)!; }),
  recentChallenges: vi.fn(async () => []),
  challengeDates: vi.fn(async () => [...challenges.keys()].sort().reverse()),
  dailyCandidates: vi.fn(async () => [
    { ticker: "AAA", day: DAY_BARS_DATE, open: 50, volume: 9e6, rangePct: 4, gapPct: 0.5, deskTraders: 0 },
    { ticker: "BBB", day: "2026-10-02", open: 40, volume: 9e6, rangePct: 5, gapPct: 0.2, deskTraders: 0 },
  ]),
  dailyGames: vi.fn(async () => games.filter((g) => g.status === "finished").map((g) => ({ userId: g.userId, name: g.name, r: g.r, trades: g.trades }))),
  dailyParticipants: vi.fn(async () => games.map((g) => g.name)),
  myDailyGame: vi.fn(async (uid: number) => { const g = games.find((x) => x.userId === uid); return g ? { id: g.id, status: g.status } : null; }),
  playedDates: vi.fn(async () => new Set<string>()),
  tradersOfTickerDay: vi.fn(async () => new Set<string>()),
}));
vi.mock("../sim/service", () => ({
  gameSnapshot: vi.fn(async (_v: unknown, id: number) => ({ id, resumed: true })),
  settleActive: vi.fn(async () => undefined),
  newGameExtras: vi.fn(async () => ({ exec: null, oneR: 50 })),
  remember: vi.fn((g: unknown) => g),
  snapshotOf: vi.fn(async (g: { id: number }) => ({ id: g.id, created: true })),
}));
vi.mock("../sim/store", () => ({
  loadDayBars: vi.fn(async () => ({ bars: [], tf: "1m", prevClose: 50 })),
  loadPrevDay: vi.fn(async () => null),
  insertGame: vi.fn(async (g: object) => ({ ...g, id: 77 })),
  deskFeePerShare: vi.fn(async () => 0.005),
  reactivate: vi.fn(async () => undefined),
}));
vi.mock("../sim/scenario", async (orig) => ({
  ...(await orig<typeof import("../sim/scenario")>()),
  buildIntraday: vi.fn(() => ({ bars: [{ t: 1, o: 1, h: 1, l: 1, c: 50, v: 1 }], startIdx: 0, endIdx: 0, levels: { pdh: null, pdl: null, pdc: null, pmh: null, pml: null }, riskUnit: 0.1 })),
}));

// New York: EDT (UTC−4) in October.
const at = (date: string, hh: number, mm = 0) => new Date(`${date}T${String(hh + 4).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00Z`);
const viewer = { id: 1, name: "Анна", staff: false };

beforeEach(async () => {
  challenges = new Map();
  games = [];
  saved.length = 0;
  (await import("../trainer/daily"))._resetDailyMemo();
});

describe("current challenge date", () => {
  it("today from the pick time on a trading day; before it / on weekends the previous trading day", async () => {
    const { currentChallengeDate } = await import("../trainer/daily");
    expect(await currentChallengeDate(at("2026-10-16", 9))).toBe("2026-10-16");
    expect(await currentChallengeDate(at("2026-10-16", 8, 29))).toBe("2026-10-15");
    expect(await currentChallengeDate(at("2026-10-19", 7))).toBe("2026-10-16"); // Monday morning → Friday
    expect(await currentChallengeDate(at("2026-10-18", 12))).toBe("2026-10-16"); // Sunday
  });
});

describe("daily pick", () => {
  it("is picked once per date (a second call / a later read returns the same row)", async () => {
    const { ensurePick } = await import("../trainer/daily");
    const [a, b] = await Promise.all([ensurePick("2026-10-16"), ensurePick("2026-10-16")]);
    expect(a).toEqual(b);
    expect(saved).toEqual(["2026-10-16"]);
    const again = await ensurePick("2026-10-16");
    expect(again?.ticker).toBe(a?.ticker);
    expect(saved).toHaveLength(1);
  });
});

describe("daily state and start", () => {
  it("hides the ticker and the ranking until the viewer finished; shows them after", async () => {
    const { dailyState } = await import("../trainer/daily");
    games = [{ userId: 2, id: 10, status: "finished", name: "Борис", r: 1.2, trades: 2 }];
    const before = await dailyState(viewer, at("2026-10-16", 11));
    expect(before.revealed).toBeNull();
    expect(before.ranking).toEqual([]);
    expect(before.played).toBe(false);
    games.push({ userId: 1, id: 11, status: "finished", name: "Анна", r: 2, trades: 1 });
    const after = await dailyState(viewer, at("2026-10-16", 11));
    expect(after.revealed?.ticker).toMatch(/^(AAA|BBB)$/);
    expect(after.played).toBe(true);
    expect(after.ranking.map((r) => r.label)).toEqual(["Анна", expect.stringMatching(/^t\d+$/)]);
    expect(after.my).toEqual({ r: 2, rank: 1, of: 2 });
  });

  it("after the close: revealed for those who did not play; not while the viewer is mid-game", async () => {
    const { dailyState } = await import("../trainer/daily");
    const closed = await dailyState(viewer, at("2026-10-16", 16, 5));
    expect(closed.revealed).not.toBeNull();
    games = [{ userId: 1, id: 12, status: "active", name: "Анна", r: 0, trades: 0 }];
    const mid = await dailyState(viewer, at("2026-10-16", 16, 5));
    expect(mid.revealed).toBeNull();
    expect(mid.activeGameId).toBe(12);
  });

  it("start: creates once, resumes an active game, re-activates an abandoned one, refuses after the close", async () => {
    const { startDaily } = await import("../trainer/daily");
    const store = await import("../sim/store");
    expect(await startDaily(viewer, at("2026-10-16", 10))).toMatchObject({ id: 77, created: true });
    const params = vi.mocked(store.insertGame).mock.calls[0][0].params;
    expect(params.daily).toEqual({ date: "2026-10-16" });
    games = [{ userId: 1, id: 13, status: "active", name: "Анна", r: 0, trades: 0 }];
    expect(await startDaily(viewer, at("2026-10-16", 10))).toMatchObject({ id: 13, resumed: true });
    games = [{ userId: 1, id: 14, status: "abandoned", name: "Анна", r: 0, trades: 0 }];
    expect(await startDaily(viewer, at("2026-10-16", 10))).toMatchObject({ id: 14 });
    expect(store.reactivate).toHaveBeenCalledWith(14);
    games = [];
    await expect(startDaily(viewer, at("2026-10-16", 16, 1))).rejects.toMatchObject({ status: 409 });
    await expect(startDaily(viewer, at("2026-10-19", 7))).rejects.toMatchObject({ status: 409 }); // Friday's, closed
  });
});
