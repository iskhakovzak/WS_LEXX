/**
 * Skipped (and prepared) games stay out of progress: every reader of sim_games for stats, the weekly leaderboard,
 * quests / achievements (own replays, «Задача дня» played) and the trainer home counts status = 'finished' only.
 * The SQL each reader sends is captured from a fake pool; the trainer home query (not exported) is checked in source.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const sqls: string[] = [];
vi.mock("@workspace/db", () => ({
  pool: { query: vi.fn(async (sql: string) => { sqls.push(sql); return { rows: [], rowCount: 0 }; }) },
}));

const store = await import("../sim/store");
const quests = await import("../quests/load");
const activity = await import("../trainer/activity");

const simReads = () => sqls.filter((s) => /FROM sim_games/.test(s));

describe("skipped games are out of stats, leaderboards and quests", () => {
  it("stats and the weekly board read finished games only", async () => {
    sqls.length = 0;
    await store.finishedGames(1);
    await store.weeklyBoard("2026-10-12", "2026-10-19", 1);
    expect(simReads()).toHaveLength(2);
    for (const s of simReads()) expect(s).toMatch(/status = 'finished'/);
  });

  it("quests / achievements read finished games only", async () => {
    sqls.length = 0;
    await quests.ownGames("Закир");
    await activity.trainerActivity("Закир");
    const reads = simReads();
    expect(reads.length).toBeGreaterThanOrEqual(3);
    for (const s of reads) expect(s).toMatch(/status = 'finished'/);
  });

  it("the trainer home 30-day stats count finished games only", () => {
    const src = readFileSync(path.join(__dirname, "../trainer/home.ts"), "utf8");
    const stats = src.match(/FROM sim_games WHERE user_id = \$1 AND status = '(\w+)'/g) ?? [];
    expect(stats.length).toBeGreaterThanOrEqual(3);
    for (const s of stats) expect(s).toMatch(/status = '(finished|active)'/);
  });
});
