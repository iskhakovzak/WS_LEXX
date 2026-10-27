/**
 * Pure notification model — no DB queries, no Express — shared by lib/notifyUtils.ts (producers) and
 * routes/notifications.ts (inbox API). Kept dependency-free so it can be exercised by an offline
 * node script (scratchpad check) and by unit tests.
 *
 * Normalized notification (DB `notifications`, columns from src/db/migrations):
 *   type        canonical type key (see NOTIFICATION_TYPES; legacy values are mapped on read via LEGACY_TYPE_ALIASES)
 *   severity    "info" | "warn" | "critical"
 *   title       short headline (nullable for legacy rows → derived from the type label)
 *   message     body text (the historical column name; exposed as `body` in the API)
 *   link        in-app path built like the frontend `@/lib/links` (e.g. "/discussions?thread=12")
 *   entity_type / entity_id   what the notification is about ("thread" / "12")
 *   actor       who caused it (user name) — null for system events
 *   idea_id     legacy FK kept for the ideas sheet ("read-idea" endpoint)
 *   read_at / archived_at / created_at
 */

import { notificationsT } from "../i18n/ns";
import type { Lang } from "../i18n";

export type Severity = "info" | "warn" | "critical";

export type NotificationGroup = "team" | "ideas" | "review" | "risk" | "scaling" | "academy" | "sync" | "system";

type NotificationTypeDef = { type: string; group: NotificationGroup; severity: Severity };

export type NotificationTypeMeta = NotificationTypeDef & {
  /** Label in the requested language (notifications namespace `types.<type>.label`). */
  label: string;
  /** One-line explanation shown in the preferences panel (`types.<type>.description`). */
  description: string;
};

export const SEVERITIES: readonly Severity[] = ["info", "warn", "critical"];

/**
 * Canonical registry: every producer should use one of these keys. Order = order in the UI.
 * Labels and descriptions live in the server `notifications` namespace (`types.<type>`, `groups.<group>`).
 */
const TYPE_DEFS: readonly NotificationTypeDef[] = [
  // team
  { type: "mention", group: "team", severity: "info" },
  { type: "reply", group: "team", severity: "info" },
  { type: "review_request", group: "team", severity: "info" },
  { type: "thread_new", group: "team", severity: "info" },
  // ideas
  { type: "idea_submitted", group: "ideas", severity: "info" },
  { type: "idea_review", group: "ideas", severity: "info" },
  { type: "idea_comment", group: "ideas", severity: "info" },
  // review loop
  { type: "eod_review_request", group: "review", severity: "info" },
  { type: "eod_overdue", group: "review", severity: "warn" },
  { type: "eod_reviewed", group: "review", severity: "info" },
  { type: "weekly_review", group: "review", severity: "info" },
  { type: "rating", group: "review", severity: "info" },
  { type: "rating_ack", group: "review", severity: "info" },
  { type: "discipline_badge", group: "review", severity: "info" },
  { type: "quest_assigned", group: "review", severity: "info" },
  { type: "quest_done", group: "review", severity: "info" },
  { type: "quest_failed", group: "review", severity: "info" },
  { type: "quest_cancelled", group: "review", severity: "info" },
  { type: "achievement_earned", group: "review", severity: "info" },
  { type: "reward_eligible", group: "review", severity: "info" },
  { type: "reward_requested", group: "review", severity: "info" },
  { type: "reward_granted", group: "review", severity: "info" },
  { type: "reward_declined", group: "review", severity: "info" },
  { type: "curator_request", group: "review", severity: "info" },
  { type: "curator_request_done", group: "review", severity: "info" },
  { type: "curator_digest", group: "review", severity: "info" },
  { type: "ai_review_ready", group: "review", severity: "info" },
  { type: "mentor_ready", group: "review", severity: "info" },
  { type: "mentor_escalation", group: "review", severity: "warn" },
  // risk
  { type: "risk_warn", group: "risk", severity: "warn" },
  { type: "risk_breach", group: "risk", severity: "critical" },
  { type: "risk_repeat_breach", group: "risk", severity: "critical" },
  { type: "risk_breach_review", group: "risk", severity: "info" },
  { type: "limit_change", group: "risk", severity: "info" },
  { type: "rule_violation", group: "risk", severity: "warn" },
  { type: "leak_guard", group: "risk", severity: "warn" },
  // scaling
  { type: "scaling_proposal", group: "scaling", severity: "info" },
  { type: "scaling_decision", group: "scaling", severity: "info" },
  // academy
  { type: "academy_promotion_ready", group: "academy", severity: "info" },
  { type: "academy_promotion_request", group: "academy", severity: "info" },
  { type: "academy_promotion_decision", group: "academy", severity: "info" },
  { type: "academy_challenge_assigned", group: "academy", severity: "info" },
  { type: "academy_challenge_passed", group: "academy", severity: "info" },
  { type: "academy_challenge_failed", group: "academy", severity: "warn" },
  { type: "academy_enrolled", group: "academy", severity: "info" },
  { type: "academy_stage_change", group: "academy", severity: "info" },
  { type: "academy_goal_assigned", group: "academy", severity: "info" },
  { type: "academy_goal_achieved", group: "academy", severity: "info" },
  { type: "academy_goal_missed", group: "academy", severity: "warn" },
  { type: "academy_action_assigned", group: "academy", severity: "info" },
  { type: "academy_action_overdue", group: "academy", severity: "warn" },
  { type: "academy_submitted", group: "academy", severity: "info" },
  { type: "academy_graded", group: "academy", severity: "info" },
  // sync
  { type: "sync", group: "sync", severity: "info" },
  { type: "sync_unmatched", group: "sync", severity: "warn" },
  // system
  { type: "system", group: "system", severity: "info" },
];

