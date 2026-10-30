/**
 * The direct path from the live fills loop (lib/propreports/live/loop.ts) to the risk signals scan: a cycle that wrote
 * trades hands its changed traders here, and their scan starts at once in this process — no outbox hop, no coalescing.
 * An opening fill is written by the cycle as an open trade (round-trips result "open"), so the entry-time signals
 * (revenge / off-plan / restricted window) are judged seconds after the fill, not when the trade closes.
 *
 *   non-blocking   kick() returns at once; the loop never waits for a scan
 *   single-flight  one scan per trader at a time; a kick for a trader whose scan is running marks it, and ONE more scan
 *                  runs right after (it sees everything written meanwhile) — a burst of cycles costs ≤ 2 scans
 *   isolated       a failed scan is logged and forgotten: the every-minute job run (risksignals.scan cron) and the
 *                  coalesced «propreports.synced» event remain the fallback; dedup (UNIQUE trader / day / signal /
 *                  level + claimStaffNotice) makes concurrent runs safe
 *
 * The heavy scan module is imported on the first kick only.
 */
import { logger } from "../logger";

export type ScanRun = (traders: string[]) => Promise<unknown>;
type Log = Pick<typeof logger, "warn">;

export class LiveScanKicker {
  private readonly running = new Set<string>();
  private readonly again = new Set<string>();
  private readonly inFlight = new Set<Promise<void>>();

  constructor(private readonly run: ScanRun, private readonly log: Log = logger) {}

  /** Scan these traders now (the ones already being scanned: once more right after). Never throws, never waits. */
  kick(traders: readonly string[]): void {
    const fresh: string[] = [];
    for (const t of new Set(traders)) {
      if (!t) continue;
      if (this.running.has(t)) this.again.add(t);
      else fresh.push(t);
    }
    if (fresh.length) this.launch(fresh);
  }

  /** Traders with a scan in flight (tests / status). */
  get busy(): number {
    return this.running.size;
  }

  /** Resolves when no scan is in flight (including the re-runs they schedule). */
  async idle(): Promise<void> {
    while (this.inFlight.size) await Promise.allSettled([...this.inFlight]);
  }

  private launch(traders: string[]): void {
    for (const t of traders) this.running.add(t);
    const p = (async () => {
      try {
        await this.run(traders);
      } catch (e) {
        this.log.warn({ err: e instanceof Error ? e.message : String(e), traders }, "risk signals: live scan failed");
      } finally {
        for (const t of traders) this.running.delete(t);
        const next = traders.filter((t) => this.again.delete(t));
        if (next.length) this.kick(next);
      }
    })();
    this.inFlight.add(p);
    void p.finally(() => this.inFlight.delete(p));
  }
}

let kicker: LiveScanKicker | null = null;

function processKicker(): LiveScanKicker {
  kicker ??= new LiveScanKicker(async (traders) => {
    const { scanTradersNow } = await import("./scan");
    return scanTradersNow(traders);
  });
  return kicker;
}

/** The live loop's hook: scan these traders' risk signals now, in the background. */
export function kickRiskSignals(traders: readonly string[]): void {
  processKicker().kick(traders);
}

/** Shutdown: wait (≤ waitMs) for the scans in flight. */
export async function riskSignalKicksIdle(waitMs = 5_000): Promise<void> {
  if (!kicker) return;
  let t: NodeJS.Timeout | undefined;
  await Promise.race([kicker.idle(), new Promise<void>((r) => { t = setTimeout(r, waitMs); })]);
  if (t) clearTimeout(t);
}
