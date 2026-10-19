import { describe, expect, it } from "vitest";
import { matchTrader, parsePeopleList } from "./pilot-users-model";

describe("parsePeopleList", () => {
  it("splits, trims, drops empties and duplicates, keeps order", () => {
    expect(parsePeopleList(" Bob , Ann,, Bob ,")).toEqual(["Bob", "Ann"]);
    expect(parsePeopleList("")).toEqual([]);
  });
});

describe("matchTrader", () => {
  const traders = [{ name: "Анна К.", nameLatin: "Anna K." }, { name: "Bob", nameLatin: null }];
  it("finds by the stored name or the Latin one, case-insensitive", () => {
    expect(matchTrader("Анна К.", traders)?.nameLatin).toBe("Anna K.");
    expect(matchTrader("anna k.", traders)?.nameLatin).toBe("Anna K.");
    expect(matchTrader("BOB", traders)?.name).toBe("Bob");
  });
  it("returns null for an unknown name", () => {
    expect(matchTrader("Nobody", traders)).toBeNull();
  });
});