const GROUPS: readonly NotificationGroup[] = ["team", "ideas", "review", "risk", "scaling", "academy", "sync", "system"];

function withText(d: NotificationTypeDef, lang: Lang): NotificationTypeMeta {
  return {
    ...d,
    label: notificationsT.tryFor(lang, `types.${d.type}.label`) ?? d.type,
    description: notificationsT.tryFor(lang, `types.${d.type}.description`) ?? "",
  };
}

/** The registry with labels in `lang` (GET /notifications/types). */
export function notificationTypes(lang: Lang = "ru"): NotificationTypeMeta[] {
  return TYPE_DEFS.map((d) => withText(d, lang));
}

/** Group labels in `lang`. */
export function groupLabels(lang: Lang = "ru"): Record<NotificationGroup, string> {
  return Object.fromEntries(GROUPS.map((g) => [g, notificationsT.tryFor(lang, `groups.${g}`) ?? g])) as Record<NotificationGroup, string>;
}

/** RU registry (kept for older imports). */
export const NOTIFICATION_TYPES: readonly NotificationTypeMeta[] = notificationTypes("ru");
export const GROUP_LABELS: Record<NotificationGroup, string> = groupLabels("ru");

/** Legacy `notifications.type` values written by older code → canonical type. */
export const LEGACY_TYPE_ALIASES: Readonly<Record<string, string>> = {
  comment_public: "idea_comment",
  reply_private: "idea_comment",
  risk_stop: "risk_breach",
  breach: "risk_breach",
  review: "eod_reviewed",
};

const TYPE_INDEX: ReadonlyMap<string, NotificationTypeDef> = new Map(TYPE_DEFS.map((t) => [t.type, t]));

/** "*" = all types (used by notification_prefs for a global mute). */
export const ALL_TYPES_KEY = "*";

export function isKnownType(type: string): boolean {
  return TYPE_INDEX.has(type);
}

export function normalizeType(raw: string | null | undefined): string {
  const t = (raw ?? "").trim();
  if (!t) return "system";
  return LEGACY_TYPE_ALIASES[t] ?? t;
}

/** Type metadata with its label in `lang` (unknown types: label = the key, group "system"). */
export function typeMeta(raw: string | null | undefined, lang: Lang = "ru"): NotificationTypeMeta {
  const type = normalizeType(raw);
  const def = TYPE_INDEX.get(type);
  return def ? withText(def, lang) : { type, label: type, group: "system", severity: "info", description: "" };
}

