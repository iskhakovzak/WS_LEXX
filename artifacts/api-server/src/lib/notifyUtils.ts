import { pool } from "@workspace/db";
import { logger } from "./logger";
import { sendMessage, sendIdeaNotification, buildTraderReplyKeyboard } from "./telegramBot";
import {
  ALL_TYPES_KEY, defaultSeverity, deliveryVerdict, isSeverity, normalizeType, notifLinks, safeLink, typeMeta,
  type PrefRow, type Severity,
} from "./notificationCore";

export function getSiteUrl(): string {
  if (process.env["SITE_URL"]) return process.env["SITE_URL"].trim();
  return "https://zakit.website";
}

// ─── schema (additive, idempotent; run once per process, retried on failure) ───
// `notifications` was created by migrate.ts with (user_name, type, idea_id, message, is_read, source, created_at).
// Everything below is CREATE/ALTER … IF NOT EXISTS, so it is safe on every start and on older databases.

let schemaReady: Promise<void> | null = null;
export function ensureNotificationSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = pool
      .query(
        `CREATE TABLE IF NOT EXISTS notifications (
           id SERIAL PRIMARY KEY,
           user_name TEXT NOT NULL,
           type TEXT NOT NULL,
           idea_id INTEGER,
           message TEXT NOT NULL,
           is_read BOOLEAN NOT NULL DEFAULT FALSE,
           source TEXT NOT NULL DEFAULT 'system',
           created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
         );
         ALTER TABLE notifications ADD COLUMN IF NOT EXISTS severity TEXT NOT NULL DEFAULT 'info';
         ALTER TABLE notifications ADD COLUMN IF NOT EXISTS title TEXT;
         ALTER TABLE notifications ADD COLUMN IF NOT EXISTS link TEXT;
         ALTER TABLE notifications ADD COLUMN IF NOT EXISTS entity_type TEXT;
         ALTER TABLE notifications ADD COLUMN IF NOT EXISTS entity_id TEXT;
         ALTER TABLE notifications ADD COLUMN IF NOT EXISTS actor TEXT;
         ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;
         ALTER TABLE notifications ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
         CREATE INDEX IF NOT EXISTS notifications_user_created_idx ON notifications (user_name, created_at DESC, id DESC);
         CREATE INDEX IF NOT EXISTS notifications_user_unread_idx ON notifications (user_name, is_read);
         CREATE TABLE IF NOT EXISTS notification_prefs (
           user_name TEXT NOT NULL,
           type TEXT NOT NULL,
           in_app BOOLEAN NOT NULL DEFAULT TRUE,
           mute_until TIMESTAMPTZ,
           updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
           PRIMARY KEY (user_name, type)
         );`,
      )
      .then(() => undefined)
      .catch((err) => {
        schemaReady = null;
        throw err;
      });
  }
  return schemaReady;
}
ensureNotificationSchema().catch((err) => logger.warn({ err }, "notifications: ensure schema failed at init"));

// ─── per-user preferences (in-app on/off + mute until, per type or "*") ──────

const PREFS_CACHE_TTL_MS = 15_000;
const prefsCache = new Map<string, { rows: PrefRow[]; exp: number }>();

export async function loadNotificationPrefs(userName: string): Promise<PrefRow[]> {
  const now = Date.now();
  const hit = prefsCache.get(userName);
  if (hit && hit.exp > now) return hit.rows;
  await ensureNotificationSchema();
  const { rows } = await pool.query<{ type: string; in_app: boolean; mute_until: Date | null }>(
    `SELECT type, in_app, mute_until FROM notification_prefs WHERE user_name = $1`,
    [userName],
  );
  const mapped: PrefRow[] = rows.map((r) => ({ type: r.type, inApp: r.in_app, muteUntil: r.mute_until }));
  prefsCache.set(userName, { rows: mapped, exp: now + PREFS_CACHE_TTL_MS });
  return mapped;
}

export function invalidateNotificationPrefs(userName: string): void {
  prefsCache.delete(userName);
}

