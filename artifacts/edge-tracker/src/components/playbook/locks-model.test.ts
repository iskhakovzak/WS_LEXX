// «Уровни доступа» (OWNER-03): office setups by code, which level sees each one open.
import { describe, expect, it } from "vitest";
import { lockRows } from "./locks-model";
import type { PlaybookEntry } from "./model";

const e = (id: number, name: string, minTier: string | null) => ({ id, name, minTier }) as PlaybookEntry;

describe("lockRows", () => {
  it("sorts by setup code and opens each level at or above the setup's tier", () => {
    const rows = lockRows([e(3, "3.3 Parabolic", "trader"), e(1, "1.3 ORB", "trainee"), e(2, "1.1 Gap & Go", "junior"), e(9, "Без кода", null)]); // i18n-ignore (setup names)
    expect(rows.map((r) => r.entry.id)).toEqual([2, 1, 3, 9]);
    expect(rows[0].open).toEqual({ trainee: false, junior: true, trader: true, senior: true });
    expect(rows[1].open).toEqual({ trainee: true, junior: true, trader: true, senior: true });
    expect(rows[2].open).toEqual({ trainee: false, junior: false, trader: true, senior: true });
    expect(rows[3].open.trainee).toBe(true); // no tier = everyone
  });
});
