/**
 * The curator's evening digest (roadmap R3; job curator.digest at curator.digestTime, default 17:30 NY, weekdays):
 * ONE Telegram message and one in-app notice («curator_digest») per curator with wards, instead of a Telegram per closed
 * day (eod_review_request stays in-app only). It says how many of today's days the wards closed, how many wait for a
 * review, and the top curator.digestTopN items to look at first.
 *
 * The top list comes from a small interface, DigestRanker: for now the existing curator queue order (the money queue,
 * lib/daily/costQueue — unresolved rows, most expensive first). Roadmap R11 (curator prioritisation) plugs its scored
 * list in with setDigestRanker() without touching this module.
 *
 * Sent once per curator and day (notification_dedup claimOnce «curator-digest:<date>:<curator>»). Telegram only when the
 * daily loop may talk to Telegram (production + bot token, lib/daily/telegramGuard) and the curator has a linked chat with
 * Telegram on; the digest is exempt from the push budget (it replaces up to 25 pushes) but never sent twice.
 */
import { pool } from "@workspace/db";
import { logger } from "./logger";
import { localeOfUser } from "../i18n";
import { claimOnce } from "./notifyEvents";
import { insertNotification } from "./notifyUtils";
import { renderNotification, type NotificationParams } from "./notificationText";
import { sendMessage } from "./telegramBot";
import { claimPush, releasePush } from "./pushBudget";
import { dailyTelegramEnabled } from "./daily/telegramGuard";
import { groupMembersOf } from "./people/deskGroups";
import { isWeekend, nyDate } from "./tradingDate";
import { setting } from "./settings/registry";
import { buildCostQueue } from "./daily/costQueue";
import { fmtSignedUsd } from "./notifyEventsCore";

/** One thing to look at: a trader, the day, why (a cost-queue reason kind) and the money (≤ 0, null = unknown). */
export type DigestItem = { trader: string; date: string; reason: string | null; costNet: number | null };

/** The ranked list of a curator's items (best first). R11 replaces the default with its score. */
export type DigestRanker = (curator: string, traders: readonly string[], today: string) => Promise<DigestItem[]>;

/** Default: the curator queue by money (unresolved rows, the order /curator shows). */
export const costQueueRanker: DigestRanker = async (_curator, traders, today) => {
  const rows = await buildCostQueue(traders, today);
  return rows.filter((r) => !r.resolved).map((r) => ({ trader: r.trader, date: r.date, reason: r.reasons[0]?.kind ?? null, costNet: r.costNet }));
};

let ranker: DigestRanker = costQueueRanker;
/** Plug another ranking in (R11). Returns the previous one (tests restore it). */
export function setDigestRanker(r: DigestRanker): DigestRanker {
  const prev = ranker;
  ranker = r;
  return prev;
}

export const digestKey = (date: string, curator: string) => `curator-digest:${date}:${curator}`;

/** The digest's params (pure): counts + the top `topN` items, one trader once. Null when there is nothing to say. */
export function digestParams(date: string, closed: number, unreviewed: number, items: readonly DigestItem[], topN: number): NotificationParams | null {
  const seen = new Set<string>();
  const top = items.filter((i) => (seen.has(i.trader) ? false : (seen.add(i.trader), true))).slice(0, Math.max(0, topN));
  if (closed === 0 && unreviewed === 0 && top.length === 0) return null;
  const p: NotificationParams = { date, closed, unreviewed, n: top.length };
  top.forEach((it, k) => {
    p[`trader${k + 1}`] = it.trader;
    p[`reason${k + 1}`] = it.reason ?? "other";
    if (it.costNet != null && it.costNet < 0) p[`cost${k + 1}`] = fmtSignedUsd(it.costNet);
  });
  return p;
}

type Curator = { name: string; chatId: string | null; tgOn: boolean };

