/**
 * Small building blocks for routes that sit on slow upstreams (NASDAQ / SEC / Yahoo):
 *   singleFlight  concurrent callers of one key share one promise (seven widgets asking for the same day = one fetch);
 *   limiter       at most `n` tasks in flight, the rest queue (no burst of 30 parallel quote calls);
 *   swrState      fresh / stale / miss of a cached value by age — stale is answered at once while a refresh runs.
 * No network, no clock of its own (callers pass ages), so every rule here is unit-tested.
 */

/** Concurrent `run(key, fn)` calls share the first call's promise until it settles. */
export function singleFlight<K, V>() {
  const running = new Map<K, Promise<V>>();
  return {
    run(key: K, fn: () => Promise<V>): Promise<V> {
      const hit = running.get(key);
      if (hit) return hit;
      const p = (async () => fn())().finally(() => running.delete(key));
      running.set(key, p);
      return p;
    },
    has: (key: K): boolean => running.has(key),
    size: (): number => running.size,
  };
}

/** `limit(fn)` runs fn with at most `n` in flight; the rest wait in FIFO order. */
export function limiter(n: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => {
    if (active >= n) return;
    const go = queue.shift();
    if (go) { active++; go(); }
  };
  return function limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        fn().then(resolve, reject).finally(() => { active--; next(); });
      });
      next();
    });
  };
}

export type SwrState = "fresh" | "stale" | "miss";
/**
 * ageMs < freshMs → fresh (answer from cache); < staleMs → stale (answer from cache, refresh in the background);
 * otherwise / nothing cached → miss (the caller awaits the upstream).
 */
export function swrState(ageMs: number | null | undefined, freshMs: number, staleMs: number): SwrState {
  if (ageMs == null || !Number.isFinite(ageMs)) return "miss";
  if (ageMs < freshMs) return "fresh"; // a negative age (clock skew) counts as fresh
  return ageMs < staleMs ? "stale" : "miss";
}
