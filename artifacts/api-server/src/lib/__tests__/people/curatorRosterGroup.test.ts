/**
 * Волна 1 п. 1.19: the curator cabinet roster (lib/curatorRoster loadRoster → /curator/today, /curator/traders, queue)
 * reads «Моя группа» = traders of the desk groups the curator leads + traders assigned to him; scope=group|all (and the
 * older mine|desk); default = my group when I have one; the matrix readScope still bounds everything.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

let readable: string[] | null = null;
vi.mock("@workspace/db", () => ({
  db: {},
  pool: {
    query: vi.fn(async () => ({
      rows: [
        { name: "A (group)", role: "trader", ac: null, am: null, ar: null },
        { name: "B (assigned)", role: "trader", ac: "Ольга Н.", am: null, ar: null },
        { name: "C (other)", role: "trader", ac: "Иван", am: null, ar: null },
        { name: "Ольга Н.", role: "curator", ac: null, am: null, ar: null },
      ],
    })),
  },
}));
vi.mock("../../permissions", () => ({ readScope: vi.fn(async () => readable) }));
const groups = vi.hoisted(() => ({ groupMembersOf: vi.fn(async (n: string) => (n === "Ольга Н." ? ["A (group)"] : [])) }));
vi.mock("../../people/deskGroups", () => groups);

const { loadRoster } = await import("../../curatorRoster");
const reqOf = (name: string) => ({ authUser: { id: 3, name, role: "curator" } }) as never;

beforeEach(() => { readable = null; });

describe("loadRoster «Моя группа / Все»", () => {
  it("default: my group (desk group + assignments); scope=all / desk → the whole desk", async () => {
    const mine = await loadRoster(reqOf("Ольга Н."), undefined);
    expect(mine).toEqual({ scope: "mine", traders: ["A (group)", "B (assigned)"], wards: ["A (group)", "B (assigned)"] });
    expect((await loadRoster(reqOf("Ольга Н."), "group")).traders).toEqual(["A (group)", "B (assigned)"]);
    for (const s of ["all", "desk"]) {
      const all = await loadRoster(reqOf("Ольга Н."), s);
      expect(all.scope).toBe("desk");
      expect(all.traders).toEqual(["A (group)", "B (assigned)", "C (other)"]);
    }
  });

  it("a curator without a group or wards sees the desk by default; scope=group then is empty", async () => {
    expect((await loadRoster(reqOf("Пётр"), undefined)).scope).toBe("desk");
    expect((await loadRoster(reqOf("Пётр"), "group")).traders).toEqual([]);
  });

  it("the matrix scope bounds both views", async () => {
    readable = ["Ольга Н.", "A (group)"];
    expect((await loadRoster(reqOf("Ольга Н."), "all")).traders).toEqual(["A (group)"]);
  });
});
