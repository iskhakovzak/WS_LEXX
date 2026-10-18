/**
 * Rewards catalog flows (routes/gamification.ts, the nightly job, GET /api/gamification/me):
 *   syncRewards(trader, input)   eligibility of every ACTIVE item from achievements / level / finished season places /
 *                                mastery → new «eligible» grants once, each notified once (reward_eligible)
 *   requestReward(trader, item)  eligible → requested; the trader's curator (else the admins) is told (reward_requested)
 *   decideReward(grant, …)       → granted (one from the stock) | declined; the trader is told (reward_granted /
 *                                reward_declined); a granted reward is recognised in the feed
 * Notifications are type + params, rendered per reader (lib/notificationRenderers/gamification.ts).
 */
import { logger } from "../logger";
import { notifyUser, notifyUsers } from "../notifyUtils";
import { nyDate } from "../tradingDate";
import { activeAdmins, userInfo } from "./people";
import { recordRecognition } from "./recognition";
import { eligibleRefs, type EligibilityInput } from "./rewards";
import { decideGrant, insertEligible, listItems, requestGrant, type Decision } from "./rewardsStore";
import type { RewardGrant, RewardItem } from "./types";

export const TRADER_REWARDS_LINK = "/ratings?tab=quests&rewards=1";
export const STAFF_REWARDS_LINK = "/curator?rewards=1";

/** New eligibilities of the trader (inserted and notified by this call). */
export async function syncRewards(trader: string, input: EligibilityInput, items?: readonly RewardItem[]): Promise<RewardGrant[]> {
  const out: RewardGrant[] = [];
  for (const item of items ?? (await listItems({ activeOnly: true }))) {
    if (!item.active) continue;
    for (const ref of eligibleRefs(item, input)) {
      const g = await insertEligible(item.id, trader, ref).catch((err) => {
        logger.warn({ err: (err as Error)?.message, trader, item: item.id }, "rewards: eligibility insert failed");
        return null;
      });
      if (!g) continue;
      out.push(g);
      await notifyUser({
        userName: trader, type: "reward_eligible", params: { title: item.title, itemId: item.id, grantId: g.id, season: ref || null },
        link: TRADER_REWARDS_LINK, entityType: "reward_grant", entityId: String(g.id), source: "gamification",
      }).catch(() => null);
    }
  }
  return out;
}

/** Who decides a trader's reward: the assigned curator, else every active admin. */
export async function rewardDeciders(trader: string): Promise<string[]> {
  const curator = (await userInfo(trader))?.curator;
  return curator ? [curator] : activeAdmins();
}

export async function requestReward(trader: string, item: RewardItem): Promise<RewardGrant | null> {
  const g = await requestGrant(item.id, trader);
  if (!g) return null;
  await notifyUsers(await rewardDeciders(trader), {
    type: "reward_requested", actor: trader, params: { trader, title: item.title, itemId: item.id, grantId: g.id },
    link: STAFF_REWARDS_LINK, entityType: "reward_grant", entityId: String(g.id), source: "gamification",
  }, trader).catch(() => []);
  return g;
}

export async function decideReward(grant: RewardGrant, status: "granted" | "declined", by: string, note: string | null, now = new Date()): Promise<Decision> {
  const d = await decideGrant(grant.id, status, by, note);
  if (!d.ok) return d;
  const title = d.grant.title ?? "";
  await notifyUser({
    userName: grant.trader, type: status === "granted" ? "reward_granted" : "reward_declined", actor: by,
    params: { title, note, itemId: grant.itemId, grantId: grant.id }, link: TRADER_REWARDS_LINK, entityType: "reward_grant", entityId: String(grant.id), source: "gamification",
  }).catch(() => null);
  if (status === "granted") {
    await recordRecognition({ trader: grant.trader, kind: "reward", ref: `grant:${grant.id}`, params: { title, itemId: grant.itemId }, day: nyDate(now) }, now);
  }
  return d;
}
