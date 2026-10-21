/**
 * Волна 1 п. 1.19: the matrix scope «assigned» reads the desk group — a curator's wards are the traders assigned to him
 * AND the traders of the groups he leads; a trader outside both is forbidden under «assigned», allowed under «desk».
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { pool } from "@workspace/db";

let scope: "assigned" | "desk" = "assigned";
vi.mock("@workspace/db", () => ({
  db: {},
  pool: {
    query: vi.fn(async (sql: string) => {
      if (/FROM role_permissions/.test(sql)) return { rows: [{ role: "curator", capability: "journal.review", allowed: true, scope, updated_by: "Закир", updated_at: new Date() }] };
      if (/SELECT role, name FROM users WHERE id/.test(sql)) return { rows: [{ role: "curator", name: "Ольга Н." }] };
      if (/assigned_curator = \$1/.test(sql)) return { rows: [{ name: "B (assigned)" }] };
      return { rows: [] };
    }),
  },
}));
const groups = vi.hoisted(() => ({ groupMembersOf: vi.fn(async () => ["A (group)"]) }));
vi.mock("../../people/deskGroups", () => groups);

const perms = await import("../../permissions");
const reqOf = () => ({ authUser: { id: 3, name: "Ольга Н.", role: "curator" } }) as never;

beforeEach(() => { perms.invalidatePermissionsCache(); });

describe("«assigned» = assignments + my desk groups", () => {
  it("wards include the group members; others are out under «assigned»", async () => {
    scope = "assigned";
    const actor = await perms.resolveActor(reqOf());
    expect([...actor!.wards].sort()).toEqual(["A (group)", "B (assigned)"]);
    expect(await perms.can(reqOf(), "journal.review", { trader: "A (group)" })).toBe(true);
    expect(await perms.can(reqOf(), "journal.review", { trader: "B (assigned)" })).toBe(true);
    expect(await perms.can(reqOf(), "journal.review", { trader: "C (other)" })).toBe(false);
    const readable = await perms.readScope(reqOf(), "journal.review");
    expect(readable![0]).toBe("Ольга Н.");
    expect([...readable!].sort()).toEqual(["A (group)", "B (assigned)", "Ольга Н."]);
  });

  it("«desk» scope: everyone, and the group is not even read", async () => {
    scope = "desk";
    groups.groupMembersOf.mockClear();
    expect(await perms.can(reqOf(), "journal.review", { trader: "C (other)" })).toBe(true);
    expect(groups.groupMembersOf).not.toHaveBeenCalled();
  });
});

describe("resolveActor: the name comes from the DB, not the token", () => {
  it("a token signed before a rename acts under the current name; the wards are looked up by it", async () => {
    scope = "assigned";
    groups.groupMembersOf.mockClear();
    const query = vi.mocked(pool.query);
    query.mockClear();
    const actor = await perms.resolveActor({ authUser: { id: 3, name: "Old Name", role: "curator" } } as never);
    expect(actor!.name).not.toBe("Old Name");
    const dbName = actor!.name;
    expect(dbName.length).toBeGreaterThan(0);
    expect(groups.groupMembersOf).toHaveBeenCalledWith(dbName);
    const assigned = query.mock.calls.find(([sql]) => /assigned_curator = \$1/.test(String(sql)));
    expect(assigned?.[1]).toEqual([dbName]);
  });
});
