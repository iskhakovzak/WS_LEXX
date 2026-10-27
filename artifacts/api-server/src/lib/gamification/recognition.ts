/**
 * Recognition — achievement tiers, long contract streaks, season top 3, mastery level-ups and granted rewards, stored
 * once (recognition_events, unique (trader, kind, ref)) and shown:
 *   • in the desk feed (lib/feedStream kind «recognition», cats desk + achievement): the line is rendered per reader;
 *     names follow the viewer's stage rule (lib/access/names; a trader sees «Трейдер N» — the day's alias — for others, staff and
 *     the trader himself see the name);
 *   • in the desk Telegram group — only with gamification.telegramGroup on, a group chat (TELEGRAM_GROUP_CHAT_ID), a
 *     bot token and NODE_ENV=production (dailyTelegramEnabled: a development API never sends), for fresh events.
 * A user with users.settings.shareAchievements = false is left out everywhere but his own feed (events stay stored, so
 * switching back on shows them again).
 */
import { pool } from "@workspace/db";
import { config } from "../../config";
import { logger } from "../logger";
import { setting } from "../settings/registry";
import { addDays, nyDate } from "../tradingDate";
import { deskAliases } from "../deskAliases";
import { namesVisible } from "../access/names";
import { personNameFor } from "../people/latinNames";
import { dailyTelegramEnabled } from "../daily/telegramGuard";
import { sendMessage, escHtml } from "../telegramBot";
import { fmtDateFor } from "../../i18n/format";
import { gamificationT } from "../../i18n/ns";
import type { Lang } from "../../i18n";
import { achievementNameFor } from "../notificationRenderers/quests";
import type { FeedItem, FeedViewer } from "../feedStream";
import { hiddenUsers, sharesAchievements } from "./people";
import type { RecognitionEvent } from "./types";

export type RecognitionKind = "achievement" | "streak" | "season_top" | "mastery" | "reward";
export type NewRecognition = { trader: string; kind: RecognitionKind; ref: string; params: Record<string, string | number | null>; day: string };
export type StoredRecognition = NewRecognition & { id: number; at: string };

/** Telegram posts only for events of the last days (a first run never floods the group with history). */
const POST_DAYS = 3;

// ─── text (pure apart from dictionaries) ────────────────────────────────────

const str = (v: unknown) => (v == null ? "" : String(v));
const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);

/** The event's line in `lang`; `name` = how this reader sees the trader. Null for an unknown / incomplete event. */
export function recognitionText(e: Pick<NewRecognition, "kind" | "params">, lang: Lang, name: string): string | null {
  const t = gamificationT.tFor(lang);
  const p = e.params;
  switch (e.kind) {
    case "achievement": {
      const n = achievementNameFor(lang, str(p.line), str(p.tier), p);
      return n ? t("recognition.achievement", { name, ...n }) : null;
    }
    case "streak":
      return t("recognition.streak", { name, count: num(p.days) });
    case "season_top":
      return t("recognition.season_top", { name, rank: num(p.rank), season: fmtDateFor(lang, `${str(p.season)}-01`, "monthYear") });
    case "mastery": {
      const level = (["l0", "l1", "l2", "l3", "l4"] as const)[Math.max(0, Math.min(4, Math.round(num(p.level))))]!;
      return t("recognition.mastery", { name, level: t(`masteryLevel.${level}`), setup: str(p.name) || str(p.code) });
    }
    case "reward":
      return str(p.title) ? t("recognition.reward", { name, title: str(p.title) }) : null;
    default:
      return null;
  }
}

/** API shape (RecognitionEvent.text = the TextItem the web may render itself). */
export function toEvent(e: StoredRecognition): RecognitionEvent {
  return { id: e.id, trader: e.trader, kind: e.kind, text: { key: `recognition.${e.kind}`, params: e.params }, at: e.at };
}

// ─── Telegram group ─────────────────────────────────────────────────────────

export function groupPostEnabled(c: { isProduction: boolean; telegram: { botToken: string; groupChatId?: string | null } } = config): boolean {
  return setting("gamification.enabled") && setting("gamification.telegramGroup") && !!c.telegram.groupChatId && dailyTelegramEnabled(c);
}

async function postToGroup(e: StoredRecognition, now: Date): Promise<void> {
  if (!groupPostEnabled() || e.day < addDays(nyDate(now), -POST_DAYS)) return;
  if (!(await sharesAchievements(e.trader))) return;
  const text = recognitionText(e, "ru", personNameFor(e.trader, "ru"));
  if (!text) return;
  const ok = await sendMessage(config.telegram.groupChatId!, escHtml(gamificationT.tFor("ru")("recognition.telegram", { text })));
  if (ok) await pool.query(`UPDATE recognition_events SET posted_at = now() WHERE id = $1`, [e.id]).catch(() => undefined);
}

