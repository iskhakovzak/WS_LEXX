import { describe, expect, it } from "vitest";
import { NONE, groupNameProblem, moveTargets } from "./groups-api";

const state = { groups: [{ id: 1, name: "Утро" }, { id: 2, name: "Вечер" }] as never };

describe("«Группы» model (Волна 1 п. 1.19)", () => {
  it("move targets: the current place first, every other group and «Без группы»", () => {
    expect(moveTargets(state, 2).map((x) => x.value)).toEqual(["2", "1", NONE]);
    expect(moveTargets(state, null).map((x) => x.value)).toEqual([NONE, "1", "2"]);
    expect(moveTargets(state, null)[0]).toEqual({ value: NONE, groupId: null, name: null });
  });
  it("a group name: not empty, ≤ 60, unique among live groups (case-insensitive), own name allowed on rename", () => {
    expect(groupNameProblem("  ", state.groups)).toBe("empty");
    expect(groupNameProblem("x".repeat(61), state.groups)).toBe("long");
    expect(groupNameProblem("утро ", state.groups)).toBe("taken");
    expect(groupNameProblem("Утро", state.groups, 1)).toBeNull();
    expect(groupNameProblem("День", state.groups)).toBeNull();
  });
});
