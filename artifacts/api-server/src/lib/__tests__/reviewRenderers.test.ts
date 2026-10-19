import { describe, expect, it } from "vitest";
import { renderNotification } from "../notificationText";
import { weekMonday } from "../notificationRenderers/review";

describe("review / academy notifications: one date format (OLGA-16, OLGA-22)", () => {
  it("ISO week keys and Mondays → the Monday", () => {
    expect(weekMonday("2026-W42")).toBe("2026-10-12");
    expect(weekMonday("2026-W01")).toBe("2025-12-29");
    expect(weekMonday("2026-10-14")).toBe("2026-10-12");
    expect(weekMonday("garbage")).toBeNull();
  });

  it("weekly review ready: a human week range, never «2026-W42»", () => {
    const out = renderNotification("weekly_review", { variant: "ready", week: "2026-W42", actor: "Ольга Н.", score: 7 }, "ru")!;
    expect(out.title).not.toContain("W42");
    expect(out.title).toContain("12 окт.");
    expect(out.title).toContain("16 окт.");
    expect(renderNotification("weekly_review", { variant: "submitted", week: "2026-W42", trader: "Денис Ф." }, "en")!.title).toContain("Oct 12");
  });

  it("rating: the week as a range", () => {
    expect(renderNotification("rating", { variant: "new", week: "2026-10-12", actor: "Ольга Н.", overall: 7 }, "ru")!.title).toContain("12 окт. – 16 окт.");
  });

  it("exam assigned: the reader's date, not the raw ISO day", () => {
    const body = renderNotification("academy_challenge_assigned", { actor: "Ольга Н.", name: "Challenge 1", date: "2026-10-15" }, "ru")!.body!;
    expect(body).toContain("15 окт.");
    expect(body).not.toContain("2026-10-15");
  });
});