// ─── store ──────────────────────────────────────────────────────────────────

/** Stores an event once (same trader / kind / ref → nothing); true when this call stored it (then it may be posted). */
export async function recordRecognition(e: NewRecognition, now = new Date()): Promise<boolean> {
  if (!setting("gamification.enabled")) return false;
  try {
    const { rows } = await pool.query<{ id: number; created_at: Date }>(
      `INSERT INTO recognition_events (trader, kind, ref, params, day) VALUES ($1, $2, $3, $4::jsonb, $5)
       ON CONFLICT (trader, kind, ref) DO NOTHING RETURNING id, created_at`,
      [e.trader, e.kind, e.ref, JSON.stringify(e.params), e.day],
    );
    if (!rows[0]) return false;
    await postToGroup({ ...e, id: Number(rows[0].id), at: new Date(rows[0].created_at).toISOString() }, now).catch((err) =>
      logger.warn({ err: (err as Error)?.message }, "recognition: group post failed"));
    return true;
  } catch (err) {
    logger.warn({ err: (err as Error)?.message, trader: e.trader, kind: e.kind }, "recognition: store failed");
    return false;
  }
}

export async function recognitionBetween(from: string, to: string): Promise<StoredRecognition[]> {
  const { rows } = await pool
    .query<{ id: number; trader: string; kind: string; ref: string; params: Record<string, string | number | null> | null; day: string; created_at: Date }>(
      `SELECT id, trader, kind, ref, params, day, created_at FROM recognition_events WHERE day >= $1 AND day <= $2 ORDER BY day DESC, id DESC LIMIT 500`,
      [from, to],
    )
    .catch(() => ({ rows: [] as never[] }));
  return rows.map((r) => ({
    id: Number(r.id), trader: r.trader, kind: r.kind as RecognitionKind, ref: r.ref, params: r.params ?? {}, day: String(r.day), at: new Date(r.created_at).toISOString(),
  }));
}

// ─── desk feed ──────────────────────────────────────────────────────────────

/**
 * Feed items for [from, to] as `viewer` sees them. trader = the stored name, or null when names are hidden from this
 * viewer (then meta.alias = the day's alias number); meta.text = the TextItem.
 */
export function recognitionItems(
  events: readonly StoredRecognition[], viewer: Pick<FeedViewer, "name" | "staff">, lang: Lang,
  o: { hidden: ReadonlySet<string>; hideNames: boolean },
): FeedItem[] {
  const t = gamificationT.tFor(lang);
  const shown = events.filter((e) => e.trader === viewer.name || !o.hidden.has(e.trader));
  const byDay = new Map<string, string[]>();
  for (const e of shown) (byDay.get(e.day) ?? byDay.set(e.day, []).get(e.day)!).push(e.trader);
  const aliases = new Map([...byDay].map(([day, traders]) => [day, deskAliases(traders, day)]));
  const out: FeedItem[] = [];
  for (const e of shown) {
    const named = viewer.staff || !o.hideNames || e.trader === viewer.name;
    const alias = aliases.get(e.day)?.get(e.trader) ?? 0;
    const title = recognitionText(e, lang, named ? personNameFor(e.trader, lang) : t("alias", { n: alias }));
    if (!title) continue;
    out.push({
      id: `recognition:${e.id}`, kind: "recognition", cats: ["desk", "achievement"], date: e.day, at: e.at,
      trader: named ? e.trader : null, actor: null, title, subtitle: t("recognition.subtitle"), tone: "purple",
      value: null, valueFmt: null, ticker: null, href: e.trader === viewer.name ? "/ratings?tab=quests" : null, group: null, visibility: "public",
      meta: { recognition: e.kind, text: toEvent(e).text, ...(named ? {} : { alias }) },
    });
  }
  return out;
}

/** The feed source (lib/feedStream): nothing for guests. */
export async function recognitionFeed(viewer: FeedViewer, from: string, to: string, lang: Lang): Promise<FeedItem[]> {
  if (!viewer.name || !setting("gamification.enabled")) return [];
  const events = await recognitionBetween(from, to);
  if (!events.length) return [];
  const hidden = await hiddenUsers([...new Set(events.map((e) => e.trader))]);
  return recognitionItems(events, viewer, lang, { hidden, hideNames: !(await namesVisible(viewer)) });
}