/** Active curators / admins and the traders they look after (assigned curator / mentor / risk manager, own desk groups). */
async function curatorsWithWards(): Promise<{ curator: Curator; wards: string[] }[]> {
  const { rows } = await pool.query<{ name: string; role: string; ac: string | null; am: string | null; ar: string | null; chat: string | null; tg: boolean | null }>(
    `SELECT name, role, assigned_curator AS ac, assigned_mentor AS am, assigned_risk_manager AS ar,
            telegram_chat_id AS chat, COALESCE(tg_notifications_enabled, true) AS tg
       FROM users WHERE active = true AND COALESCE(banned, false) = false`,
  );
  const traders = rows.filter((u) => u.role === "trader");
  const out: { curator: Curator; wards: string[] }[] = [];
  for (const c of rows.filter((u) => u.role === "curator" || u.role === "admin")) {
    const group = new Set(await groupMembersOf(c.name).catch(() => [] as string[]));
    const wards = traders.filter((t) => group.has(t.name) || t.ac === c.name || t.am === c.name || t.ar === c.name).map((t) => t.name);
    if (wards.length) out.push({ curator: { name: c.name, chatId: c.chat ? String(c.chat) : null, tgOn: !!c.tg }, wards });
  }
  return out;
}

export type DigestDeps = {
  now?: Date;
  signal?: AbortSignal;
  /** Tests: the list of curators and wards, the Telegram sender, the ranker. */
  curators?: () => Promise<{ curator: Curator; wards: string[] }[]>;
  send?: (chatId: string, html: string) => Promise<boolean>;
  telegram?: boolean;
  rank?: DigestRanker;
};

export async function runCuratorDigest(d: DigestDeps = {}): Promise<Record<string, unknown>> {
  if (!setting("curator.digestEnabled")) return { skipped: "off in desk settings" };
  const now = d.now ?? new Date();
  const date = nyDate(now);
  if (isWeekend(date)) return { skipped: "weekend", date };
  const list = await (d.curators ?? curatorsWithWards)();
  const telegram = d.telegram ?? dailyTelegramEnabled();
  const send = d.send ?? ((chatId: string, html: string) => sendMessage(chatId, html));
  const rank = d.rank ?? ranker;
  const n = { curators: list.length, inApp: 0, telegram: 0, dup: 0, empty: 0, failed: 0 };
  for (const { curator, wards } of list) {
    if (d.signal?.aborted) break;
    try {
      const { rows } = await pool.query<{ closed: number; unreviewed: number }>(
        `SELECT COUNT(*) FILTER (WHERE closed_at IS NOT NULL)::int AS closed,
                COUNT(*) FILTER (WHERE closed_at IS NOT NULL AND reviewed_at IS NULL)::int AS unreviewed
           FROM eod_days WHERE trader = ANY($1) AND date = $2`,
        [wards, date],
      );
      const items = await rank(curator.name, wards, date);
      const params = digestParams(date, rows[0]?.closed ?? 0, rows[0]?.unreviewed ?? 0, items, setting("curator.digestTopN"));
      if (!params) { n.empty++; continue; }
      if (!(await claimOnce(digestKey(date, curator.name)))) { n.dup++; continue; }
      if ((await insertNotification({ userName: curator.name, type: "curator_digest", params, link: "/curator", entityType: "digest", entityId: date, source: "curator" })) != null) n.inApp++;
      if (!telegram || !curator.chatId || !curator.tgOn) continue;
      const text = renderNotification("curator_digest", params, await localeOfUser(curator.name))?.telegram;
      if (!text) continue;
      const slot = await claimPush(curator.name, "curator_digest");
      if (!slot.ok) continue;
      if (await send(curator.chatId, text)) n.telegram++;
      else { await releasePush(slot); n.failed++; }
    } catch (err) {
      n.failed++;
      logger.warn({ err: (err as Error).message, curator: curator.name }, "curator digest failed");
    }
  }
  return { date, ...n };
}
