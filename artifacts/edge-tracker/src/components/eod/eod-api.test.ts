import { describe, expect, it } from "vitest";
import { hoursText, slaText } from "./eod-api";

describe("eod waiting time (OLGA-08)", () => {
  it("one format with the cabinet; 24 h rolls over into a day", () => {
    expect(hoursText(0.4)).toBe("<1 ч");
    expect(hoursText(36)).toBe("1 дн 12 ч");
    expect(hoursText(71.6)).toBe("3 дн");
    expect(hoursText(275.8)).toBe("11 дн 12 ч");
    expect(hoursText(23.6)).toBe("1 дн");
  });
  it("SLA left / overdue", () => {
    expect(slaText(30, 24)).toBe("просрочено на 6 ч");
    expect(slaText(20, 24)).toBe("осталось 4 ч");
  });
});
