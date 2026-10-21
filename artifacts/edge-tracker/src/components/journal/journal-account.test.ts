// /journal account (owner rule 2026-10-21): staff open on their own day; the team day ("") is a pick, never restored.
import { describe, expect, it } from "vitest";
import { accountToPick, initialJournalAccount, pickToAccount } from "./journal-account";
import { TEAM } from "@/components/people/staff-scope";

describe("initialJournalAccount", () => {
  it("staff default to their own day, also when the team was stored last time", () => {
    expect(initialJournalAccount({ staff: true, me: "Curator C", urlTrader: null, stored: null })).toBe("Curator C");
    expect(initialJournalAccount({ staff: true, me: "Curator C", urlTrader: null, stored: "" })).toBe("Curator C");
  });

  it("a link wins (empty ?trader= = the team), then a person picked last time", () => {
    expect(initialJournalAccount({ staff: true, me: "Curator C", urlTrader: "", stored: "Bob" })).toBe("");
    expect(initialJournalAccount({ staff: true, me: "Curator C", urlTrader: "Ann", stored: "Bob" })).toBe("Ann");
    expect(initialJournalAccount({ staff: true, me: "Curator C", urlTrader: null, stored: "Bob" })).toBe("Bob");
  });

  it("a trader is always themselves; staff without a trader name see the team", () => {
    expect(initialJournalAccount({ staff: false, me: "Ann", urlTrader: "Bob", stored: "Zed" })).toBe("Ann");
    expect(initialJournalAccount({ staff: true, me: null, urlTrader: null, stored: null })).toBe("");
  });

  it("maps the team between the account and the picker", () => {
    expect(accountToPick("")).toBe(TEAM);
    expect(pickToAccount(TEAM)).toBe("");
    expect(pickToAccount("Bob")).toBe("Bob");
  });
});
