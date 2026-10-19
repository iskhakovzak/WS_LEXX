import { describe, expect, it } from "vitest";
import type { Trade } from "@workspace/api-client-react";
import { timeBucketFor } from "./analytics-pro";

const tr = (p: Partial<Trade> & { contextSnapshot?: unknown }): Trade => ({ id: 1, ticker: "AAPL", ...p }) as unknown as Trade;

describe("timeBucketFor (MAKSIM-14)", () => {
  it("reads the time of a timed date", () => {
    expect(timeBucketFor(tr({ date: "2026-10-16T09:35:00" }))).toBe("9:30-9:50");
  });
  it("reads the broker openedAt when the date is a bare day (PropReports)", () => {
    expect(timeBucketFor(tr({ date: "2026-10-16", contextSnapshot: { source: "propreports", openedAt: "2026-10-16T10:20:05" } }))).toBe("10:10-11:15");
  });
  it("is unknown without any time", () => {
    expect(timeBucketFor(tr({ date: "2026-10-16" }))).toBe("unknown");
  });
});
