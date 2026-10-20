/**
 * lib/newsChannel jobs — the retry outcome: a scheduled «open» / «close» run that ends retryable plans the next try
 * 5 min later (the cron getter answers it) until the cutoff; a sent / dup run drops it; manual runs never plan one.
 * The publisher is mocked: no DB, no network.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JobContext, JobDef } from "../../../jobs/registry";

vi.mock("@workspace/db", () => ({ db: {}, pool: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) } }));
const publishNewsPost = vi.fn();
vi.mock("../../newsChannel/publish", () => ({ publishNewsPost }));

const { registerNewsChannelJobs } = await import("../../newsChannel/jobDefs");
const schedule = await import("../../newsChannel/schedule");
const F = await import("./fixtures");

function jobs(): Map<string, JobDef> {
  const out = new Map<string, JobDef>();
  registerNewsChannelJobs((d) => out.set(d.name, d));
  return out;
}
const ctx = (trigger: JobContext["trigger"]): JobContext => ({
  trigger, signal: new AbortController().signal, runId: 1, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
});

afterEach(() => {
  vi.useRealTimers();
  schedule.resetRetries();
  publishNewsPost.mockReset();
});

describe("news-channel job retries", () => {
  it("skipped as stale at 10:00 ⇒ retryAt 10:05 and the cron moves there; sent at 10:05 ⇒ back to the post's time", async () => {
    vi.useFakeTimers({ now: F.ny(10), toFake: ["Date"] });
    const open = jobs().get(schedule.NEWS_JOBS.open)!;
    publishNewsPost.mockResolvedValueOnce({ post: "open", date: F.DAY, status: "skipped", reason: "stale: x", retryable: true });
    expect(await open.run(ctx("schedule"))).toMatchObject({ status: "skipped", retryAt: "10:05" });
    expect((open.cron as () => string)()).toBe("5 10 * * 1-5");

    vi.setSystemTime(F.ny(10, 5));
    publishNewsPost.mockResolvedValueOnce({ post: "open", date: F.DAY, status: "sent" });
    expect(await open.run(ctx("schedule"))).toEqual({ post: "open", date: F.DAY, status: "sent" });
    expect((open.cron as () => string)()).toBe("0 10 * * 1-5");
  });

  it("no retry past the cutoff, none for a manual run; a run that throws is retried", async () => {
    vi.useFakeTimers({ now: F.ny(18, 58), toFake: ["Date"] });
    const close = jobs().get(schedule.NEWS_JOBS.close)!;
    publishNewsPost.mockResolvedValue({ post: "close", date: F.DAY, status: "failed", reason: "status 502", retryable: true });
    expect(await close.run(ctx("schedule"))).not.toHaveProperty("retryAt"); // 19:03 > 19:00
    vi.setSystemTime(F.ny(16, 15));
    expect(await close.run(ctx("manual"))).not.toHaveProperty("retryAt");
    expect(schedule.retryMinutes("close", F.ny(16, 15))).toBeNull();
    publishNewsPost.mockRejectedValueOnce(new Error("db down"));
    await expect(close.run(ctx("schedule"))).rejects.toThrow("db down");
    expect((close.cron as () => string)()).toBe("20 16 * * 1-5");
  });
});
