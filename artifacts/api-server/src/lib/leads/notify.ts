/**
 * Tells the owner about a new landing lead through the desk Telegram bot (lib/telegramBot sendMessage): every active
 * admin with a linked Telegram chat and notifications on, the same recipients as the error tracker. Sends only from
 * a production API with a bot token (errorTracking alertsEnabled); a dev or test API logs instead. Never throws.
 */
import { pool } from "@workspace/db";
import { logger } from "../logger";
import { alertsEnabled } from "../errorTracking";
import { escHtml, sendMessage } from "../telegramBot";
import type { Lead } from "./schema";

const SEGMENT_LABEL: Record<Lead["segment"], string> = {
  prop_desk: "Prop desk",
  funded_trader: "Funded trader",
  futures_firm: "Futures firm",
};

/** Telegram text (HTML parse mode). English: the bot has no translation keys for landing leads yet. */
export function leadText(id: number, l: Lead): string {
  const rows: [string, string | undefined][] = [
    ["Segment", SEGMENT_LABEL[l.segment]],
    ["Name", l.name],
    ["Company", l.company],
    ["Traders", l.tradersCount],
    ["Platform", l.platform],
    ["Email", l.email],
    ["Locale", l.locale],
  ];
  const lines = [`<b>New landing lead #${id}</b>`];
  for (const [k, v] of rows) if (v) lines.push(`${k}: ${escHtml(v)}`);
  if (l.message) lines.push("", `<i>${escHtml(l.message.slice(0, 1200))}</i>`);
  return lines.join("\n");
}

export async function notifyLeadOwner(id: number, lead: Lead, enabled: boolean = alertsEnabled()): Promise<boolean> {
  if (!enabled) {
    logger.info({ leadId: id, segment: lead.segment }, "lead notice not sent: Telegram runs only in production with a bot token");
    return false;
  }
  try {
    const { rows } = await pool.query<{ telegram_chat_id: string }>(
      `SELECT telegram_chat_id FROM users
        WHERE role = 'admin' AND active = true AND COALESCE(banned, false) = false
          AND telegram_chat_id IS NOT NULL AND telegram_chat_id <> '' AND COALESCE(tg_notifications_enabled, true) = true`,
    );
    const text = leadText(id, lead);
    let sent = false;
    for (const r of rows) sent = (await sendMessage(r.telegram_chat_id, text)) || sent;
    if (sent) await pool.query(`UPDATE leads SET notified_at = now() WHERE id = $1`, [id]);
    return sent;
  } catch (err) {
    logger.warn({ leadId: id, err: (err as Error)?.message }, "lead notice failed");
    return false;
  }
}
