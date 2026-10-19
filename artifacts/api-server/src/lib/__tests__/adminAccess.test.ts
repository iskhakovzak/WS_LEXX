/**
 * ADMIN-ACCESS fixes (persona triage area 4): the inactive rule shared by «Использование» and the Обзор card (OWNER-04),
 * the member view of the roster (DEV-14), the personal-scope default (DEV-19), the analyst refresh cooldown (DEV-03).
 * Pure helpers only — no DB.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@workspace/db", () => ({ db: {}, pool: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) } }));
vi.mock("@workspace/integrations-anthropic-ai", () => ({ anthropic: {}, getAnthropic: () => ({}), isAnthropicConfigured: () => false, AnthropicNotConfiguredError: class extends Error {} }));
process.env.JWT_SECRET ??= "vitest-only-secret";

const { inactiveFrom, INACTIVE_AFTER } = await import("../usage/funnel");
const { personalOwner } = await import("../auth");
const { memberDirectory } = await import("../../routes/users");
const { analystRefreshWait, ANALYST_REFRESH_COOLDOWN_MS } = await import("../analystRefreshCooldown");

describe("inactiveFrom — one rule for both admin screens (OWNER-04)", () => {
  // Trading days Thu 15 … Fri 23 Oct 2026 (weekend skipped).
  const window = ["2026-10-15", "2026-10-16", "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"];
  const last: Record<string, string | null> = { "Артём Г.": "2026-10-16", "Умид": null, "Максим Р.": "2026-10-22" };
  const lastDayOf = (n: string) => last[n] ?? null;

  it("tracking started Sunday 18.10: Monday is too little data, nobody is listed", () => {
    const r = inactiveFrom(Object.keys(last), lastDayOf, window, "2026-10-19", "2026-10-18");
    expect(r).toEqual({ lowData: true, trackedDays: 0, rows: [] });
  });

  it("only trading days since tracking started count; a Friday trader is not «30+ days without a trace»", () => {
    const r = inactiveFrom(Object.keys(last), lastDayOf, window, "2026-10-23", "2026-10-18");
    expect(r.lowData).toBe(false);
    expect(r.trackedDays).toBe(4); // 19, 20, 21, 22 (today never counts)
    const by = Object.fromEntries(r.rows.map((x) => [x.name, x]));
    expect(by["Артём Г."]).toMatchObject({ missedDays: 4, capped: true, lastDay: "2026-10-16" });
    expect(by["Умид"]).toMatchObject({ missedDays: 4, capped: true, lastDay: null });
    expect(by["Максим Р."]).toBeUndefined();
    expect(INACTIVE_AFTER).toBe(3);
  });

  it("no tracking at all → low data", () => {
    expect(inactiveFrom(["X"], () => null, window, "2026-10-23", null).lowData).toBe(true);
  });
});

describe("memberDirectory — what a trader sees of the roster (DEV-14)", () => {
  const rows = [
    { id: 1, name: "Илья Ш.", role: "trader", active: true, theme: "dark", banned: false, createdAt: "2026-01-01", nameLatin: "Ilya Sh." },
    { id: 2, name: "Ольга Н.", role: "curator", active: true, theme: "light", banned: false, bannedAt: null, bannedReason: null, createdAt: "2025-01-01", nameLatin: null },
    { id: 3, name: "Заморожен", role: "trader", active: true, theme: "dark", banned: true, bannedAt: "x", bannedReason: "y", createdAt: "2025-01-01" },
  ];
  it("others: directory fields only, frozen people left out; own row stays full", () => {
    const out = memberDirectory(rows, "Илья Ш.");
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ name: "Илья Ш.", theme: "dark", createdAt: "2026-01-01" });
    expect(out[1]).toEqual({ id: 2, name: "Ольга Н.", nameLatin: null, role: "curator", active: true });
    for (const r of out) expect(r).not.toHaveProperty("bannedReason");
    expect(out[1]).not.toHaveProperty("banned");
  });
});

describe("personalOwner — the personal-scope contract (DEV-19)", () => {
  it("defaults to the caller, keeps a given name, rejects an over-long one", () => {
    expect(personalOwner(undefined, "Илья Ш.")).toBe("Илья Ш.");
    expect(personalOwner("  ", "Илья Ш.")).toBe("Илья Ш.");
    expect(personalOwner(" Денис Ф. ", "Илья Ш.")).toBe("Денис Ф.");
    expect(personalOwner("x".repeat(121), "Илья Ш.")).toBeNull();
    expect(personalOwner(42, "Илья Ш.")).toBe("Илья Ш.");
  });
});

describe("analyst refresh cooldown (DEV-03)", () => {
  it("10 minutes for the whole desk", () => {
    const t0 = 1_000_000_000_000;
    expect(ANALYST_REFRESH_COOLDOWN_MS).toBe(600_000);
    expect(analystRefreshWait(t0, 0)).toBe(0);
    expect(analystRefreshWait(t0 + 60_000, t0)).toBe(540_000);
    expect(analystRefreshWait(t0 + 600_000, t0)).toBe(0);
  });
});

describe("groupReviewLoad — who is late with reviews (OWNER-05)", async () => {
  const { groupReviewLoad } = await import("../admin/consoleLoad");
  it("per curator, curators with 0 listed, unassigned days and traders apart", () => {
    const now = Date.parse("2026-10-21T20:00:00Z"); // Wed
    const old = "2026-10-16T21:00:00Z"; // Fri close: > 24 trading hours ago
    const fresh = "2026-10-21T19:00:00Z";
    const r = groupReviewLoad(
      [{ curator: "Ольга Н.", closedAt: old }, { curator: "Ольга Н.", closedAt: fresh }, { curator: null, closedAt: old }, { curator: "Ушёл", closedAt: old }],
      [{ name: "Ольга Н.", role: "curator", wards: 10 }, { name: "Руслан А.", role: "curator", wards: 0 }, { name: "Дмитрий К.", role: "admin", wards: 0 }],
      13, new Set(), now,
    );
    expect(r.curators).toEqual([
      { name: "Ольга Н.", wards: 10, count: 2, overdue: 1 },
      { name: "Руслан А.", wards: 0, count: 0, overdue: 0 },
    ]);
    expect(r.unassigned).toEqual({ traders: 13, count: 2, overdue: 2 });
  });
});