export function isSeverity(v: unknown): v is Severity {
  return typeof v === "string" && (SEVERITIES as readonly string[]).includes(v);
}

export function defaultSeverity(raw: string | null | undefined): Severity {
  return typeMeta(raw).severity;
}

/**
 * A type filter from the API (`?type=risk_breach,mention`) must also match rows stored under
 * legacy spellings, so expand every canonical key to itself + all aliases pointing at it.
 */
export function expandTypeFilter(types: readonly string[]): string[] {
  const out = new Set<string>();
  for (const raw of types) {
    const t = normalizeType(raw);
    out.add(t);
    for (const [legacy, canonical] of Object.entries(LEGACY_TYPE_ALIASES)) if (canonical === t) out.add(legacy);
  }
  return [...out];
}

/** Parse a comma-separated list query param into trimmed, de-duplicated, non-empty values (max 40). */
export function parseList(raw: unknown, max = 40): string[] {
  const s = Array.isArray(raw) ? raw.map(String).join(",") : typeof raw === "string" ? raw : "";
  return [...new Set(s.split(",").map((x) => x.trim()).filter(Boolean))].slice(0, max);
}

// ─── preferences ────────────────────────────────────────────────────────────

export type PrefRow = {
  /** canonical type or ALL_TYPES_KEY */
  type: string;
  inApp: boolean;
  /** ISO string / Date / null */
  muteUntil: string | Date | null | undefined;
};

export type DeliveryVerdict = { deliver: true } | { deliver: false; reason: "disabled" | "muted" | "muted_all" | "disabled_all" };

function toMs(v: string | Date | null | undefined): number | null {
  if (!v) return null;
  const ms = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Should an in-app notification of `type` be delivered to a user with `prefs`?
 * Rules: restrictions only stack — a per-type row with `inApp=false` or a future `muteUntil` blocks that
 * type; the "*" row («не беспокоить») blocks every type while it is off/muted, regardless of per-type rows.
 * No rows → deliver (opt-out model: every type is on by default).
 */
export function deliveryVerdict(rawType: string, prefs: readonly PrefRow[], now: Date = new Date()): DeliveryVerdict {
  const type = normalizeType(rawType);
  const nowMs = now.getTime();
  const own = prefs.find((p) => normalizeType(p.type) === type);
  const all = prefs.find((p) => p.type === ALL_TYPES_KEY);
  if (own) {
    if (!own.inApp) return { deliver: false, reason: "disabled" };
    const mu = toMs(own.muteUntil);
    if (mu !== null && mu > nowMs) return { deliver: false, reason: "muted" };
  }
  if (all) {
    if (!all.inApp) return { deliver: false, reason: "disabled_all" };
    const mu = toMs(all.muteUntil);
    if (mu !== null && mu > nowMs) return { deliver: false, reason: "muted_all" };
  }
  return { deliver: true };
}

/** Validate/clean a prefs payload from the client. Unknown types are dropped; "*" allowed. */
export function sanitizePrefs(input: unknown): PrefRow[] {
  if (!Array.isArray(input)) return [];
  const out: PrefRow[] = [];
  const seen = new Set<string>();
  for (const row of input.slice(0, 100)) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const rawType = typeof r.type === "string" ? r.type.trim() : "";
    if (!rawType) continue;
    const type = rawType === ALL_TYPES_KEY ? ALL_TYPES_KEY : normalizeType(rawType);
    if (type !== ALL_TYPES_KEY && !isKnownType(type)) continue;
    if (seen.has(type)) continue;
    seen.add(type);
    const inApp = r.inApp === undefined ? true : Boolean(r.inApp);
    let muteUntil: string | null = null;
    if (typeof r.muteUntil === "string" && r.muteUntil.trim()) {
      const ms = Date.parse(r.muteUntil);
      if (Number.isFinite(ms)) muteUntil = new Date(ms).toISOString();
    }
    out.push({ type, inApp, muteUntil });
  }
  return out;
}

