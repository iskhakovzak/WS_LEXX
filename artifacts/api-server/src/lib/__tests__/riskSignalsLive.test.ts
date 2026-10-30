/**
 * The live fills loop → risk signals direct path (lib/riskSignals/live.ts LiveScanKicker): non-blocking, single-flight
 * per trader with one catch-up run, errors isolated. The scan is a fake — no Postgres.
 */
import { describe, expect, it, vi } from "vitest";
import { LiveScanKicker } from "../riskSignals/live";

function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("live risk scan kicker", () => {
  it("kick returns at once; a trader already being scanned gets ONE more scan right after, others start now", async () => {
    const gates: Array<ReturnType<typeof deferred>> = [];
    const run = vi.fn((_traders: string[]) => { const d = deferred(); gates.push(d); return d.promise; });
    const k = new LiveScanKicker(run, { warn: vi.fn() } as any);

    k.kick(["Anna", "Boris", "Anna", ""]);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]![0]).toEqual(["Anna", "Boris"]);
    expect(k.busy).toBe(2);

    // Three more cycles write Anna while her scan runs; Vera is new → scanned at once, alone.
    k.kick(["Anna"]);
    k.kick(["Anna", "Vera"]);
    k.kick(["Anna"]);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1]![0]).toEqual(["Vera"]);

    gates[0]!.resolve();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(3));
    expect(run.mock.calls[2]![0]).toEqual(["Anna"]); // one catch-up for the burst, Boris is not re-run
    gates[1]!.resolve();
    gates[2]!.resolve();
    await k.idle();
    expect(run).toHaveBeenCalledTimes(3);
    expect(k.busy).toBe(0);
  });

  it("a failing scan (sync throw or rejection) is logged and the trader can be scanned again", async () => {
    const warn = vi.fn();
    let n = 0;
    const run = vi.fn(async () => {
      n++;
      if (n === 1) throw new Error("db down");
      if (n === 2) return Promise.reject(new Error("timeout"));
      return undefined;
    });
    const k = new LiveScanKicker(run, { warn } as any);
    k.kick(["Anna"]);
    await k.idle();
    k.kick(["Anna"]);
    await k.idle();
    k.kick(["Anna"]);
    await k.idle();
    expect(run).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(k.busy).toBe(0);

    const syncThrow = new LiveScanKicker(() => { throw new Error("boom"); }, { warn } as any);
    expect(() => syncThrow.kick(["Boris"])).not.toThrow();
    await syncThrow.idle();
    expect(warn).toHaveBeenCalledTimes(3);
  });
});
