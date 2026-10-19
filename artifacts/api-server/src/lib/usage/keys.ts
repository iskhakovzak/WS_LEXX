/**
 * Usage tracking — the allow-list of what may be stored (pure; routes/usage.ts uses it, tests cover it). The web
 * tracker (artifacts/edge-tracker/src/lib/usage.ts) normalises the same way; the server never trusts it and
 * normalises again, then drops whatever still does not fit.
 *
 *   view    a route PATTERN: path segments that are ids / dates / tickers / names become :id / :date / :ticker /
 *           :param; at most 4 segments; only the ?tab= and ?mode= query values survive (short lower-case slugs).
 *           "/trades/1234?trader=Кирилл Б.&tab=notes" → "/trades/:id?tab=notes"
 *   action  one of ACTION_KEYS; meta only from META_RULES of that key (else dropped), never free text.
 *
 * Nothing here can carry a person's name, a ticker or an amount into usage_events.
 */

export const ACTION_KEYS = [
  "playbook.today",    // playbook «Сегодня» opened
  "playbook.picks",    // «Сегодня торгую» picks saved
  "playbook.cheat",    // a setup's cheat sheet opened (meta.code = the setup display code)
  "playbook.tagging",  // «Разметить сделки» sheet opened
  "plan.save",         // personal plan of the day saved
  "daily.review",      // evening card reviewed («Разобрал»)
  "daily.dispute",     // evening card disputed («Это не ошибка»)
  "trainer.start",     // a trainer mode started (meta.mode)
  "quests.tab",        // Рейтинги → Квесты opened
  "season.tab",        // Рейтинги → Сезон opened
] as const;
export type ActionKey = (typeof ACTION_KEYS)[number];

export const TRAINER_MODES = ["daily", "find_entry", "my_days", "free"] as const;

const ACTION_SET = new Set<string>(ACTION_KEYS);
export const isActionKey = (k: string): k is ActionKey => ACTION_SET.has(k);

/** Per action: allowed meta fields and their value check. */
const META_RULES: Partial<Record<ActionKey, Record<string, (v: unknown) => boolean>>> = {
  "playbook.cheat": { code: (v) => typeof v === "string" && /^[0-9A-Za-z.]{1,8}$/.test(v) },
  "trainer.start": { mode: (v) => typeof v === "string" && (TRAINER_MODES as readonly string[]).includes(v) },
};

const SLUG_RE = /^[a-z][a-z0-9_-]{0,23}$/;
const SEGMENT_RE = /^[a-z][a-z0-9-]{0,39}$/;
const PLACEHOLDERS = new Set([":id", ":date", ":ticker", ":param"]);
const KEPT_QUERY = ["tab", "mode"] as const;
export const MAX_SEGMENTS = 4;
export const MAX_KEY_LENGTH = 120;

function safeDecode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

/** One path segment → itself (a lower-case route word) or a placeholder. */
export function normaliseSegment(raw: string): string {
  const s = safeDecode(raw);
  if (PLACEHOLDERS.has(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return ":date";
  if (/^\d+$/.test(s) || /^[0-9a-f]{8,}(-[0-9a-f]{4,})*$/i.test(s)) return ":id";
  if (/^[A-Z]{1,5}([.-][A-Z]{1,2})?$/.test(s)) return ":ticker";
  if (SEGMENT_RE.test(s)) return s;
  return ":param";
}

/**
 * A route (path + optional search) → its pattern key, or null when nothing usable is left. Idempotent: a normalised
 * key normalises to itself (the server re-runs it on what the browser sent).
 */
export function normaliseView(path: string, search = ""): string | null {
  if (typeof path !== "string" || typeof search !== "string") return null;
  let p = path;
  let q = search;
  const qi = p.indexOf("?");
  if (qi >= 0) { q = q || p.slice(qi); p = p.slice(0, qi); }
  const hi = p.indexOf("#");
  if (hi >= 0) p = p.slice(0, hi);
  if (!p.startsWith("/")) return null;
  const segments = p.split("/").filter(Boolean).slice(0, MAX_SEGMENTS).map(normaliseSegment);
  let key = `/${segments.join("/")}`;
  const params = new URLSearchParams(q.startsWith("?") ? q.slice(1) : q);
  const kept: string[] = [];
  for (const name of KEPT_QUERY) {
    const v = params.get(name);
    if (v && SLUG_RE.test(v)) kept.push(`${name}=${v}`);
  }
  if (kept.length) key += `?${kept.join("&")}`;
  return key.length <= MAX_KEY_LENGTH ? key : null;
}

export type UsageKind = "view" | "action";
export type CleanEvent = { kind: UsageKind; key: string; at: Date; meta: Record<string, string | number | boolean> | null };

/** Client clock is trusted within this window (batches are ≤ ~15 s old; a tab woken after sleep may be older). */
const MAX_PAST_MS = 30 * 60_000;
const MAX_FUTURE_MS = 60_000;

function cleanMeta(key: ActionKey, meta: unknown): CleanEvent["meta"] {
  const rules = META_RULES[key];
  if (!rules || !meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const out: Record<string, string | number | boolean> = {};
  for (const [field, ok] of Object.entries(rules)) {
    const v = (meta as Record<string, unknown>)[field];
    if (v !== undefined && ok(v)) out[field] = v as string;
  }
  return Object.keys(out).length ? out : null;
}

/** One raw event from the browser → a storable event, or null (dropped). */
export function cleanEvent(raw: unknown, now: Date): CleanEvent | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as { kind?: unknown; key?: unknown; t?: unknown; meta?: unknown };
  if (typeof r.key !== "string" || r.key.length > 300) return null;
  const nowMs = now.getTime();
  const t = typeof r.t === "number" && Number.isFinite(r.t) && r.t >= nowMs - MAX_PAST_MS && r.t <= nowMs + MAX_FUTURE_MS ? Math.min(r.t, nowMs) : nowMs;
  const at = new Date(t);
  if (r.kind === "view") {
    const key = normaliseView(r.key);
    return key ? { kind: "view", key, at, meta: null } : null;
  }
  if (r.kind === "action" && isActionKey(r.key)) return { kind: "action", key: r.key, at, meta: cleanMeta(r.key, r.meta) };
  return null;
}

/** A batch → the events to store (in order) and how many were dropped. */
export function cleanBatch(events: readonly unknown[], now: Date = new Date()): { events: CleanEvent[]; dropped: number } {
  const out: CleanEvent[] = [];
  for (const e of events) {
    const c = cleanEvent(e, now);
    if (c) out.push(c);
  }
  return { events: out, dropped: events.length - out.length };
}
