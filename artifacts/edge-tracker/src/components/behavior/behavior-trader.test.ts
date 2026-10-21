// /behavior trader (bug fix, owner rule 2026-10-21): a curator / admin's own name used to be swapped for the first
// role-«trader» user, and the picker listed role «trader» only. Now staff open on themselves and the picker offers
// everyone with trades.
import { describe, expect, it } from "vitest";
import { fallbackBehaviorTrader, initialBehaviorTrader } from "./behavior-trader";
import { traderChoices } from "@/components/people/staff-scope";

describe("initialBehaviorTrader", () => {
  it("staff open on their OWN name (no link, nothing picked)", () => {
    expect(initialBehaviorTrader({ staff: true, me: "Admin A", urlTrader: null, stored: null })).toBe("Admin A");
  });

  it("a ?trader= link wins, then the person picked by hand", () => {
    expect(initialBehaviorTrader({ staff: true, me: "Admin A", urlTrader: "Bob", stored: "Zed" })).toBe("Bob");
    expect(initialBehaviorTrader({ staff: true, me: "Admin A", urlTrader: null, stored: "Zed" })).toBe("Zed");
  });

  it("a trader always sees themselves", () => {
    expect(initialBehaviorTrader({ staff: false, me: "Ann", urlTrader: "Bob", stored: "Zed" })).toBe("Ann");
  });
});

describe("fallbackBehaviorTrader", () => {
  it("never replaces a staff member's own name with the first trader", () => {
    expect(fallbackBehaviorTrader({ staff: true, me: "Admin A", trader: "Admin A", names: ["Bob", "Ann"] })).toBeNull();
  });

  it("only a staff account without a trader name falls back to the first person with trades", () => {
    expect(fallbackBehaviorTrader({ staff: true, me: null, trader: null, names: ["Zed", "Bob"] })).toBe("Bob");
    expect(fallbackBehaviorTrader({ staff: true, me: null, trader: "Zed", names: ["Bob"] })).toBeNull();
  });
});

describe("behavior picker people", () => {
  it("lists curators and admins with trades too, the viewer as the lead option (not in the list)", () => {
    // The page passes the book facets' traders: every name with trades in the viewer's scope, any role.
    expect(traderChoices(["Trader T", "Curator C", "Admin A"], "Curator C")).toEqual(["Admin A", "Trader T"]);
  });
});
