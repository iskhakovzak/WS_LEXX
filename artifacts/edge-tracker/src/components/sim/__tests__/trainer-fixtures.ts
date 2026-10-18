/** «Тренажёр» fixtures shaped like the contract (lib/trainer/types.ts) — the web side is built and tested against them. */
import type { DailyChallengeState, FindEntryAnswer, FindEntryDrill, TrainerHome } from "@/lib/trainer/types";

export function daily(over: Partial<DailyChallengeState> = {}): DailyChallengeState {
  return { date: "2026-10-16", revealed: null, played: false, activeGameId: null, my: null, ranking: [], streak: 0, ...over };
}

export const playedDaily = (): DailyChallengeState => daily({
  played: true,
  revealed: { ticker: "AMD", barsDate: "2026-09-24" },
  my: { r: 1.4, rank: 7, of: 12 },
  streak: 3,
  activeGameId: 501,
  ranking: [
    { label: "t4", me: false, r: 3.2, trades: 2 },
    { label: "Ольга Н.", me: false, r: 2.1, trades: 1 },
    { label: "t9", me: false, r: 1.9, trades: 4 },
    { label: "Кирилл Б.", me: true, r: 1.4, trades: 3 },
  ],
});

export function home(over: Partial<TrainerHome> = {}): TrainerHome {
  return {
    daily: daily(),
    myDays: { candidates: 4, active: null },
    findEntry: {
      setups: [
        { setupId: 11, code: "1.3", name: "ORB", drills: 24, masteryLevel: 2 },
        { setupId: 12, code: "2.1", name: "VWAP Hold", drills: 9, masteryLevel: 0 },
        { setupId: 13, code: "3.3", name: "Parabolic", drills: 0, masteryLevel: 0 },
      ],
      streak: 2,
    },
    stats: { attempts30d: 21, avgR30d: 0.42, beatReal: 3, findEntryAccuracy: 71.6 },
    ...over,
  };
}

const bar = (i: number, base: number) => ({ t: 979117200 + 60 * i, o: base, h: base + 0.3, l: base - 0.2, c: base + 0.1, v: 1000 + i });

export function drill(over: Partial<FindEntryDrill> = {}): FindEntryDrill {
  return {
    id: 77, setupId: 11, setupCode: "1.3", setupName: "ORB", side: "long", tf: "1m",
    bars: Array.from({ length: 40 }, (_, i) => bar(i, 20 + i * 0.05)),
    window: { from: 30, to: 39 },
    ...over,
  };
}

export function answer(over: Partial<FindEntryAnswer> = {}): FindEntryAnswer {
  return {
    score: 82,
    ideal: { barIndex: 33, price: 21.7 },
    yours: { barIndex: 35, price: 21.85 },
    explanation: { key: "trainer.findEntry.verdict.late", params: { bars: 2, atr: 0.4, score: 82, setup: "1.3 ORB" } },
    revealed: { ticker: "NVDA", date: "2026-08-12", source: "playbook_example" },
    barsAfter: [bar(40, 22), bar(41, 22.1)],
    masteryDelta: 1,
    ...over,
  };
}
