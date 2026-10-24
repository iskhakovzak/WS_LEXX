import { describe, expect, it } from "vitest";
import type { Trade } from "@workspace/api-client-react";
import { feeShareText, linkedPlaybookId, notesHasContent, parseSectionPrefs, reviewHasContent, sectionOpen, stopIsEstimate, type SectionContext } from "../sheet-model";
import { shownExitEfficiency } from "@/components/replay/types";

describe("trade sheet / list helpers", () => {
  it("a broker trade whose stop equals its exit has an estimated stop and R (MAKSIM-25)", () => {
    expect(stopIsEstimate({ source: "propreports", stop: 705.09, exit: 705.09 })).toBe(true);
    expect(stopIsEstimate({ source: "propreports", stop: 704.5, exit: 705.09 })).toBe(false);
    expect(stopIsEstimate({ source: "manual", stop: 705.09, exit: 705.09 })).toBe(false);
    expect(stopIsEstimate({ source: "propreports", stop: null, exit: 705.09 })).toBe(false);
  });

  it("fees share of gross: hidden without a positive gross, capped above 100 % (ILYA-25)", () => {
    expect(feeShareText(20.52, 37.05)?.share).toBeCloseTo(0.5538, 3);
    expect(feeShareText(24.14, 1.5)?.text.startsWith(">")).toBe(true);
    expect(feeShareText(5, 0)).toBeNull();
    expect(feeShareText(5, -10)).toBeNull();
    expect(feeShareText(null, 10)).toBeNull();
  });

  it("the linked playbook setup comes from the trade's playbookId when the API sends it (ILYA-16)", () => {
    expect(linkedPlaybookId({ playbookId: 192 } as unknown as Trade)).toBe(192);
    expect(linkedPlaybookId({ playbookId: "7" } as unknown as Trade)).toBe(7);
    expect(linkedPlaybookId({} as Trade)).toBeNull();
  });

  it("a closed trade that was never in profit shows 0 % exit efficiency; an open one stays empty (ILYA-03)", () => {
    expect(shownExitEfficiency({ exitEfficiency: null, captured: { perShare: -0.51, r: null, usd: -10.2 } })).toBe(0);
    expect(shownExitEfficiency({ exitEfficiency: null, captured: null })).toBeNull();
    expect(shownExitEfficiency({ exitEfficiency: 0.42, captured: { perShare: 0.2, r: null, usd: 4 } })).toBe(0.42);
  });
});

describe("trade sheet sections", () => {
  const ctx = (o: Partial<SectionContext> = {}): SectionContext => ({ awaitingReview: false, reviewHasContent: false, notesHasContent: false, ...o });

  it("defaults: everything closed; review / notes open when they have content", () => {
    expect(sectionOpen("executions", {}, undefined, ctx())).toBe(false);
    expect(sectionOpen("review", {}, undefined, ctx())).toBe(false);
    expect(sectionOpen("review", {}, undefined, ctx({ reviewHasContent: true }))).toBe(true);
    expect(sectionOpen("notes", {}, undefined, ctx({ notesHasContent: true }))).toBe(true);
    expect(sectionOpen("context", {}, undefined, ctx({ reviewHasContent: true, notesHasContent: true }))).toBe(false);
  });

  it("the remembered state wins over the default; a trade awaiting review always opens the review", () => {
    expect(sectionOpen("executions", { executions: true }, undefined, ctx())).toBe(true);
    expect(sectionOpen("review", { review: false }, undefined, ctx({ reviewHasContent: true }))).toBe(false);
    expect(sectionOpen("review", { review: false }, undefined, ctx({ awaitingReview: true }))).toBe(true);
  });

  it("a click on this trade wins over everything", () => {
    expect(sectionOpen("review", { review: true }, false, ctx({ awaitingReview: true }))).toBe(false);
    expect(sectionOpen("related", { related: false }, true, ctx())).toBe(true);
  });

  it("stored prefs keep only known sections with boolean values", () => {
    expect(parseSectionPrefs(null)).toEqual({});
    expect(parseSectionPrefs("{oops")).toEqual({});
    expect(parseSectionPrefs("[true]")).toEqual({});
    expect(parseSectionPrefs(JSON.stringify({ review: true, notes: "yes", bogus: true, ai: false }))).toEqual({ review: true, ai: false });
  });

  it("review content = text, a grade, mistakes or curator reviews; notes content = notes or screenshots", () => {
    const empty = { whatWorked: null, whatFailed: " ", conclusion: null, confidenceGrade: null };
    expect(reviewHasContent(empty, 0, 0)).toBe(false);
    expect(reviewHasContent({ ...empty, conclusion: "late entry" }, 0, 0)).toBe(true);
    expect(reviewHasContent({ ...empty, confidenceGrade: "B" }, 0, 0)).toBe(true);
    expect(reviewHasContent(empty, 1, 0)).toBe(true);
    expect(reviewHasContent(empty, 0, 2)).toBe(true);
    expect(notesHasContent({ notes: "  ", screenshotUrl: null })).toBe(false);
    expect(notesHasContent({ notes: null, screenshotUrl: "/s/1.png" })).toBe(true);
  });
});