/** Replaces the user's preference rows. Default rows (on, no mute) are not stored: absence == default. */
export async function saveNotificationPrefs(userName: string, prefs: readonly PrefRow[]): Promise<void> {
  await ensureNotificationSchema();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM notification_prefs WHERE user_name = $1`, [userName]);
    for (const p of prefs) {
      const type = p.type === ALL_TYPES_KEY ? ALL_TYPES_KEY : normalizeType(p.type);
      const muteMs = p.muteUntil ? (p.muteUntil instanceof Date ? p.muteUntil.getTime() : Date.parse(p.muteUntil)) : NaN;
      const mute = Number.isFinite(muteMs) && muteMs > Date.now() ? new Date(muteMs) : null;
      if (p.inApp && !mute) continue;
      await client.query(
        `INSERT INTO notification_prefs (user_name, type, in_app, mute_until, updated_at) VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (user_name, type) DO UPDATE SET in_app = EXCLUDED.in_app, mute_until = EXCLUDED.mute_until, updated_at = NOW()`,
        [userName, type, p.inApp, mute],
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  invalidateNotificationPrefs(userName);
}

// ─── insert (single write path) ─────────────────────────────────────────────

export type NewNotification = {
  userName: string;
  type: string;
  /** Body text (stored in the historical `message` column, exposed as `body`). */
  message: string;
  title?: string | null;
  severity?: Severity | null;
  /** In-app path built like the frontend `links.*` (e.g. "/discussions?thread=12"); see notifLinks. */
  link?: string | null;
  entityType?: string | null;
  entityId?: string | number | null;
  /** Who caused the event (user name); null for system events. */
  actor?: string | null;
  ideaId?: number | null;
  source?: string | null;
};

/**
 * Writes one in-app notification: normalizes type/severity, derives the link, honours the recipient's
 * preferences (type off, mute until, global mute) and never throws. Returns the new id, or null when
 * skipped by preferences / failed.
 */
export async function insertNotification(n: NewNotification): Promise<number | null> {
  const userName = (n.userName ?? "").trim();
  if (!userName) return null;
  const type = normalizeType(n.type);
  try {
    const prefs = await loadNotificationPrefs(userName);
    const verdict = deliveryVerdict(type, prefs);
    if (!verdict.deliver) {
      logger.debug({ userName, type, reason: verdict.reason }, "notification skipped by preferences");
      return null;
    }
    const severity: Severity = n.severity && isSeverity(n.severity) ? n.severity : defaultSeverity(type);
    const title = (n.title ?? typeMeta(type).label).slice(0, 200);
    const ideaId = n.ideaId != null && Number.isInteger(Number(n.ideaId)) ? Number(n.ideaId) : null;
    const link = safeLink(n.link) ?? (ideaId != null ? notifLinks.idea(ideaId) : null);
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO notifications (user_name, type, idea_id, message, source, severity, title, link, entity_type, entity_id, actor)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      [
        userName, type, ideaId, (n.message ?? "").slice(0, 2000), (n.source ?? "system").slice(0, 40), severity, title, link,
        n.entityType ? String(n.entityType).slice(0, 40) : null,
        n.entityId != null ? String(n.entityId).slice(0, 100) : null,
        n.actor ? String(n.actor).slice(0, 100) : null,
      ],
    );
    return rows[0]?.id ?? null;
  } catch (e: any) {
    logger.warn({ error: e.message, userName, type }, "Failed to create notification");
    return null;
  }
}

/** Legacy signature kept for existing callers (discussions, risk, idea-comments, telegram). Prefs are honoured. */
export async function createNotification(
  userName: string,
  type: string,
  ideaId: number | null,
  message: string,
): Promise<void> {
  await insertNotification({ userName, type, ideaId, message });
}

// ─── Generic notifications (any section) ───────────────────────────────────
// Use `notifyUser` from every producer: it writes the in-app row through `insertNotification`
// (preferences honoured) and optionally mirrors the text to Telegram (unchanged behaviour).

export type NotifyType =
  | "mention" | "reply" | "review_request"
  | "idea_submitted" | "idea_review" | "idea_comment"
  | "eod_review_request" | "eod_overdue" | "eod_reviewed" | "weekly_review" | "rating" | "rating_ack"
  | "risk_warn" | "risk_breach" | "limit_change" | "rule_violation"
  | "scaling_proposal" | "scaling_decision"
  | "sync" | "sync_unmatched" | "system";

export type NotifyUserOpts = {
  userName: string | null | undefined;
  type: NotifyType | string;
  /** Body text. */
  message: string;
  title?: string | null;
  severity?: Severity | null;
  link?: string | null;
  entityType?: string | null;
  entityId?: string | number | null;
  actor?: string | null;
  ideaId?: number | null;
  source?: string | null;
  telegram?: boolean | string; // true → same text; string → custom Telegram text (HTML)
};

/** In-app notification + (optionally) Telegram, never throws. Returns the notification id (null when skipped). */
export async function notifyUser(opts: NotifyUserOpts): Promise<number | null> {
  if (!opts.userName) return null;
  const id = await insertNotification({
    userName: opts.userName, type: opts.type, message: opts.message, title: opts.title, severity: opts.severity,
    link: opts.link, entityType: opts.entityType, entityId: opts.entityId, actor: opts.actor, ideaId: opts.ideaId ?? null,
    source: opts.source,
  });
  if (opts.telegram) {
    await notifyTraderTelegram(opts.userName, typeof opts.telegram === "string" ? opts.telegram : opts.message, opts.ideaId ? { ideaId: opts.ideaId } : undefined);
  }
  return id;
}

/** Same notification to several recipients (de-duplicated, `exclude` skipped — usually the actor). */
export async function notifyUsers(names: Iterable<string | null | undefined>, opts: Omit<NotifyUserOpts, "userName">, exclude?: string | null): Promise<string[]> {
  const unique = [...new Set([...names].filter((n): n is string => !!n && n !== exclude))];
  for (const userName of unique) await notifyUser({ ...opts, userName });
  return unique;
}

/** Assigned curator / risk manager / mentor of a trader (for staff fan-out). */
export async function assignedStaffOf(trader: string | null | undefined): Promise<string[]> {
  if (!trader) return [];
  try {
    const { rows } = await pool.query<{ assigned_curator: string | null; assigned_risk_manager: string | null; assigned_mentor: string | null }>(
      `SELECT assigned_curator, assigned_risk_manager, assigned_mentor FROM users WHERE name = $1 LIMIT 1`,
      [trader],
    );
    const a = rows[0];
    return [...new Set([a?.assigned_curator, a?.assigned_risk_manager, a?.assigned_mentor].filter((x): x is string => !!x && x !== trader))];
  } catch {
    return [];
  }
}

/**
 * Names mentioned as "@Имя" in free text, matched against active users (longest names first so
 * "@Закир Х" wins over "@Закир"). Names may contain spaces and Cyrillic; comparison is case-insensitive.
 */
export async function extractMentions(text: string | null | undefined): Promise<string[]> {
  if (!text || !text.includes("@")) return [];
  try {
    const { rows } = await pool.query<{ name: string }>(`SELECT name FROM users WHERE active = true`);
    const lower = text.toLowerCase();
    const names = rows.map((r) => r.name).filter(Boolean).sort((a, b) => b.length - a.length);
    const found: string[] = [];
    for (const name of names) {
      const needle = `@${name.toLowerCase()}`;
      let i = lower.indexOf(needle);
      while (i !== -1) {
        const after = lower[i + needle.length];
        if (after === undefined || !/[\p{L}\p{N}_]/u.test(after)) { found.push(name); break; }
        i = lower.indexOf(needle, i + 1);
      }
    }
    return [...new Set(found)];
  } catch (e: any) {
    logger.warn({ error: e.message }, "extractMentions failed");
    return [];
  }
}

/**
 * Notify everyone @mentioned in `text` (except the author). Returns the notified names.
 * Example: notifyMentions({ text, authorName, context: "в обсуждении NVDA", link: "/discussions?thread=12" }).
 */
export async function notifyMentions(opts: {
  text: string | null | undefined;
  authorName: string;
  context: string;
  link?: string;
  ideaId?: number | null;
  telegram?: boolean;
}): Promise<string[]> {
  const names = (await extractMentions(opts.text)).filter((n) => n !== opts.authorName);
  if (names.length === 0) return [];
  const preview = (opts.text ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  const message = `${opts.authorName} упомянул вас ${opts.context}: «${preview}»`;
  const tgText = `${message}${opts.link ? ` ${getSiteUrl()}${opts.link}` : ""}`;
  for (const name of names) {
    await notifyUser({
      userName: name, type: "mention", title: `Упоминание ${opts.context}`.slice(0, 200), message,
      link: opts.link ?? null, actor: opts.authorName, ideaId: opts.ideaId ?? null,
      telegram: (opts.telegram ?? true) ? tgText : false,
    });
  }
  return names;
}

/**
 * Send a Telegram message to a trader.
 * If ideaId is provided, attach a "Reply to curator/risk" inline button.
 */
export async function notifyTraderTelegram(
  trader: string | null | undefined,
  message: string,
  opts?: { ideaId?: number },
): Promise<void> {
  if (!trader) return;
  try {
    const { rows } = await pool.query(
      `SELECT telegram_chat_id, COALESCE(tg_notifications_enabled, true) AS tg_notifications_enabled FROM users WHERE name = $1`,
      [trader],
    );
    const chatId = rows[0]?.telegram_chat_id as string | undefined;
    const notificationsEnabled = rows[0]?.tg_notifications_enabled as boolean ?? true;
    if (!chatId || !notificationsEnabled) return;

    const keyboard = opts?.ideaId ? buildTraderReplyKeyboard(opts.ideaId) : undefined;
    await sendMessage(chatId, message, {
      ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
    });
  } catch (e: any) {
    logger.warn({ error: e.message, trader }, "notifyTraderTelegram failed");
  }
}

export async function notifyReviewersOnPublish(idea: {
  id: number; ticker: string; side?: string | null; setup?: string | null;
  thesis?: string | null; entryZone?: string | null; target?: string | null;
  stop?: string | null; score?: number | null; trader?: string | null;
  screenshotUrl?: string | null; riskAmount?: string | number | null;
  setupQuality?: string | null;
}): Promise<void> {
  const siteUrl = getSiteUrl();
  try {
    let reviewerNames: string[] = [];
    let source = "fallback";

    if (idea.trader) {
      const { rows } = await pool.query(
        `SELECT assigned_curator, assigned_risk_manager, assigned_mentor FROM users WHERE name = $1`,
        [idea.trader],
      );
      const author = rows[0];
      if (author?.assigned_curator) reviewerNames.push(author.assigned_curator as string);
      if (author?.assigned_risk_manager) reviewerNames.push(author.assigned_risk_manager as string);
      if (author?.assigned_mentor) reviewerNames.push(author.assigned_mentor as string);
      if (reviewerNames.length > 0) source = "assignments";
      logger.info({ ideaId: idea.id, trader: idea.trader, assigned_curator: author?.assigned_curator ?? null, assigned_risk_manager: author?.assigned_risk_manager ?? null, assigned_mentor: author?.assigned_mentor ?? null }, "notifyReviewersOnPublish: assignments lookup");
    } else {
      logger.warn({ ideaId: idea.id }, "notifyReviewersOnPublish: idea.trader is null — using fallback");
    }

    if (reviewerNames.length === 0) {
      const { rows } = await pool.query(
        `SELECT name FROM users WHERE role IN ('curator', 'admin') AND active = true AND telegram_chat_id IS NOT NULL`,
      );
      reviewerNames = rows.map((r: any) => r.name as string);
      logger.info({ ideaId: idea.id, fallbackReviewers: reviewerNames }, "notifyReviewersOnPublish: fallback to all linked curators");
    }

    const uniqueReviewers = [...new Set(reviewerNames)];
    logger.info({ ideaId: idea.id, source, uniqueReviewers }, "notifyReviewersOnPublish: sending to reviewers");

    for (const name of uniqueReviewers) {
      const { rows } = await pool.query(
        `SELECT telegram_chat_id FROM users WHERE name = $1`,
        [name],
      );
      const chatId = rows[0]?.telegram_chat_id as string | undefined;
      if (chatId) {
        await sendIdeaNotification(chatId, idea, siteUrl);
        logger.info({ ideaId: idea.id, reviewer: name, chatId }, "notifyReviewersOnPublish: TG message sent");
      } else {
        logger.warn({ ideaId: idea.id, reviewer: name }, "notifyReviewersOnPublish: reviewer has no telegram_chat_id");
      }
      await insertNotification({
        userName: name, type: "idea_submitted", ideaId: idea.id, actor: idea.trader ?? null,
        entityType: "idea", entityId: idea.id,
        title: `Новая идея ${idea.ticker}${idea.side ? ` ${idea.side}` : ""}`,
        message: `Новая идея от ${idea.trader ?? "unknown"}: ${idea.ticker}${idea.side ? ` ${idea.side}` : ""}${idea.setup ? ` — ${idea.setup}` : ""}`,
      });
    }

    logger.info({ ideaId: idea.id, notified: uniqueReviewers.length }, "Reviewers notified on publish");
  } catch (e: any) {
    logger.warn({ error: e.message, ideaId: idea.id }, "notifyReviewersOnPublish failed");
  }
}

/** Notify everyone with a stake in a public comment: creator, assigned curator/risk, prior commenters */
export async function notifyPublicComment(opts: {
  ideaId: number;
  ticker: string;
  traderName: string | null;   // idea creator
  authorName: string;           // person who just commented
  commentText: string;
  source: "website" | "telegram";
}): Promise<void> {
  const { ideaId, ticker, traderName, authorName, commentText, source } = opts;
  const preview = commentText.slice(0, 150);
  const tgMsg = `💬 Публичный комментарий к идее <b>#${ideaId} ${ticker}</b> от <b>${authorName}</b>:\n\n<i>"${preview}${commentText.length > 150 ? "…" : ""}"</i>`;
  const notifMsg = `${authorName} оставил публичный комментарий к идее ${ticker}: "${commentText.slice(0, 100)}"`;

  try {
    // 1. Assigned curator & risk manager (from trader's assignments)
    const assigneeNames: string[] = [];
    if (traderName) {
      const { rows: aRows } = await pool.query(
        `SELECT assigned_curator, assigned_risk_manager, assigned_mentor FROM users WHERE name = $1`,
        [traderName],
      );
      const a = aRows[0] as { assigned_curator: string | null; assigned_risk_manager: string | null; assigned_mentor: string | null } | undefined;
      if (a?.assigned_curator) assigneeNames.push(a.assigned_curator);
      if (a?.assigned_risk_manager) assigneeNames.push(a.assigned_risk_manager);
      if (a?.assigned_mentor) assigneeNames.push(a.assigned_mentor);
    }

    // 2. All prior public commenters on this idea
    const { rows: priorRows } = await pool.query(
      `SELECT DISTINCT author_name FROM trade_idea_comments WHERE idea_id = $1 AND is_private = FALSE`,
      [ideaId],
    );
    const priorCommenters = (priorRows as { author_name: string }[]).map((r) => r.author_name);

    // 3. Collect unique recipients — exclude the person who just commented
    const allNames = [...new Set([traderName, ...assigneeNames, ...priorCommenters].filter(Boolean))] as string[];
    const recipients = allNames.filter((n) => n !== authorName);

    for (const name of recipients) {
      await insertNotification({
        userName: name, type: "idea_comment", ideaId, actor: authorName, entityType: "idea", entityId: ideaId,
        title: `Комментарий к идее ${ticker}`, message: notifMsg, source,
      });
      // Trader (idea creator) gets the reply button; reviewers do not (they already have the idea keyboard)
      const isCreator = name === traderName;
      await notifyTraderTelegram(name, tgMsg, isCreator ? { ideaId } : undefined);
    }

    logger.info({ ideaId, authorName, recipients, source }, "notifyPublicComment: notified");
  } catch (e: any) {
    logger.warn({ error: e.message, ideaId, authorName }, "notifyPublicComment failed");
  }
}

