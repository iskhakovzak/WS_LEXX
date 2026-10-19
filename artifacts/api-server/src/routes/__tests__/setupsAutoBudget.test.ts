/**
 * GET /setups-auto reads only by default (DEV-10): computing suggestions (and fetching candles for them) needs an explicit
 * `budget`, as the «Посчитать всё» loop sends it.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@workspace/integrations-anthropic-ai", () => ({ anthropic: {}, getAnthropic: () => ({}), isAnthropicConfigured: () => false, AnthropicNotConfiguredError: class extends Error {} }));
process.env.JWT_SECRET ??= "vitest-only-secret";
const { listSchema } = await import("../setups-auto");

describe("setups-auto list query", () => {
  it("defaults budget to 0 (no computation on a plain GET)", () => {
    expect(listSchema.parse({}).budget).toBe(0);
  });
  it("still accepts an explicit budget up to 50", () => {
    expect(listSchema.parse({ budget: "30" }).budget).toBe(30);
    expect(listSchema.safeParse({ budget: "51" }).success).toBe(false);
  });
});
