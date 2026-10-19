/** Curator quest events carry the curator's note (the cabinet shows it next to the result). */
import { describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("@workspace/db", () => ({ db: {}, pool: { query: (...a: unknown[]) => query(...a) } }));

const { curatorQuestEvents } = await import("../quests/store");

describe("curatorQuestEvents", () => {
  it("selects and returns the note", async () => {
    query.mockResolvedValueOnce({ rows: [
      { trader: "Кирилл Б.", id: "7", template: "no_revenge", status: "done", at: "2026-10-16", note: "keep it" },
      { trader: "Кирилл Б.", id: 8, template: "plan_days", status: "failed", at: "2026-10-15", note: null },
    ] });
    const ev = await curatorQuestEvents(["Кирилл Б."], "2026-10-10");
    expect(String(query.mock.calls[0][0])).toMatch(/\bnote\b/);
    expect(ev).toEqual([
      { trader: "Кирилл Б.", questId: 7, template: "no_revenge", status: "done", at: "2026-10-16", note: "keep it" },
      { trader: "Кирилл Б.", questId: 8, template: "plan_days", status: "failed", at: "2026-10-15", note: null },
    ]);
  });
  it("no traders → no query", async () => {
    query.mockClear();
    expect(await curatorQuestEvents([], "2026-10-10")).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});
