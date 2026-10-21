// Staff = traders + extras (owner rule 2026-10-21): staff open on their own book like a trader, the desk is an
// explicit «Вся команда» pick, and the picker lists everyone with trades (not only role «trader»).
import { describe, expect, it } from "vitest";
import { TEAM, resolveTraderScope, scopePickerValue, traderChoices } from "./staff-scope";

describe("resolveTraderScope", () => {
  it("a trader always reads the own book (server-scoped)", () => {
    expect(resolveTraderScope({ staff: false, me: "Ann", picked: "Bob", team: true })).toEqual({ trader: null, team: false, self: true });
  });

  it("staff with nothing picked open on their OWN name, not the desk", () => {
    expect(resolveTraderScope({ staff: true, me: "Admin A", picked: "", team: false })).toEqual({ trader: "Admin A", team: false, self: true });
    expect(resolveTraderScope({ staff: true, me: "Admin A", picked: null })).toEqual({ trader: "Admin A", team: false, self: true });
  });

  it("the desk only for an explicit team pick (flag or TEAM value)", () => {
    expect(resolveTraderScope({ staff: true, me: "Admin A", picked: "", team: true })).toEqual({ trader: null, team: true, self: false });
    expect(resolveTraderScope({ staff: true, me: "Admin A", picked: TEAM })).toEqual({ trader: null, team: true, self: false });
  });

  it("a picked person is that person; picking oneself is the own book", () => {
    expect(resolveTraderScope({ staff: true, me: "Admin A", picked: "Bob" })).toEqual({ trader: "Bob", team: false, self: false });
    expect(resolveTraderScope({ staff: true, me: "Admin A", picked: "Admin A" })).toEqual({ trader: "Admin A", team: false, self: true });
  });

  it("a staff account without a trader name falls back to the desk", () => {
    expect(resolveTraderScope({ staff: true, me: null, picked: "" })).toEqual({ trader: null, team: true, self: false });
  });

  it("picker value: TEAM for the desk, else the name", () => {
    expect(scopePickerValue({ trader: null, team: true, self: false })).toBe(TEAM);
    expect(scopePickerValue({ trader: "Bob", team: false, self: false })).toBe("Bob");
  });
});

describe("traderChoices", () => {
  it("everyone with trades (traders, curators, admins), without the viewer, blanks and duplicates, sorted", () => {
    expect(traderChoices(["Zed", "Curator C", " Admin A ", "", null, "—", "Zed", "Bob"], "Admin A")).toEqual(["Bob", "Curator C", "Zed"]);
  });

  it("keeps the current pick even without trades, never the TEAM value", () => {
    expect(traderChoices(["Bob"], "Ann", "New N")).toEqual(["Bob", "New N"]);
    expect(traderChoices(["Bob"], "Ann", TEAM)).toEqual(["Bob"]);
  });
});
