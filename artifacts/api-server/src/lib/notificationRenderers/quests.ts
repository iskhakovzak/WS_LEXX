/**
 * Quest and achievement notifications, rendered per reader (texts: `quests` namespace, lib/quests/service.ts sends):
 *   quest_done          { template, scope, target, points, questId, note? (the manual task's title) } → the trader;
 *                       variant "staff" + { trader, statusCode: "done" } → the assigner of a curator quest
 *   quest_failed        variant "staff" { template, target, trader, statusCode: "failed" | "expired", questId } → the assigner
 *   quest_assigned      { template, target, points, curator, endsDate (YYYY-MM-DD), note?, questId } → the trader
 *   quest_cancelled     { template, target, curator, note?, questId } → the trader (the curator cancelled the quest)
 *   achievement_earned  { line, tier, target } → the trader
 *   variant "batch" (roadmap R3, lib/notificationBatch — the nightly in-app batch instead of a ping each):
 *     quest_done { count, points, achievements }, achievement_earned { count }
 * Names and the curator's note are data.
 */
import type { NotificationRenderer } from "../notificationText";
import { questsT } from "../../i18n/ns";
import type { Lang } from "../../i18n";

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** A quest's title in `lang` (null for an unknown template → the stored text is shown). */
export function questTitleFor(lang: Lang, template: string | undefined, target: number | undefined): string | null {
  if (!template) return null;
  return questsT.tryFor(lang, `quest.${template}.title`, { target: target ?? 1, count: target ?? 1 }) ?? null;
}

/** «Серия контракта — золото» parts in `lang` (null when unknown). */
export function achievementNameFor(lang: Lang, line: string | undefined, tier: string | undefined): { achievement: string; tier: string } | null {
  if (!line || !tier) return null;
  const achievement = questsT.tryFor(lang, `ach.${line}.title`);
  const tierName = questsT.tryFor(lang, `tier.${tier}`);
  return achievement && tierName ? { achievement, tier: tierName } : null;
}

/** The manual task's own words (its note) are its title; other quests use the template's title. */
const titleOf = (lang: Lang, params: Record<string, unknown>) =>
  (str(params.template) === "curator_task" && str(params.note)) || questTitleFor(lang, str(params.template), num(params.target));

const questDone: NotificationRenderer = ({ params, lang, variant }) => {
  const t = questsT.tFor(lang);
  if (variant === "batch") {
    const count = num(params.count) ?? 0, points = num(params.points) ?? 0, ach = num(params.achievements) ?? 0;
    const parts = [points > 0 ? t("notify.batchPoints", { points }) : null, ach > 0 ? t("notify.batchAch", { count: ach }) : null].filter(Boolean);
    return { title: t("notify.batchQuestsTitle", { count }), body: [...parts, t("notify.batchTail")].join(" · ") };
  }
  const quest = titleOf(lang, params);
  if (!quest) return null;
  if (variant === "staff") {
    const trader = str(params.trader);
    if (!trader) return null;
    return { title: t("notify.staffDoneTitle", { trader, quest }), body: t("notify.staffBody.done") };
  }
  const points = num(params.points) ?? 0;
  return { title: t("notify.doneTitle", { quest }), body: points > 0 ? t("notify.doneBody", { points }) : t("notify.doneBodyNoPoints") };
};

const questFailed: NotificationRenderer = ({ params, lang }) => {
  const t = questsT.tFor(lang);
  const quest = titleOf(lang, params);
  const trader = str(params.trader);
  if (!quest || !trader) return null;
  const status = str(params.statusCode) === "failed" ? "failed" : "expired";
  return { title: t("notify.staffFailedTitle", { trader, quest }), body: t(`notify.staffBody.${status}`) };
};

const questAssigned: NotificationRenderer = ({ params, lang, date }) => {
  const t = questsT.tFor(lang);
  const note = str(params.note);
  const quest = titleOf(lang, params);
  const curator = str(params.curator);
  const ends = str(params.endsDate);
  if (!quest || !curator || !ends) return null;
  const p = { curator, ends: date(ends), points: num(params.points) ?? 0 };
  const manual = str(params.template) === "curator_task";
  return { title: t("notify.assignedTitle", { quest }), body: note && !manual ? t("notify.assignedBodyNote", { ...p, note }) : t("notify.assignedBody", p) };
};

const questCancelled: NotificationRenderer = ({ params, lang }) => {
  const t = questsT.tFor(lang);
  const quest = titleOf(lang, params);
  const curator = str(params.curator);
  if (!quest || !curator) return null;
  return { title: t("notify.cancelledTitle", { quest }), body: t("notify.cancelledBody", { curator }) };
};

const achievementEarned: NotificationRenderer = ({ params, lang, variant }) => {
  const t = questsT.tFor(lang);
  if (variant === "batch") return { title: t("notify.batchAchTitle", { count: num(params.count) ?? 0 }), body: t("notify.batchTail") };
  const name = achievementNameFor(lang, str(params.line), str(params.tier));
  if (!name) return null;
  return { title: t("notify.achievementTitle", name), body: t("notify.achievementBody") };
};

export const questsRenderers: Record<string, NotificationRenderer> = {
  quest_done: questDone,
  quest_failed: questFailed,
  quest_assigned: questAssigned,
  quest_cancelled: questCancelled,
  achievement_earned: achievementEarned,
};
