/**
 * Sliding-window limiter for the PropReports API: at most 40 requests per 4 s per host (vendor limit, ~600/min).
 * One limiter per host is shared by every client instance in the process (the tick builds a fresh client per run,
 * a curator can sync at the same time), so two callers never add up past the limit.
 */

export const PROPREPORTS_RATE = { max: 40, windowMs: 4000 } as const;

export class SlidingWindowLimiter {
  private readonly stamps: number[] = [];
  /** Serialises waiters so concurrent callers get slots in call order. */
  private chain: Promise<void> = Promise.resolve();

  constructor(
    readonly max: number,
    readonly windowMs: number,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  /** ms until a slot frees up (0 = a request may go now). */
  waitTime(): number {
    const t = this.now();
    while (this.stamps.length && this.stamps[0] <= t - this.windowMs) this.stamps.shift();
    if (this.stamps.length < this.max) return 0;
    return this.stamps[0] + this.windowMs - t;
  }

  /** Resolves when the caller may send; records the send. */
  acquire(): Promise<void> {
    const next = this.chain.then(async () => {
      for (let w = this.waitTime(); w > 0; w = this.waitTime()) await this.sleep(w);
      this.stamps.push(this.now());
    });
    this.chain = next.catch(() => {});
    return next;
  }

  /** Requests counted in the current window (diagnostics). */
  get inWindow(): number {
    this.waitTime();
    return this.stamps.length;
  }
}

const byHost = new Map<string, SlidingWindowLimiter>();

export function limiterFor(host: string): SlidingWindowLimiter {
  let l = byHost.get(host);
  if (!l) {
    l = new SlidingWindowLimiter(PROPREPORTS_RATE.max, PROPREPORTS_RATE.windowMs);
    byHost.set(host, l);
  }
  return l;
}
