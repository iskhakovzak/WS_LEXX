/**
 * Short per-user cache of GET /api/trainer/home (lib/trainer/home.ts), in a module without dependencies so that the
 * sim routes (a game ended) and the trainer routes (a drill answered, a daily game started) can drop it.
 */
export const homeCache = new Map<number, { at: number; value: unknown }>();
export const HOME_TTL_MS = 30_000;

export function forgetTrainerHome(userId: number | null | undefined): void {
  if (userId != null) homeCache.delete(userId);
}

/** Every user's cached home (the daily pick changed). */
export function forgetAllTrainerHomes(): void {
  homeCache.clear();
}
