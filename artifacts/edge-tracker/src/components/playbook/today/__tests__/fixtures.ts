// Fixtures of GET /api/playbook/today (shapes from lib/playbook-today/types — the contract) for the «Сегодня» tests.
import type { MyEdge, PlaybookToday, TodaySetup } from "@/lib/playbook-today/types";

const edge = (verdict: MyEdge["verdict"], trades: number, avgR: number | null): MyEdge => ({
  trades, wins: Math.round(trades / 2), winRate: trades ? 0.5 : null, avgR, totalR: avgR == null ? null : avgR * trades, verdict, lastTradedOn: "2026-10-16",
});

/** A locked setup as the API sends it (DEV-06): no rules, no checklist. */
const LOCKED: Pick<TodaySetup, "locked" | "cheat" | "checklist"> = { locked: true, cheat: { entry: null, stop: null, target: null, invalidation: null, gradeA: [] }, checklist: [] };

const setup = (id: number, code: string, name: string, schema: string, window: TodaySetup["window"], over: Partial<TodaySetup> = {}): TodaySetup => ({
  id, code, name: `${code} ${name}`, folder: null, window, time: { from: "09:35", to: "10:30" }, schema,
  locked: false, minTier: "trainee", unlock: null, myEdge: null,
  cheat: { entry: "Пробой high диапазона 5 минут", stop: "Под low диапазона", target: "2R, частично 1R", invalidation: "Возврат в диапазон", gradeA: ["SPY по направлению", "Объём на пробое ×2"] },
  checklist: ["Диапазон 5 минут отмечен", "SPY по направлению", "Объём выше среднего"],
  ...over,
});

export const today = (over: Partial<PlaybookToday> = {}): PlaybookToday => ({
  date: "2026-10-19",
  nyMinutes: 8 * 60 + 45,
  windows: [
    { key: "premarket", from: "04:00", to: "09:30", setupIds: [1] },
    { key: "open", from: "09:30", to: "10:30", setupIds: [13, 15, 11, 12] },
    { key: "trend", from: "10:30", to: "15:00", setupIds: [21, 33] },
    { key: "close", from: "15:00", to: "16:00", setupIds: [] },
  ],
  setups: [
    setup(1, "0.1", "Утренняя подготовка", "routine", "premarket", { time: { from: "09:00", to: "09:30" } }),
    setup(13, "1.3", "ORB", "orb", "open", { myEdge: edge("best", 23, 0.42) }),
    setup(15, "1.5", "Первый откат", "first_pullback", "open", { myEdge: edge("careful", 9, -0.1) }),
    setup(11, "1.1", "Gap & Go", "gap_go", "open", { ...LOCKED, minTier: "junior", unlock: { key: "unlock.gradeA", params: { count: 10, done: 4, code: "1.3", tier: "junior" } } }),
    setup(12, "1.2", "Opening Drive", "opening_drive", "open", { myEdge: edge("new", 2, 0.3) }),
    setup(21, "2.1", "VWAP Hold", "vwap_hold", "trend", { time: { from: "10:30", to: "14:00" }, myEdge: edge("good", 12, 0.15) }),
    setup(33, "3.3", "Parabolic", "parabolic", "trend", { ...LOCKED, minTier: "trader", unlock: { key: "unlock.tier", params: { tier: "trader" } } }),
  ],
  picks: [],
  oneR: { usd: 50, source: "plan" },
  untagged: 3,
  untaggedPeriod: { from: "2026-10-13", to: "2026-10-19" },
  ...over,
});
