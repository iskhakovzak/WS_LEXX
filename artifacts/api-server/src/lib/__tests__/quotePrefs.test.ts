import { describe, expect, it } from "vitest";
import { QUOTE_FAVS_MAX, QuotePrefsSchema } from "../people/quotePrefs";

describe("users.settings.quotes schema", () => {
  it("accepts a seed, favourite ids and categories", () => {
    const r = QuotePrefsSchema.safeParse({ seed: 123456789, favs: ["il-012", "sto-104", "trd-001"], cats: ["olympus", "trading"] });
    expect(r.success).toBe(true);
  });

  it("drops unknown keys", () => {
    const r = QuotePrefsSchema.parse({ seed: 1, evil: "<script>" });
    expect(r).not.toHaveProperty("evil");
  });

  it("rejects malformed ids, unknown categories, negative or fractional seeds and oversized lists", () => {
    expect(QuotePrefsSchema.safeParse({ favs: ["<b>x</b>"] }).success).toBe(false);
    expect(QuotePrefsSchema.safeParse({ cats: ["memes"] }).success).toBe(false);
    expect(QuotePrefsSchema.safeParse({ seed: -1 }).success).toBe(false);
    expect(QuotePrefsSchema.safeParse({ seed: 1.5 }).success).toBe(false);
    const many = Array.from({ length: QUOTE_FAVS_MAX + 1 }, (_, i) => `il-${String(i).padStart(3, "0")}`);
    expect(QuotePrefsSchema.safeParse({ favs: many }).success).toBe(false);
  });
});
