import { describe, expect, it } from "vitest";
import { addBusinessDays, marketDay } from "./types";

// ROMAN-04: on a weekend /offerings opens on the next session (Monday), not on the past Friday.
describe("marketDay", () => {
  it("weekday → that day; Saturday / Sunday → Monday", () => {
    expect(marketDay("2026-10-16")).toBe("2026-10-16"); // Fri
    expect(marketDay("2026-10-17")).toBe("2026-10-19"); // Sat
    expect(marketDay("2026-10-18")).toBe("2026-10-19"); // Sun
    expect(marketDay("2026-10-19")).toBe("2026-10-19"); // Mon
  });

  it("the week strip before a weekend default still ends on Monday and walks back over the weekend", () => {
    expect(addBusinessDays(marketDay("2026-10-18"), -1)).toBe("2026-10-16");
  });
});
