/**
 * Internal usage tracker (POST /api/usage/batch → our own DB; admin console → «Использование»). No third-party
 * analytics, no cookies, nothing leaves our server. Staff-only view, never used for rewards or rankings.
 *
 *   trackView(path, search)      a route change (components/shared/usage-tracker.tsx); stored as a PATTERN only —
 *                                ids, dates, tickers and names become :id / :date / :ticker / :param, the query is
 *                                dropped except ?tab= / ?mode= slugs (the server normalises again and drops the rest)
 *   trackAction(key, meta?)      a key step of the daily loop (ACTION_KEYS; meta only { code } / { mode })
 *
 * Batched: flushed every 15 s, when 40 events are queued, and when the page is hidden (fetch keepalive — sendBeacon
 * cannot carry the bearer token). Signed-in members only (guests are read-only and never tracked). The same action
 * within 30 s counts once (autosaves); consecutive identical views count once. Never throws, never retries.
 * Do Not Track is not consulted: this is an internal staff tool on our own server (see docs/PILOT.md).
 */
import { http } from "@/lib/api/http";

export type UsageAction =
  | "playbook.today" | "playbook.picks" | "playbook.cheat" | "playbook.tagging" | "plan.save"
  | "daily.review" | "daily.dispute" | "trainer.start" | "quests.tab" | "season.tab";
export type TrainerMode = "daily" | "find_entry" | "my_days" | "free";
export type UsageMeta = { code?: string | null; mode?: TrainerMode };

type UsageEvent = { kind: "view" | "action"; key: string; t: number; meta?: UsageMeta };

const ENDPOINT = "/api/usage/batch";
const FLUSH_MS = 15_000;
const FLUSH_AT = 40;
const MAX_BATCH = 50;
const MAX_QUEUE = 200;
const ACTION_DEDUPE_MS = 30_000;
const TOKEN_KEY = "ws_lexx_token";
const SESSION_KEY = "ws_lexx_session";

// ─── Normalisation (mirror of artifacts/api-server/src/lib/usage/keys.ts) ──────────────────────────────────────────

const SLUG_RE = /^[a-z][a-z0-9_-]{0,23}$/;
const SEGMENT_RE = /^[a-z][a-z0-9-]{0,39}$/;
const PLACEHOLDERS = new Set([":id", ":date", ":ticker", ":param"]);
const MAX_SEGMENTS = 4;

function safeDecode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

export function normaliseSegment(raw: string): string {
  const s = safeDecode(raw);
  if (PLACEHOLDERS.has(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return ":date";
  if (/^\d+$/.test(s) || /^[0-9a-f]{8,}(-[0-9a-f]{4,})*$/i.test(s)) return ":id";
  if (/^[A-Z]{1,5}([.-][A-Z]{1,2})?$/.test(s)) return ":ticker";
  if (SEGMENT_RE.test(s)) return s;
  return ":param";
}

/** "/trades/42" + "?trader=X&tab=notes" → "/trades/:id?tab=notes"; null when nothing usable is left. */
export function normaliseView(path: string, search = ""): string | null {
  let p = path;
  let q = search;
  const qi = p.indexOf("?");
  if (qi >= 0) { q = q || p.slice(qi); p = p.slice(0, qi); }
  const hi = p.indexOf("#");
  if (hi >= 0) p = p.slice(0, hi);
  if (!p.startsWith("/")) return null;
  let key = `/${p.split("/").filter(Boolean).slice(0, MAX_SEGMENTS).map(normaliseSegment).join("/")}`;
  const params = new URLSearchParams(q.startsWith("?") ? q.slice(1) : q);
  const kept: string[] = [];
  for (const name of ["tab", "mode"]) {
    const v = params.get(name);
    if (v && SLUG_RE.test(v)) kept.push(`${name}=${v}`);
  }
  if (kept.length) key += `?${kept.join("&")}`;
  return key.length <= 120 ? key : null;
}

// ─── Queue ─────────────────────────────────────────────────────────────────────────────────────────────────────────

let queue: UsageEvent[] = [];
let lastView: string | null = null;
const lastAction = new Map<string, number>();
/** false after the server said usage.enabled is off: stop for this page load. */
let serverEnabled = true;
let installed = false;
/** The session the queued events belong to: a sign-out / another sign-in never re-attributes them. */
let queueToken: string | null = null;

/** The bearer token of a signed-in member (null when signed out or a guest). */
function memberToken(): string | null {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return null;
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null") as { role?: string } | null;
    return s && s.role !== "guest" ? token : null;
  } catch {
    return null;
  }
}

function push(e: UsageEvent): void {
  const token = serverEnabled ? memberToken() : null;
  if (!token) return;
  if (queueToken && queueToken !== token) flushUsage();
  queueToken = token;
  queue.push(e);
  if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
  install();
  if (queue.length >= FLUSH_AT) flushUsage();
}

export function trackView(path: string, search = ""): void {
  try {
    const key = normaliseView(path, search);
    if (!key || key === lastView) return;
    lastView = key;
    push({ kind: "view", key, t: Date.now() });
  } catch { /* tracking must never break the app */ }
}

export function trackAction(key: UsageAction, meta?: UsageMeta): void {
  try {
    const dedupe = `${key}|${meta?.code ?? ""}|${meta?.mode ?? ""}`;
    const now = Date.now();
    const prev = lastAction.get(dedupe);
    if (prev && now - prev < ACTION_DEDUPE_MS) return;
    lastAction.set(dedupe, now);
    const clean: UsageMeta | undefined = meta?.code ? { code: meta.code } : meta?.mode ? { mode: meta.mode } : undefined;
    push({ kind: "action", key, t: now, ...(clean ? { meta: clean } : {}) });
  } catch { /* never throws */ }
}

/** Sends what is queued (≤ 50 per request). `keepalive` lets the last batch survive a tab close. */
export function flushUsage(): void {
  try {
    while (queue.length && serverEnabled && queueToken) {
      const events = queue.slice(0, MAX_BATCH);
      queue = queue.slice(MAX_BATCH);
      // The token of the session that produced the events (the global fetch patch keeps an explicit header).
      const headers = { Authorization: `Bearer ${queueToken}` };
      void http.post<{ enabled?: boolean } | null>(ENDPOINT, { events }, { keepalive: true, headers })
        .then((body) => { if (body?.enabled === false) { serverEnabled = false; queue = []; } })
        .catch(() => undefined);
    }
  } catch { /* never throws */ }
}

/** Timers + page-hide flush; idempotent (the first tracked event installs it). */
function install(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.setInterval(flushUsage, FLUSH_MS);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushUsage(); });
  window.addEventListener("pagehide", flushUsage);
}

/** Tests only. */
export function __resetUsage(): { queued: () => UsageEvent[] } {
  queue = [];
  queueToken = null;
  lastView = null;
  lastAction.clear();
  serverEnabled = true;
  return { queued: () => [...queue] };
}
