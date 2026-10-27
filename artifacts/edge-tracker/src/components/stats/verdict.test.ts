import { describe, expect, it } from "vitest";
import { verdictParts } from "./verdict";

describe("/stats verdict line", () => {
  it("a percentage only between two positive totals; otherwise the difference; level within a dollar", () => {
    expect(verdictParts({ net: 1230, prev: 1000, metric: "net" })).toMatchObject({ kind: "pct", better: true, pct: 0.23 });
    expect(verdictParts({ net: -594, prev: 527, metric: "net" })).toMatchObject({ kind: "abs", better: false, delta: -1121 });
    expect(verdictParts({ net: 100.4, prev: 100, metric: "net" })).toMatchObject({ kind: "same" });
    expect(verdictParts({ net: null, prev: 5, metric: "r" })).toBeNull();
  });
});