// ─── Telegram push budget (roadmap R3) ──────────────────────────────────────
//
// Per person and New York day: at most `dailyPush` Telegram pushes, of which at most `coachingPush` coaching ones.
// Risk alerts are never capped but go out once per dedup key. A daily-loop contract alert is held back while a risk
// push to the same person is fresher than `riskQuietMinutes` (the same stop, said twice). Exempt kinds are direct
// conversation (a reply to the person's own idea / comment) and the curator's evening digest (it replaces up to 25
// pushes); they are not counted. The DB side (lib/pushBudget.ts) applies this verdict under a per-person lock.

export type PushCategory = "risk" | "coaching" | "standard" | "exempt";

const RISK_KINDS: ReadonlySet<string> = new Set(["risk_warn", "risk_breach", "risk_repeat_breach"]);
/** Coaching nudges: the intraday own-contract alert now; live flags / rule-trial nudges later (R5, R10). */
const COACHING_KINDS: ReadonlySet<string> = new Set(["daily_contract_alert"]);
const EXEMPT_KINDS: ReadonlySet<string> = new Set(["idea_comment", "idea_review", "idea_reply", "curator_digest"]);

export function pushCategory(kind: string): PushCategory {
  if (RISK_KINDS.has(kind)) return "risk";
  if (COACHING_KINDS.has(kind) || kind.startsWith("coach_")) return "coaching";
  if (EXEMPT_KINDS.has(kind)) return "exempt";
  return "standard";
}

export type PushBudget = { dailyPush: number; coachingPush: number; riskQuietMinutes: number };
/** Today's pushes of one person (NY day), any order. */
export type PushLogRow = { kind: string; category: Exclude<PushCategory, "exempt">; dedupKey: string | null; sentAt: string | Date };
export type PushVerdict = { send: true; category: PushCategory } | { send: false; reason: "duplicate" | "daily_cap" | "coaching_cap" | "risk_quiet" };

export function pushVerdict(kind: string, dedupKey: string | null, today: readonly PushLogRow[], budget: PushBudget, now: Date = new Date()): PushVerdict {
  const category = pushCategory(kind);
  if (category === "exempt") return { send: true, category };
  if (dedupKey && today.some((r) => r.dedupKey === dedupKey)) return { send: false, reason: "duplicate" };
  if (category === "risk") return { send: true, category };
  if (kind === "daily_contract_alert") {
    const quietFrom = now.getTime() - budget.riskQuietMinutes * 60_000;
    if (today.some((r) => r.category === "risk" && r.kind !== "risk_repeat_breach" && (toMs(r.sentAt) ?? 0) >= quietFrom)) return { send: false, reason: "risk_quiet" };
  }
  const counted = today.filter((r) => r.category !== "risk");
  if (category === "coaching" && counted.filter((r) => r.category === "coaching").length >= budget.coachingPush) return { send: false, reason: "coaching_cap" };
  if (counted.length >= budget.dailyPush) return { send: false, reason: "daily_cap" };
  return { send: true, category };
}

// ─── keyset pagination ──────────────────────────────────────────────────────

export type Cursor = { createdAt: string; id: number };

/** Opaque cursor = base64url("<ISO created_at>|<id>"). Stable under inserts (newer rows never shift older pages). */
export function encodeCursor(createdAt: string | Date, id: number): string {
  const iso = createdAt instanceof Date ? createdAt.toISOString() : new Date(createdAt).toISOString();
  return Buffer.from(`${iso}|${id}`, "utf8").toString("base64url");
}

export function decodeCursor(raw: unknown): Cursor | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const s = Buffer.from(raw.trim(), "base64url").toString("utf8");
    const i = s.lastIndexOf("|");
    if (i <= 0) return null;
    const createdAt = s.slice(0, i);
    const id = Number(s.slice(i + 1));
    if (!Number.isInteger(id) || id <= 0 || !Number.isFinite(Date.parse(createdAt))) return null;
    return { createdAt: new Date(createdAt).toISOString(), id };
  } catch {
    return null;
  }
}

