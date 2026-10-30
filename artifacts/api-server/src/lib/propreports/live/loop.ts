/**
 * Live fills loop: in desk hours new PropReports fills reach the journal within seconds (PropReports has no push, so
 * "live" = fast polling). A setTimeout chain in the API process (not the minute-granular job cron), started next to
 * the job scheduler (index.ts, JOBS_ENABLED) and stopped with it on SIGTERM / SIGINT.
 *
 *   each turn   off (setting sync.liveEnabled), not configured (PROPREPORTS_DOMAIN / _TOKEN), outside the window
 *               (./policy inLiveWindow, trading days from lib/marketDays) → idle, look again in a minute
 *               a full tick runs in this process (tick/gate) → wait one interval
 *               else take the tick DB lease (tick/lease TICK_LEASE: never alongside the full sync or another process's
 *               cycle) → ./cycle runLiveCycle → release
 *   cadence     ./policy: as fast as 60 % of the vendor limit allows for the calls spent (≥ 2 s, ≥ the owner's cap);
 *               errors back off exponentially (429 / 503 one step more), up to 5 minutes
 *   event       "propreports.synced" (listener jobs: contract alerts, leak guard, readiness, evening cards) is enqueued in
 *               the outbox at most once per SYNCED_EVERY_MS with the traders collected since — the trades themselves
 *               and their per-trader effects are written at once by applySync
 *   risk        the one listener that cannot wait a minute: a cycle that wrote trades kicks the risk signals scan for
 *               exactly its changed traders in this process (lib/riskSignals/live.ts — non-blocking, single-flight per
 *               trader, errors isolated), so an alert follows the fill within seconds. The coalesced event and the
 *               job's every-minute run stay as the fallback.
 */
import { randomUUID } from "node:crypto";
import { logger } from "../../logger";
import { setting } from "../../settings/registry";
import { nyDate, nyMinutes } from "../../tradingDate";
import { sessionFor } from "../../marketDays";
import { createTickClient, isConfigured, PropReportsError } from "../client";
import { acquireLease, releaseLease, TICK_LEASE } from "../tick/lease";
import { enqueueOutbox } from "../tick/outbox";
import { tickHeld, trackLiveCycle } from "../tick/gate";
import { kickRiskSignals, riskSignalKicksIdle } from "../../riskSignals/live";
import { runLiveCycle, type LiveCycleResult } from "./cycle";
import { inLiveWindow, liveBackoffMs, liveIntervalMs, LIVE_IDLE_MS } from "./policy";

/** One cycle's own budget (its HTTP calls are cut at this deadline); the lease outlives it by LEASE_EXTRA_S. */
export const LIVE_CYCLE_BUDGET_MS = 15_000;
const LEASE_EXTRA_S = 15;
export const SYNCED_EVERY_MS = 60_000;

export type LiveGate = { run: true } | { run: false; reason: "off" | "not-configured" | "closed" | "tick"; waitMs?: number };

export type LiveLoopDeps = {
  now: () => Date;
  /** Should a cycle run now? */
  gate: (now: Date) => Promise<LiveGate>;
  /** One cycle under the lease; null = the lease is held elsewhere (a full tick / another process). */
  cycle: (now: Date) => Promise<LiveCycleResult | null>;
  /** The owner's speed cap, seconds (setting sync.liveMinIntervalSec). */
  capSec: () => number;
  /** Enqueue the coalesced "propreports.synced" event. */
  emitSynced: (traders: string[]) => Promise<void>;
  /** Start the risk signals scan of these traders now, in the background (must not block; may throw — isolated). */
  scanTraders?: (traders: string[]) => void;
};

export type LiveStatus = {
  running: boolean;
  /** The last gate decision: true = cycles are running (desk hours, on, configured). */
  active: boolean;
  reason: string | null;
  intervalMs: number | null;
  failures: number;
  lastCycleAt: string | null;
  lastWriteAt: string | null;
  lastNote: string | null;
  lastError: string | null;
  lastRequests: number;
  lagSec: number | null;
};

async function defaultGate(now: Date): Promise<LiveGate> {
  if (!setting("sync.liveEnabled")) return { run: false, reason: "off" };
  if (!isConfigured()) return { run: false, reason: "not-configured" };
  const session = await sessionFor(nyDate(now));
  if (!inLiveWindow(nyMinutes(now), session)) return { run: false, reason: "closed" };
  if (tickHeld()) return { run: false, reason: "tick", waitMs: 2_000 };
  return { run: true };
}

async function defaultCycle(now: Date): Promise<LiveCycleResult | null> {
  const t0 = Date.now();
  const deadline = t0 + LIVE_CYCLE_BUDGET_MS;
  const holder = `live:${randomUUID()}`;
  if (!(await acquireLease(TICK_LEASE, holder, Math.ceil(LIVE_CYCLE_BUDGET_MS / 1000) + LEASE_EXTRA_S))) return null;
  try {
    const client = await createTickClient({ deadline });
    if (!client) return null;
    return await runLiveCycle({ now, deadline, client, log: logger });
  } finally {
    await releaseLease(TICK_LEASE, holder).catch(() => {});
  }
}

