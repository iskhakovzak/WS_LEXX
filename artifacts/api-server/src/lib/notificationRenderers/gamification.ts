/**
 * Rewards catalog notifications, rendered per reader (texts: `gamification` namespace; lib/gamification/rewardsService
 * sends). The reward title is the owner's own text (data, not translated):
 *   reward_eligible   { title, itemId, grantId, season? } → the trader (link /ratings?tab=quests&rewards=1)
 *   reward_requested  { trader, title, itemId, grantId } → the trader's curator, else the admins (link /curator?rewards=1)
 *   reward_granted    { title, note?, itemId, grantId } → the trader
 *   reward_declined   { title, note?, itemId, grantId } → the trader
 */
import type { NotificationRenderer } from "../notificationText";
import { gamificationT } from "../../i18n/ns";

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

const eligible: NotificationRenderer = ({ params, lang }) => {
  const t = gamificationT.tFor(lang);
  const title = str(params.title);
  return title ? { title: t("notify.eligibleTitle", { title }), body: t("notify.eligibleBody") } : null;
};

const requested: NotificationRenderer = ({ params, lang }) => {
  const t = gamificationT.tFor(lang);
  const title = str(params.title);
  const trader = str(params.trader);
  return title && trader ? { title: t("notify.requestedTitle", { title, trader }), body: t("notify.requestedBody") } : null;
};

const decided = (granted: boolean): NotificationRenderer => ({ params, lang }) => {
  const t = gamificationT.tFor(lang);
  const title = str(params.title);
  if (!title) return null;
  const note = str(params.note);
  const k = granted ? "granted" : "declined";
  return { title: t(`notify.${k}Title`, { title }), body: note ? t(`notify.${k}BodyNote`, { note }) : t(`notify.${k}Body`) };
};

export const gamificationRenderers: Record<string, NotificationRenderer> = {
  reward_eligible: eligible,
  reward_requested: requested,
  reward_granted: decided(true),
  reward_declined: decided(false),
};
