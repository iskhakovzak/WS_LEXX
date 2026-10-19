import { describe, expect, it } from "vitest";
import { monthToDay } from "./monthly";
import { sameDayValue } from "./overview";
import type { YearView } from "./api";

const day = (date: string, doy: number, v: number, cum: number) => ({ date, doy, v, cum, trades: 1, s: {} });
const y2025 = {
  year: 2025, hasData: true,
  days: [day("2025-10-02", 275, 10, 100), day("2025-10-15", 288, 5, 105), day("2025-10-28", 301, 40, 145)],
} as unknown as YearView;

describe("office «к этому дню» basis (OWNER-13)", () => {
  it("the running month is compared with the same days a year ago, not the whole month", () => {
    expect(monthToDay(y2025, 10, 16)).toBe(15);
    expect(monthToDay(y2025, 10, 31)).toBe(55);
    expect(monthToDay(y2025, 9, 30)).toBeNull();
    expect(monthToDay(undefined, 10, 16)).toBeNull();
  });

  it("the total row uses the same cumulative-to-date as the KPI", () => {
    expect(sameDayValue(y2025, 289)).toBe(105);
    expect(sameDayValue(y2025, 400)).toBe(145);
  });
});