/** Row ordering used everywhere: created_at DESC, id DESC. */
export function compareDesc(a: { createdAt: string | Date; id: number }, b: { createdAt: string | Date; id: number }): number {
  const ta = toMs(a.createdAt) ?? 0;
  const tb = toMs(b.createdAt) ?? 0;
  if (ta !== tb) return tb - ta;
  return b.id - a.id;
}

/** True when `row` comes strictly after `cursor` in DESC order — i.e. (created_at, id) < (cursor.createdAt, cursor.id). */
export function isAfterCursor(row: { createdAt: string | Date; id: number }, cursor: Cursor): boolean {
  const t = toMs(row.createdAt) ?? 0;
  const c = toMs(cursor.createdAt) ?? 0;
  return t < c || (t === c && row.id < cursor.id);
}

/**
 * Reference implementation of one page (used by the offline check to pin the SQL semantics):
 * sort DESC, skip up to the cursor, take `limit`, and hand back the cursor of the last item when more remain.
 */
export function paginate<T extends { createdAt: string | Date; id: number }>(
  rows: readonly T[],
  opts: { cursor?: Cursor | null; limit: number },
): { items: T[]; nextCursor: string | null } {
  const sorted = [...rows].sort(compareDesc);
  const after = opts.cursor ? sorted.filter((r) => isAfterCursor(r, opts.cursor!)) : sorted;
  const items = after.slice(0, opts.limit);
  const hasMore = after.length > opts.limit;
  const last = items[items.length - 1];
  return { items, nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null };
}

export function clampLimit(raw: unknown, def = 30, max = 100): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(Math.floor(n), max);
}

// ─── links (server-side mirror of the frontend `@/lib/links`) ───────────────

function href(path: string, params: Record<string, string | number | null | undefined> = {}): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === "") continue;
    q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}

export const notifLinks = {
  idea: (id: number) => href("/trade-ideas", { idea: id }),
  thread: (id: number) => href("/discussions", { thread: id }),
  trade: (id: number) => href("/trades", { highlight: id }),
  journalDay: (date: string, trader?: string | null) => href("/journal", { date, trader }),
  risk: (trader?: string | null) => href("/risk", { trader }),
  scaling: (trader?: string | null) => href("/scaling", { trader }),
  weeklyReview: (p: { trader?: string | null; week?: string | null } = {}) => href("/weekly-review", p),
  ratings: (trader?: string | null) => href("/ratings", { trader }),
  integrations: () => "/integrations",
  notifications: () => "/notifications",
} as const;

const INLINE_PATH_RE = /(?:https?:\/\/[^\s/]+)?(\/(?:discussions|trade-ideas|trades|journal|risk|scaling|weekly-review|ratings|integrations|playbook|watchlist|events)(?:\?[^\s»"')]*)?)/;

/**
 * Link for a row: the stored `link`, else the idea FK, else a path embedded in a legacy message
 * ("… https://site/discussions?thread=12" / "… /discussions?thread=12").
 */
export function deriveLink(row: { link?: string | null; idea_id?: number | null; message?: string | null }): string | null {
  if (row.link && row.link.startsWith("/")) return row.link;
  if (row.idea_id != null && Number.isInteger(Number(row.idea_id))) return notifLinks.idea(Number(row.idea_id));
  const m = row.message ? INLINE_PATH_RE.exec(row.message) : null;
  return m ? m[1] : null;
}

/** Strip an inline absolute/relative link from a legacy message body (it is shown as a button instead). */
export function stripInlineLink(message: string): string {
  return message.replace(/\s*(?:https?:\/\/[^\s/]+)?\/(?:discussions|trade-ideas|trades|journal|risk|scaling|weekly-review|ratings|integrations|playbook|watchlist|events)(?:\?[^\s»"')]*)?\s*$/u, "").trim();
}

/** Validate a client/producer supplied link: same-origin absolute path only (no scheme, no //host). */
export function safeLink(link: string | null | undefined): string | null {
  if (!link || typeof link !== "string") return null;
  const l = link.trim();
  if (!l.startsWith("/") || l.startsWith("//") || /[\s<>]/.test(l) || l.length > 500) return null;
  return l;
}
