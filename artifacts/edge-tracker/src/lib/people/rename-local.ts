/**
 * Per-device storage that embeds the signed-in person's name, moved along when an admin renames them (the API
 * cascades the rename on the server, lib/people/renameUser; this is the browser's half). A successful sign-in returns
 * the person's earlier names (`formerNames`, from the «user.rename» audit entries); every key built from one of them
 * moves to the current name and remembered trader pickers follow. Idempotent: nothing is left to move the next time.
 *
 * Keep NAME_KEYS / NAME_VALUES in sync with the code that writes them (feed, journal drafts, trading defaults,
 * simple menu, share card, behavior / day-report / what-if trader pickers).
 */

/** Keys `<prefix><name>` or `<prefix><name>:<rest>`. */
const NAME_KEYS = [
  "ws-feed-state:", // components/feed/feed-utils
  "journal-day:v2:", // components/journal/use-journal-days (local drafts)
  "ws_lexx_trading_defaults:", // components/settings/trading-defaults
  "ws_lexx_nav_simple:", // components/shell/use-nav-prefs
  "ws_lexx.shareCard.prefs.", // components/trades/share-card/ShareCardDialog
] as const;

/** Keys whose value is a picked trader name (plain) or a JSON object with the name in `field`. */
const NAME_VALUES: readonly { key: string; field?: string }[] = [
  { key: "behavior.trader.v2" }, // pages/behavior
  { key: "dayReport.trader" }, // pages/day-report
  { key: "ws.simulator.prefs.v1", field: "trader" }, // pages/what-if
];

type KV = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

/** Move every name-keyed entry from `from` to `to` (an existing entry under the new name wins). Returns how many. */
export function moveNameKeys(storage: KV, from: string, to: string): number {
  if (!from || !to || from === to) return 0;
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k) keys.push(k);
  }
  let moved = 0;
  for (const k of keys) {
    const prefix = NAME_KEYS.find((p) => k === `${p}${from}` || k.startsWith(`${p}${from}:`));
    if (!prefix) continue;
    const next = `${prefix}${to}${k.slice(prefix.length + from.length)}`;
    const v = storage.getItem(k);
    if (v != null && storage.getItem(next) == null) storage.setItem(next, v);
    storage.removeItem(k);
    moved++;
  }
  for (const { key, field } of NAME_VALUES) {
    const v = storage.getItem(key);
    if (v == null) continue;
    if (!field) {
      if (v === from) { storage.setItem(key, to); moved++; }
      continue;
    }
    try {
      const obj = JSON.parse(v) as Record<string, unknown> | null;
      if (obj && typeof obj === "object" && obj[field] === from) { storage.setItem(key, JSON.stringify({ ...obj, [field]: to })); moved++; }
    } catch { /* not ours */ }
  }
  return moved;
}

/** After a sign-in: move this device's entries from each earlier name to the current one. Never throws. */
export function adoptFormerNames(formerNames: readonly unknown[] | undefined, name: string, storage: KV | null = typeof localStorage === "undefined" ? null : localStorage): number {
  if (!storage || !name || !Array.isArray(formerNames)) return 0;
  let moved = 0;
  for (const from of formerNames) {
    if (typeof from !== "string") continue;
    try { moved += moveNameKeys(storage, from, name); } catch { /* storage blocked */ }
  }
  return moved;
}
