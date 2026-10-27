/**
 * components/shared/person-link — where a name links to: own → /profile; another person only with team.read on them
 * and a known id; otherwise plain text (null).
 */
import { describe, expect, it } from "vitest";
import { profileHrefFor } from "./person-link";

const ids = new Map([["Trader A", 5], ["Trader B", 6]]);
const ctx = (me: string | null, readable: string[]) => ({ me, idOf: (n: string) => ids.get(n), canRead: (n: string) => readable.includes(n) });

describe("profileHrefFor", () => {
  it("own name → /profile, even without team.read", () => {
    expect(profileHrefFor("Trader A", ctx("Trader A", []))).toBe("/profile");
  });
  it("a trader sees colleagues as plain text", () => {
    expect(profileHrefFor("Trader B", ctx("Trader A", []))).toBeNull();
  });
  it("staff link by id; unknown ids and empty names are not links", () => {
    expect(profileHrefFor("Trader B", ctx("Curator", ["Trader A", "Trader B"]))).toBe("/people/6");
    expect(profileHrefFor("Nobody", ctx("Curator", ["Nobody"]))).toBeNull();
    expect(profileHrefFor(null, ctx("Curator", []))).toBeNull();
  });
});