export const defaultLoopDeps: LiveLoopDeps = {
  now: () => new Date(),
  gate: defaultGate,
  cycle: defaultCycle,
  capSec: () => setting("sync.liveMinIntervalSec"),
  emitSynced: (traders) => enqueueOutbox("propreports.synced", { source: "live", changed: true, traders }),
  scanTraders: (traders) => kickRiskSignals(traders),
};

export class LiveLoop {
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;
  private stopped = true;
  private pendingTraders = new Set<string>();
  private lastEmitAt = 0;
  readonly status: LiveStatus = { running: false, active: false, reason: null, intervalMs: null, failures: 0, lastCycleAt: null, lastWriteAt: null, lastNote: null, lastError: null, lastRequests: 0, lagSec: null };

  constructor(private readonly deps: LiveLoopDeps = defaultLoopDeps) {}

  start(firstDelayMs = 5_000): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.status.running = true;
    this.schedule(firstDelayMs);
  }

  /** No new cycles; waits (≤ waitMs) for the one in flight, then enqueues the collected "synced" event. */
  async stop(waitMs = 10_000): Promise<void> {
    this.stopped = true;
    this.status.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.inFlight) {
      let t: NodeJS.Timeout | undefined;
      await Promise.race([this.inFlight.catch(() => undefined), new Promise<void>((r) => { t = setTimeout(r, waitMs); })]);
      if (t) clearTimeout(t);
    }
    await this.flushSynced(true);
  }

  private schedule(ms: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.inFlight = trackLiveCycle(this.turn()).finally(() => { this.inFlight = null; });
    }, ms);
    this.timer.unref?.();
  }

  /** One turn: gate → cycle → next delay. Never throws. */
  private async turn(): Promise<void> {
    let next = LIVE_IDLE_MS;
    try {
      const now = this.deps.now();
      const g = await this.deps.gate(now);
      this.status.active = g.run || g.reason === "tick";
      this.status.reason = g.run ? null : g.reason;
      if (!g.run) {
        next = g.waitMs ?? LIVE_IDLE_MS;
        if (g.reason !== "tick") this.status.failures = 0;
      } else {
        next = await this.cycleOnce(now);
      }
      await this.flushSynced(false);
    } catch (e) {
      logger.warn({ err: e instanceof Error ? e.message : String(e) }, "propreports live: turn failed");
    }
    this.status.intervalMs = next;
    this.schedule(next);
  }

  private async cycleOnce(now: Date): Promise<number> {
    const base = liveIntervalMs(this.status.lastRequests || 1, this.deps.capSec());
    try {
      const r = await this.deps.cycle(now);
      this.status.lastCycleAt = now.toISOString();
      if (!r) {
        this.status.lastNote = "lease held by the full sync";
        return base;
      }
      this.status.failures = 0;
      this.status.lastError = null;
      this.status.lastNote = r.note;
      this.status.lastRequests = r.requests;
      if (r.lagSec != null) this.status.lagSec = r.lagSec;
      if (r.inserted + r.updated > 0) {
        this.status.lastWriteAt = now.toISOString();
        for (const t of r.traders) this.pendingTraders.add(t);
        this.kickScan(r.traders);
        logger.info({ inserted: r.inserted, updated: r.updated, lagSec: r.lagSec, requests: r.requests }, "propreports live: trades written");
      }
      return liveIntervalMs(r.requests, this.deps.capSec());
    } catch (e) {
      this.status.failures++;
      this.status.lastError = e instanceof Error ? e.message : String(e);
      const rateLimited = e instanceof PropReportsError && (e.kind === "rateLimited" || e.kind === "unavailable");
      const wait = liveBackoffMs(base, this.status.failures, rateLimited);
      logger.warn({ err: this.status.lastError, failures: this.status.failures, waitMs: wait }, "propreports live: cycle failed");
      return wait;
    }
  }

  /** The direct risk path: never awaited, never allowed to fail the cycle. */
  private kickScan(traders: string[]): void {
    if (!traders.length || !this.deps.scanTraders) return;
    try {
      this.deps.scanTraders(traders);
    } catch (e) {
      logger.warn({ err: e instanceof Error ? e.message : String(e) }, "propreports live: could not start the risk signals scan");
    }
  }

  private async flushSynced(force: boolean): Promise<void> {
    if (!this.pendingTraders.size) return;
    const now = Date.now();
    if (!force && now - this.lastEmitAt < SYNCED_EVERY_MS) return;
    const traders = [...this.pendingTraders].sort();
    try {
      await this.deps.emitSynced(traders);
      this.pendingTraders.clear();
      this.lastEmitAt = now;
    } catch (e) {
      logger.warn({ err: e instanceof Error ? e.message : String(e) }, "propreports live: could not enqueue the synced event");
    }
  }
}

let loop: LiveLoop | null = null;

/** Start the process-wide loop (index.ts, only with JOBS_ENABLED). Idempotent. */
export function startLiveSync(): void {
  if (!loop) loop = new LiveLoop();
  loop.start();
}

export async function stopLiveSync(waitMs?: number): Promise<void> {
  await loop?.stop(waitMs);
  await riskSignalKicksIdle(3_000);
}

/** Status for GET /api/propreports/live (null = the loop does not run in this process). */
export function liveSyncStatus(): LiveStatus | null {
  return loop ? { ...loop.status } : null;
}
