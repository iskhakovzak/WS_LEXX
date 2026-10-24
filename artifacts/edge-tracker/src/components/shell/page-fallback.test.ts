// Route-level loading skeleton follows the shape of the page being opened (no layout jump on arrival).
import { describe, expect, it } from "vitest";
import { pageShapeOf } from "./page-fallback";

describe("pageShapeOf", () => {
  it("maps the main pages to their skeleton shape", () => {
    expect(pageShapeOf("/")).toBe("dashboard");
    expect(pageShapeOf("/trades?highlight=3")).toBe("table");
    expect(pageShapeOf("/stats")).toBe("analytics");
    expect(pageShapeOf("/analytics")).toBe("analytics");
    expect(pageShapeOf("/behavior")).toBe("analytics");
    expect(pageShapeOf("/what-if")).toBe("analytics");
    expect(pageShapeOf("/journal")).toBe("journal");
    expect(pageShapeOf("/playbook")).toBe("split");
    expect(pageShapeOf("/academy/learn")).toBe("split");
    expect(pageShapeOf("/risk")).toBe("desk");
    expect(pageShapeOf("/curator")).toBe("desk");
    expect(pageShapeOf("/events")).toBe("generic");
  });
});
