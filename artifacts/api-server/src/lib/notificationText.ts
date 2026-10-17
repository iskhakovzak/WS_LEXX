/**
 * Notifications as data (ARCHITECTURE.md §0.5, data.md Phase 7): producers store `type` + `params` (jsonb); the text is
 * rendered in the READER's language from the server `notifications` namespace:
 *   • in-app list → request language (routes/notifications.ts presentNotification);
 *   • Telegram / digests → the recipient's users.locale (notifyUser → localeOfUser).
 * Rows without params (written before, or by producers not converted yet) keep their stored Russian title/message.
 *
 * Params are data (names, tickers, setup and stage names, numbers, user-typed previews) and are never translated.
 * Pure apart from the dictionary lookup.
 */
import { notificationsT } from "../i18n/ns";
import type { Lang, Params } from "../i18n";

export type NotificationParams = Record<string, string | number | boolean | null | undefined>;
export type RenderedNotification = { title: string; body: string; telegram: string };

const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function clean(p: NotificationParams, html = false): Params {
  const out: Params = {};
  for (const [k, v] of Object.entries(p)) {
    if (v === null || v === undefined || typeof v === "boolean") continue;
    out[k] = typeof v === "number" ? v : html ? esc(v) : String(v);
  }
  return out;
}

/**
 * Renders a stored notification. Returns null for a type/params combination this renderer does not know (the caller
 * then falls back to the stored title/message).
 */
export function renderNotification(type: string, params: NotificationParams | null | undefined, lang: Lang): RenderedNotification | null {
  if (!params || typeof params !== "object") return null;
  const tr = (key: string, p: Params) => notificationsT.tryFor(lang, key, p);
  const p = clean(params);
  const h = clean(params, true);
  const variant = typeof params.variant === "string" ? params.variant : "";
  let title: string | undefined;
  let body: string | undefined;
  let telegram: string | undefined;

  switch (type) {
    case "mention": {
      title = tr(p.subject ? "mention.titleWith" : "mention.title", p);
      body = tr("mention.body", p);
      break;
    }
    case "idea_submitted": {
      title = tr("idea_submitted.title", p);
      body = tr(p.setup ? "idea_submitted.bodyWithSetup" : "idea_submitted.body", p);
      break;
    }
    case "idea_comment": {
      title = tr("idea_comment.title", p);
      body = tr("idea_comment.body", p);
      telegram = tr("idea_comment.tg", h);
      break;
    }
    case "idea_review": {
      const status = tr(`idea_review.status.${String(params.status ?? "")}`, {});
      if (!status) return null;
      title = tr("idea_review.title", { ...p, status });
      body = tr(p.reason ? "idea_review.bodyWithReason" : "idea_review.body", { ...p, status });
      telegram = tr(p.reason ? "idea_review.tgWithReason" : "idea_review.tg", { ...h, status });
      break;
    }
    case "academy_promotion_ready": {
      const staff = variant === "staff";
      title = tr(staff ? "academy_promotion_ready.staffTitle" : "academy_promotion_ready.title", p);
      body = tr(staff ? "academy_promotion_ready.staffBody" : "academy_promotion_ready.body", p);
      break;
    }
    case "academy_challenge_passed":
    case "academy_challenge_failed": {
      const outcome = String(params.outcome ?? (type === "academy_challenge_passed" ? "passed" : "failed"));
      const own = tr(outcome === "passed" ? "academy_challenge.passedTitle" : outcome === "expired" ? "academy_challenge.expiredTitle" : "academy_challenge.failedTitle", p);
      if (!own) return null;
      title = variant === "staff" ? tr("academy_challenge.staffTitle", { ...p, title: own }) : own;
      body = outcome === "passed" ? tr("academy_challenge.passedBody", { ...p, count: Number(params.days ?? 0) }) : String(params.reason ?? "");
      break;
    }
    default:
      return null;
  }
  if (!title || body === undefined) return null;
  return { title, body, telegram: telegram ?? (body ? `${esc(title)}\n${esc(body)}` : esc(title)) };
}

/** Types the renderer understands (tests, docs). */
export const RENDERED_TYPES = ["mention", "idea_submitted", "idea_comment", "idea_review", "academy_promotion_ready", "academy_challenge_passed", "academy_challenge_failed"] as const;
