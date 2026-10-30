/**
 * In-process coordination of the full tick (tick/runner.ts) and the live fills loop (lib/propreports/live). Both also
 * take the same DB lease (tick/lease.ts TICK_LEASE), which keeps other processes out; this gate only makes sure that in
 * THIS process the full tick never loses its lease to a live cycle that happens to be running:
 *
 *   withTickHold(fn)   the tick waits for the live cycle in flight (≤ LIVE_WAIT_MS), and no new live cycle starts
 *                      until fn settles
 *   tickHeld()         the live loop skips its cycle while a tick runs here
 *   trackLiveCycle(p)  the live loop registers its cycle promise
 */

/** A live cycle is bounded by its own deadline; the tick never waits longer than this for it. */
export const LIVE_WAIT_MS = 25_000;

let holds = 0;
let liveCycle: Promise<unknown> | null = null;

export function tickHeld(): boolean {
  return holds > 0;
}

export function trackLiveCycle<T>(p: Promise<T>): Promise<T> {
  liveCycle = p;
  const clear = () => { if (liveCycle === p) liveCycle = null; };
  p.then(clear, clear);
  return p;
}

export async function withTickHold<T>(fn: () => Promise<T>, waitMs = LIVE_WAIT_MS): Promise<T> {
  holds++;
  try {
    const running = liveCycle;
    if (running) {
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([running.catch(() => undefined), new Promise<void>((r) => { timer = setTimeout(r, waitMs); timer.unref?.(); })]);
      if (timer) clearTimeout(timer);
    }
    return await fn();
  } finally {
    holds--;
  }
}
