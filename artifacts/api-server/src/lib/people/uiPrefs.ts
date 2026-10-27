/**
 * `users.settings.prefs` — small personal things a person keeps across devices that used to live only in one browser's
 * localStorage (persistence audit, docs/persistence/AUDIT.md): saved trade / analyst views, note templates, quick
 * replies, feed bookmarks, pinned questions, the Big 7 hot list…
 *
 * PUT /users/me/settings { prefs: { "<key>": <json> | null } } merges PER KEY (other keys stay; null removes one), so
 * two screens never overwrite each other's prefs. Keys are short identifiers; the whole block is bounded.
 */
import { z } from "zod";

export const PREF_KEY_RE = /^[a-zA-Z][\w.-]{0,63}$/;
const MAX_KEYS = 60;
/** One value's JSON size limit and the whole block's. */
export const MAX_PREF_BYTES = 32 * 1024;
export const MAX_PREFS_BYTES = 128 * 1024;

export const PrefsPatchSchema = z
  .record(z.string().regex(PREF_KEY_RE), z.unknown())
  .refine((m) => Object.keys(m).length <= MAX_KEYS, { message: "too many prefs" })
  .refine((m) => Object.values(m).every((v) => v === undefined || JSON.stringify(v).length <= MAX_PREF_BYTES), { message: "pref too large" });

/** The patch split into keys to set and keys to remove. */
export function splitPrefsPatch(patch: Record<string, unknown>): { set: Record<string, unknown>; drop: string[] } {
  const set: Record<string, unknown> = {};
  const drop: string[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (v === null) drop.push(k);
    else set[k] = v;
  }
  return { set, drop };
}

/**
 * SQL expression for the new `settings` value with the prefs patch applied ($n = set jsonb, $m = drop text[]):
 * the other top-level keys are untouched.
 */
export function prefsMergeSql(setParam: string, dropParam: string): string {
  return `jsonb_set(COALESCE(settings, '{}'::jsonb), '{prefs}', (COALESCE(settings->'prefs', '{}'::jsonb) - ${dropParam}::text[]) || ${setParam}::jsonb, true)`;
}
