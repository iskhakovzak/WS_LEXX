import { describe, expect, it } from "vitest";
import { clause, reviewText, whatIfHref, type ReviewDto } from "./ai-review-data";
import { decodeRules } from "@/components/what-if/rules";

describe("AI review helpers", () => {
  it("lowers the first word of an if / then clause, never an acronym or a ticker", () => {
    expect(clause("Before any entry after 15:00")).toBe("before any entry after 15:00");
    expect(clause("Перед входом")).toBe("перед входом");
    expect(clause("NVDA gaps up")).toBe("NVDA gaps up");
    expect(clause("already lower")).toBe("already lower");
  });

  it("links the proposed rule into the simulator (the What-if page decodes it back)", () => {
    const href = whatIfHref({ type: "afterLoss", minutes: 10 });
    expect(href).toMatch(/^\/what-if\?r=/);
    expect(decodeRules(href!.split("r=")[1])).toEqual([{ type: "afterLoss", minutes: 10 }]);
    expect(whatIfHref(null)).toBeNull();
  });

  it("copies a review as plain text without a model name", () => {
    const d = {
      id: 1, kind: "day", trader: "A", tradeId: null, day: "2026-10-15", tier: "deep", units: 1, whatIfRule: null, createdAt: "", cached: true, facts: null,
      review: {
        verdict: { grade: "B", headline: "Clean day", followedPlan: "partly" },
        wentWell: [{ text: "No revenge", basis: "fact", evidence: [{ kind: "stat", label: "after loss: 0", at: null, ref: null }] }],
        wentWrong: [], edge: null, tomorrow: { if: "After 15:00", then: "Log the setup first" }, whatIf: null, confidence: "low", dataGaps: [],
      },
    } as ReviewDto;
    const text = reviewText(d, (k, p) => (p ? `${k}:${JSON.stringify(p)}` : k));
    expect(text).toContain("review.if after 15:00 — review.then log the setup first");
    expect(text).not.toMatch(/claude|haiku|sonnet|opus/i);
  });
});
