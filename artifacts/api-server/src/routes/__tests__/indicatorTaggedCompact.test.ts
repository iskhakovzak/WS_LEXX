import { describe, expect, it } from "vitest";
import { encodeTaggedCompact } from "../indicator-notes";

describe("/indicators/tagged-trades?enc=2 (DEV-10)", () => {
  it("codes dates as dictionary indexes and ids as deltas, keeps every other column", () => {
    const c = encodeTaggedCompact({ n: 3, id: [7, 9, 15], date: ["2026-10-01", "2026-10-02", "2026-10-01"], r: [1, null, 2] });
    expect(c).toEqual({ n: 3, r: [1, null, 2], enc: 2, idDelta: [7, 2, 6], dates: ["2026-10-01", "2026-10-02"], date: [0, 1, 0] });
  });
});
