import { describe, expect, it } from "vitest";
import type { TodayPayload } from "@/components/curator/api";
import { shellQueueCounts } from "./use-shell-badges";

const counts = (c: Partial<TodayPayload["counts"]>) => ({ counts: { queue: 0, queueOverdue: 0, ...c } as TodayPayload["counts"] });

describe("curator sidebar badge", () => {
  it("equals the cabinet «Ждёт разбора» KPI (reviews / reviewsOverdue)", () => {
    expect(shellQueueCounts(counts({ queue: 9, queueOverdue: 4, reviews: 3, reviewsOverdue: 1 }))).toEqual({ queue: 3, overdue: 1 });
    expect(shellQueueCounts(counts({ queue: 9, queueOverdue: 4, reviews: 0, reviewsOverdue: 0 }))).toEqual({ queue: 0, overdue: 0 });
  });
  it("falls back to the queue counts on an older server; no payload → null", () => {
    expect(shellQueueCounts(counts({ queue: 5, queueOverdue: 2 }))).toEqual({ queue: 5, overdue: 2 });
    expect(shellQueueCounts(null)).toBeNull();
  });
});