export async function applyIdeaReview(
  ideaId: number,
  status: "approved" | "rejected" | "needs_work",
  reason: string | null,
  reviewerName: string,
): Promise<{ id: number; ticker: string; trader: string | null } | null> {
  const { rows } = await pool.query(
    `UPDATE trade_ideas
     SET review_status = $1, review_reason = $2, reviewed_by = $3, reviewed_at = NOW()
     WHERE id = $4
     RETURNING id, ticker, trader, review_status, review_reason, reviewed_by, reviewed_at`,
    [status, reason, reviewerName, ideaId],
  );
  if (!rows[0]) return null;
  const idea = rows[0] as { id: number; ticker: string; trader: string | null };

  const statusLabel = status === "approved" ? "✅ Одобрена" : status === "rejected" ? "❌ Отклонена" : "🔄 На доработку";
  const notifMsg = `Твоя идея <b>${idea.ticker}</b> — ${statusLabel}` +
    (reason ? `\nКомментарий: <i>${reason.slice(0, 300)}</i>` : "") +
    `\n(ревьюер: ${reviewerName})`;

  await insertNotification({
    userName: idea.trader ?? "", type: "idea_review", ideaId, actor: reviewerName, entityType: "idea", entityId: ideaId,
    severity: status === "rejected" ? "warn" : "info",
    title: `Идея ${idea.ticker} — ${statusLabel}`,
    message: `Идея ${idea.ticker} — ${statusLabel}` + (reason ? `: ${reason.slice(0, 150)}` : "") + ` (от ${reviewerName})`,
  });
  // Trader gets a "Reply" button so they can respond directly in Telegram
  await notifyTraderTelegram(idea.trader, notifMsg, { ideaId });

  return idea;
}
