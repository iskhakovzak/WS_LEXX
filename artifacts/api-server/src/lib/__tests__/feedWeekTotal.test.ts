/** ROMAN-23: the weekly feed total sums the raw day values and rounds once (not the per-day rounded cents). */
import { describe, expect, it, vi } from "vitest";

// Five days of +$0.125 each: per-day rounding gives 5 × 0.13 = 0.65, the true week is 0.625 → 0.63.
const days = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"].map((d) => ({
  trader: "Роман Ж.", d, n: 1, wins: 1, losses: 0, priced: 1, net: 0.125, at: `${d}T20:00:00Z`,
}));
vi.mock("@workspace/db", () => ({
  db: {},
  pool: { query: vi.fn(async (sql: string) => ({ rows: /AS priced/.test(sql) ? days : [], rowCount: 0 })) },
}));
vi.mock("@workspace/integrations-anthropic-ai", () => ({ anthropic: {}, getAnthropic: () => ({}), isAnthropicConfigured: () => false, AnthropicNotConfiguredError: class extends Error {} }));
process.env.JWT_SECRET ??= "vitest-only-secret";
const { buildFeedStream } = await import("../feedStream");

describe("feed weekly total", () => {
  it("rounds the week once", async () => {
    const res = await buildFeedStream({ name: "Роман Ж.", traders: ["Роман Ж."], staff: false, riskTeam: false }, "2026-10-05", "2026-10-16", new Date("2026-10-16T21:00:00Z"), "ru");
    const week = res.items.find((i) => i.kind === "weekly_summary");
    expect(week?.value).toBe(0.63);
  });
});
