/**
 * The silence signal (job traders.silence, lib/dayState/jobDefs): once a weekday evening, every active trader's day
 * state → lib/dayState/model silenceFindings →
 *   • «молчит N дней»: ONE in-app notice to the trader's staff (assigned curator / mentor / risk manager, else every
 *     curator and admin) per silence episode — keyed by the last trade day, so a long silence is not repeated daily;
 *     skipped when the AI mentor already escalated the same silence (mentor_escalations rule «silence»);
 *   • unclosed day reviews ≥ dayState.missedReviewDays: one notice per trader and NY week.
 * The trader gets no notice: their dashboard shows the gentle «С возвращением» card instead (no guilt wording).
 * Telegram: templates exist (notifications trader_silence.*.tg), sending is OFF by default (dayState.silenceTelegram)
 * and, like the whole daily loop, only ever in production with a bot token (lib/daily/telegramGuard).
 * Notices link to /curator?write=<trader> — the curator cabinet opens «Написать» for that trader.
 */
import { logger } from "../logger";
import { setting } from "../settings/registry";
import { claimOnce, staffOrFallback } from "../notifyEvents";
import { notifyTraderTelegram, notifyUser } from "../notifyUtils";
import { renderNotification } from "../notificationText";
import { localeOfUser } from "../../i18n";
import { dailyTelegramEnabled } from "../daily/telegramGuard";
import { mondayOf } from "../curatorLogic";
import { escalationsOf, type Escalation } from "../mentor/store";
import { activeTraders, traderStates } from "./load";
import { silenceFindings, type SilenceFinding } from "./model";

export const writeLink = (trader: string) => `/curator?write=${encodeURIComponent(trader)}`;

/** Telegram for this run: the setting AND the daily-loop guard (production + bot token). Off by default. */
export function silenceTelegramOn(): boolean {
  return setting("dayState.silenceTelegram") && dailyTelegramEnabled();
}

function keyOf(f: SilenceFinding, today: string, staff: string): string {
  return f.kind === "silence" ? `trader-silence:${f.last}:${f.trader}:${staff}` : `trader-reviews:${mondayOf(today)}:${f.trader}:${staff}`;
}

function paramsOf(f: SilenceFinding) {
  return f.kind === "silence"
    ? { variant: "silence", trader: f.trader, count: f.days, lastDate: f.last }
    : { variant: "reviews", trader: f.trader, count: f.count, oldestDate: f.oldest };
}

/** The trader's own Telegram «welcome back» (template trader_silence.back.tg) — only when Telegram is on. */
async function telegramBack(f: Extract<SilenceFinding, { kind: "silence" }>): Promise<void> {
  if (!(await claimOnce(`trader-back:${f.last}:${f.trader}`))) return;
  const text = renderNotification("trader_silence", { variant: "back", trader: f.trader, count: f.days, lastDate: f.last }, await localeOfUser(f.trader))?.telegram;
  if (text) await notifyTraderTelegram(f.trader, text, { kind: "trader_silence", dedupKey: `back:${f.last}` });
}

export async function runSilenceSignal(opts: { signal?: AbortSignal; today?: string } = {}): Promise<{ traders: number; findings: number; notices: number }> {
  const names = await activeTraders();
  const states = await traderStates(names, { today: opts.today });
  const today = states[0]?.today ?? opts.today ?? "";
  const findings = silenceFindings(states, { pausedDays: setting("dayState.pausedDays"), missedReviewDays: setting("dayState.missedReviewDays") });
  const telegram = silenceTelegramOn();
  let notices = 0;
  for (const f of findings) {
    if (opts.signal?.aborted) break;
    try {
      if (f.kind === "silence") {
        const mentor: Escalation[] = await escalationsOf([f.trader], f.last).catch(() => []);
        if (mentor.some((e) => e.rule === "silence")) continue;
        if (telegram) await telegramBack(f);
      }
      for (const staff of (await staffOrFallback(f.trader)).filter((n) => n !== f.trader)) {
        if (!(await claimOnce(keyOf(f, today, staff)))) continue;
        const id = await notifyUser({
          userName: staff, type: "trader_silence", severity: "info", params: paramsOf(f), link: writeLink(f.trader),
          entityType: "trader", entityId: f.trader, actor: null, telegram: telegram || undefined,
        });
        if (id != null) notices++;
      }
    } catch (err) {
      logger.warn({ err }, "dayState: silence notice failed for one trader");
    }
  }
  return { traders: states.length, findings: findings.length, notices };
}
