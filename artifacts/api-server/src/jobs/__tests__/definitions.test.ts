/**
 * Wave 1 — the job list: the old digest is gone (1.16: no digest.morning / digest.evening), and candles.archive runs
 * the setup auto-classifier after the archive fill (1.2: suggestions for new broker trades after each sync).
 */
import { describe, it, expect, vi, beforeAll } from "vitest";

vi.mock("@workspace/db", () => ({ db: {}, pool: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) } }));
const archive = vi.hoisted(() => ({ runArchiveFill: vi.fn(async () => ({ stoppedBy: "done", filled: 3 })) }));
const auto = vi.hoisted(() => ({ runAutoClassify: vi.fn(async () => ({ candidates: 4, computed: 4 })) }));
vi.mock("../../lib/candleArchive", () => archive);
vi.mock("../../lib/setupsAuto", () => auto);

process.env.JWT_SECRET ??= "vitest-only-secret";
const { registerAllJobs } = await import("../definitions");
const { listJobs } = await import("../registry");

beforeAll(() => registerAllJobs());

describe("job definitions", () => {
  it("the old digest jobs are removed", () => {
    const names = listJobs().map((j) => j.name);
    expect(names.length).toBeGreaterThan(10);
    expect(names.filter((n) => n.startsWith("digest."))).toEqual([]);
    expect(names).toContain("telegram.daily-morning"); // the daily loop that replaced it stays
  });

  it("whatif.honesty is registered through registerModuleJobs: on request and after every sync", () => {
    const job = listJobs().find((j) => j.name === "whatif.honesty");
    expect(job?.on).toEqual(["whatif.honesty.requested", "propreports.synced"]);
    expect(job?.cron).toBe("*/2 * * * *");
  });

  it("candles.archive runs on every PropReports sync and then classifies setups of the new trades", async () => {
    const job = listJobs().find((j) => j.name === "candles.archive")!;
    expect(job.on).toContain("propreports.synced");
    const signal = new AbortController().signal;
    const out = await job.run({ signal, trigger: "event", logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, runId: 1 });
    expect(archive.runArchiveFill).toHaveBeenCalledOnce();
    expect(auto.runAutoClassify).toHaveBeenCalledWith({ signal });
    expect(out).toEqual({ archive: { stoppedBy: "done", filled: 3 }, setups: { candidates: 4, computed: 4 } });
  });

  it("a classifier failure does not fail the archive run", async () => {
    auto.runAutoClassify.mockRejectedValueOnce(new Error("candles down"));
    const job = listJobs().find((j) => j.name === "candles.archive")!;
    const out = await job.run({ signal: new AbortController().signal, trigger: "schedule", logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, runId: 2 });
    expect(out).toMatchObject({ setups: { error: "candles down" } });
  });
});
