import { describe, expect, it } from "vitest";
import { isDevNoise, severityOf } from "./app-errors-model";

const row = (source: string, kind: string, message: string, status: number | null = null) => ({ source, kind, message, status });

describe("app errors model (OWNER-23)", () => {
  it("treats hot-reload leftovers as developer noise", () => {
    expect(isDevNoise(row("client", "error:Error", "useAuth must be used within an AuthProvider"))).toBe(true);
    expect(isDevNoise(row("client", "render:Error", "useSidebar must be used within a SidebarProvider."))).toBe(true);
    expect(isDevNoise(row("client", "render:TypeError", "Cannot read properties of null (reading 'useState')"))).toBe(true);
    expect(isDevNoise(row("client", "render:ReferenceError", "shellExtrasI18n is not defined"))).toBe(true);
    expect(isDevNoise(row("client", "render:TypeError", "observer.getOptimisticResult is not a function"))).toBe(true);
  });
  it("keeps real errors", () => {
    expect(isDevNoise(row("client", "render:TypeError", "Cannot read properties of undefined (reading 'query')"))).toBe(false);
    expect(isDevNoise(row("client", "error:TypeError", "el.closest is not a function"))).toBe(false);
    expect(isDevNoise(row("server", "error:Error", "useAuth must be used within an AuthProvider"))).toBe(false);
  });
  it("severity: server 5xx high, screen crash medium, the rest low", () => {
    expect(severityOf(row("server", "route", "boom", 500))).toBe("high");
    expect(severityOf(row("server", "route", "boom", null))).toBe("high");
    expect(severityOf(row("server", "route", "bad", 404))).toBe("low");
    expect(severityOf(row("client", "render:TypeError", "x"))).toBe("medium");
    expect(severityOf(row("client", "error:TypeError", "x"))).toBe("low");
    expect(severityOf(row("csp", "csp", "x"))).toBe("low");
  });
});
