/**
 * One stage resolution (Волна 0, item 0.6, lib/people/stage.ts): a trader without a stage gets DEFAULT_STAGE (owner 2026-10-20: «Джун») on every screen
 * (path report / daily «До Джуна», shell tier, playbook locks, discussions), staff without a stage have none, and a
 * promotion along the path moves trader_risk_limits.tier on the same transaction client. The DB is an in-memory fake.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Db = {
  users: { name: string; role: string }[];
  own: { user_name: string; stage: string; since: string }[];
  enr: { user_name: string; stage: string; joined_on: string; cohort_id: number }[];
  limits: { trader: string; tier: string | null }[];
};
const db = vi.hoisted(() => ({ users: [], own: [], enr: [], limits: [] } as Db));
const pick = <T extends Record<string, unknown>>(rows: T[], col: keyof T, params: unknown[]) => {
  const names = params[0] as string[] | undefined;
  return names ? rows.filter((r) => names.includes(String(r[col]))) : rows;
};
vi.mock("@workspace/db", () => ({
  db: {},
  pool: {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      let rows: unknown[] = [];
      if (/FROM academy_trader_stage/.test(sql)) rows = /WHERE user_name = \$1$/.test(sql.trim()) ? db.own.filter((r) => r.user_name === params[0]) : pick(db.own, "user_name", params);
      else if (/FROM academy_enrollments/.test(sql)) rows = typeof params[0] === "string" ? db.enr.filter((r) => r.user_name === params[0]) : pick(db.enr, "user_name", params);
      else if (/FROM trader_risk_limits/.test(sql)) rows = typeof params[0] === "string" ? db.limits.filter((r) => r.trader === params[0]) : pick(db.limits, "trader", params);
      else if (/SELECT role FROM users WHERE name = \$1/.test(sql)) rows = db.users.filter((u) => u.name === params[0]);
      else if (/FROM users WHERE active = true/.test(sql)) rows = pick(db.users.filter((u) => u.role === "trader"), "name", params);
      return { rows, rowCount: rows.length };
    }),
  },
}));

const stage = await import("../people/stage");
const { loadStaffTier, viewerTier } = await import("../playbookToday/tier");
const { pickStage: audiencePick } = await import("../discussionAudience");

beforeEach(() => {
  db.users = [
    { name: "chert", role: "trader" },
    { name: "Джун Д.", role: "trader" },
    { name: "Олег Е.", role: "trader" },
    { name: "Ольга Н.", role: "curator" },
    { name: "Закир", role: "admin" },
  ];
  db.own = [{ user_name: "Джун Д.", stage: "junior", since: "2026-09-01" }];
  db.enr = [{ user_name: "Олег Е.", stage: "trainee", joined_on: "2026-10-01", cohort_id: 7 }];
  db.limits = [{ trader: "Закир", tier: "trainee" }, { trader: "Джун Д.", tier: "trainee" }];
});

describe("pickStage (pure)", () => {
  it("the default is «Джун» (owner decision 2026-10-20; «Стажёр» leaves the ladder in Волна 1 — one constant)", () => {
    expect(stage.DEFAULT_STAGE).toBe("junior");
  });
  it("own → enrolment → risk tier → DEFAULT_STAGE («Джун») for a trader; staff and unknown role stay without a stage", () => {
    expect(stage.pickStage("trader", "junior", "trainee", "trader")).toBe("trader");
    expect(stage.pickStage(null, "junior", "trainee", "trader")).toBe("junior");
    expect(stage.pickStage(null, null, "senior", "trader")).toBe("senior");
    expect(stage.pickStage(null, null, null, "trader")).toBe(stage.DEFAULT_STAGE);
    expect(stage.pickStage(null, null, "lead", "trader")).toBe(stage.DEFAULT_STAGE); // «lead» is a scaling-only tier, not a stage
    expect(stage.pickStage(null, null, null, "curator")).toBeNull();
    expect(stage.pickStage(null, null, null)).toBeNull();
    expect(stage.resolveStage({ role: "trader" })).toEqual({ stage: "junior", source: "default" });
  });
  it("discussions use the same rule (with the member's role)", () => {
    expect(audiencePick(null, null, null, "trader")).toBe("junior");
    expect(audiencePick(null, null, "lead")).toBeNull();
  });
});

describe("loadStageInfo — the one source", () => {
  it("chert (no stage anywhere) gets the default stage; staff without a stage are absent", async () => {
    const m = await stage.loadStageInfo(["chert", "Ольга Н."]);
    expect(m.get("chert")).toEqual({ stage: "junior", since: null, source: "default", cohortId: null });
    expect(m.has("Ольга Н.")).toBe(false);
  });
  it("precedence and metadata: path keeps its date, enrolment its cohort, the admin's limits tier still counts", async () => {
    const m = await stage.loadStageInfo(null);
    expect(m.get("Джун Д.")).toMatchObject({ stage: "junior", source: "path", since: "2026-09-01" });
    expect(m.get("Олег Е.")).toMatchObject({ stage: "trainee", source: "enrollment", since: "2026-10-01", cohortId: 7 });
    expect(m.get("Закир")).toMatchObject({ stage: "trainee", source: "scaling" });
    expect(m.get("chert")?.source).toBe("default");
    expect(await stage.stageOf("chert")).toBe("junior");
    expect(await stage.stageOf("Ольга Н.")).toBeNull();
  });
  it("academyPathStore re-exports it (daily/me «До Джуна» reads the path report through it)", async () => {
    const store = await import("../academyPathStore");
    expect(store.loadStageInfo).toBe(stage.loadStageInfo);
  });
  it("shell tier / playbook locks: a trader without a stage → the default (junior), staff → none", async () => {
    expect(await loadStaffTier("chert")).toEqual({ staff: false, tier: "junior" });
    expect(await viewerTier("chert")).toBe("junior");
    expect(await loadStaffTier("Ольга Н.")).toEqual({ staff: true, tier: null });
    expect(await viewerTier("Ольга Н.")).toBeNull();
  });
});

describe("syncRiskTier — promotion along the path moves the risk tier", () => {
  it("runs on the caller's transaction client, between the stage write and COMMIT", async () => {
    const calls: { sql: string; params?: unknown[] }[] = [];
    const client = { query: vi.fn(async (sql: string, params?: unknown[]) => { calls.push({ sql, params }); return { rows: [] }; }) };
    // The shape of routes/academy-path.ts setStage with the one-line call added.
    await client.query("BEGIN");
    await client.query("INSERT INTO academy_trader_stage (user_name, stage, since, updated_by, updated_at) VALUES ($1,$2,$3,$4,NOW())", ["chert", "junior", "2026-10-20", "Закир"]);
    await stage.syncRiskTier(client, "chert", "junior", "Закир");
    await client.query("COMMIT");
    expect(calls.map((c) => c.sql.trim().split(/\s+/)[0])).toEqual(["BEGIN", "INSERT", "INSERT", "COMMIT"]);
    const tier = calls[2]!;
    expect(tier.sql).toMatch(/INSERT INTO trader_risk_limits/);
    expect(tier.sql).toMatch(/academy_stages/); // the stage's scaling tier (default: the stage key)
    expect(tier.sql).toMatch(/ON CONFLICT \(trader\) DO UPDATE SET tier = EXCLUDED\.tier/);
    expect(tier.params).toEqual(["chert", "junior", "Закир"]);
  });
  it("drops the cached shell tier so the menu and the locks follow at once", async () => {
    expect(await viewerTier("chert")).toBe("junior");
    db.own.push({ user_name: "chert", stage: "trader", since: "2026-10-20" });
    expect(await viewerTier("chert")).toBe("junior"); // cached
    await stage.syncRiskTier({ query: async () => ({ rows: [] }) }, "chert", "trader", "Закир");
    expect(await viewerTier("chert")).toBe("trader");
  });
});
