// /stats scope (owner rule 2026-10-21): staff open on their own book on the trader path (raw trades, equity chart with
// day hover and «Разбор дня»); server aggregates only for «Вся команда».
import { describe, expect, it } from "vitest";
import { statsScope } from "./staff-data";

describe("statsScope", () => {
  it("staff + the stored default «all» ⇒ their own book on the trader path", () => {
    expect(statsScope({ staff: true, me: "Curator C", picked: "all", team: false })).toEqual({ trader: "Curator C", team: false, self: true });
  });

  it("staff + self picked ⇒ trader path (no aggregate)", () => {
    expect(statsScope({ staff: true, me: "Curator C", picked: "Curator C", team: false }).team).toBe(false);
  });

  it("staff + another trader ⇒ trader path for that trader", () => {
    expect(statsScope({ staff: true, me: "Curator C", picked: "Bob", team: false })).toEqual({ trader: "Bob", team: false, self: false });
  });

  it("staff + «Вся команда» ⇒ the aggregate path", () => {
    expect(statsScope({ staff: true, me: "Curator C", picked: "all", team: true })).toEqual({ trader: null, team: true, self: false });
    expect(statsScope({ staff: true, me: "Curator C", picked: "Bob", team: true }).team).toBe(true);
  });

  it("a trader never gets the aggregate path", () => {
    expect(statsScope({ staff: false, me: "Ann", picked: "all", team: true }).team).toBe(false);
  });
});
