/**
 * Quest and achievement notifications, rendered per reader (texts: `quests` namespace, lib/quests/service.ts sends):
 *   quest_done          { template, scope, target, points, questId, note? (the manual task's title) } → the trader;
 *                       variant "staff" + { trader, statusCode: "done" } → the assigner of a curator quest
 *   quest_failed        variant "staff" { template, target, trader, statusCode: "failed" | "expired", questId } → the assigner
 *   quest_assigned      { template, target, points, curator, endsDate (YYYY-MM-DD), note?, questId } → the trader
 *   quest_cancelled     { template, target, curator, note?, questId } → the trader (the curator cancelled the quest)
 *   achievement_earned  { line, tier, target, name? | slice? | metric?+stage? (dynamic lines) } → the trader
 *   achievement_summary { count, line, tier, … } → the trader once, for a recount of history (no flood)
 *   kudos_received      { curator, day, note? } → the trader (a curator's kudos for a day / a trade)
 *   variant "batch" (roadmap R3, lib/notificationBatch — the nightly in-app batch instead of a ping each):
 *     quest_done { count, points, achievements }, achievement_earned { count }
 * Names and the curator's note are data.
 */
import type { NotificationRenderer } from "../notificationText";
import { questsT } from "../../i18n/ns";
import type { Lang } from "../../i18n";
import { academyPathT } from "../academyI18n";
import { sliceText } from "../sliceText";

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

function dynamicTitle(lang: Lang, line: string, p: Record<string, unknown>): string | null {
  if (line.startsWith("setup:")) return questsT.tryFor(lang, "ach.setup.title", { name: str(p.name) ?? line.slice(6) }) ?? null;
  if (line.startsWith("leak:")) return questsT.tryFor(lang, "ach.leak.title", { slice: sliceText(lang, str(p.slice) ?? line.slice(5)) }) ?? null;
  if (line.startsWith("path:")) {
    const metric = str(p.metric) ?? line.split(":")[2] ?? "";
    return questsT.tryFor(lang, "ach.path.title", { metric: academyPathT.tryFor(lang, `metrics.${metric}.label`) ?? metric }) ?? null;
  }
  return null;
}
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** A quest's title in `lang` (null for an unknown template → the stored text is shown). */
export function questTitleFor(lang: Lang, template: string | undefined, target: number | undefined): string | null {
  if (!template) return null;
  return questsT.tryFor(lang, `quest.${template}.title`, { target: target ?? 1, count: target ?? 1 }) ?? null;
}

/**
 * «Серия контракта — золото» parts in `lang` (null when unknown). Dynamic lines (achievements v2) take their subject from
 * `p`: setup:<id> { name }, leak:<slice> { slice }, path:<stage>:<metric> { metric, stage }.
 */
export function achievementNameFor(lang: Lang, line: string | undefined, tier: string | undefined, p: Record<string, unknown> = {}): { achievement: string; tier: string } | null {
  if (!line || !tier) return null;
  const achievement = dynamicTitle(lang, line, p) ?? questsT.tryFor(lang, `ach.${line}.title`);
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
  const name = achievementNameFor(lang, str(params.line), str(params.tier), params);
  if (!name) return null;
  return { title: t("notify.achievementTitle", name), body: t("notify.achievementBody") };
};

/** One notice for a recount of history: «Пересчитали достижения по истории: 12 получено» + the best one. */
const achievementSummary: NotificationRenderer = ({ params, lang }) => {
  const t = questsT.tFor(lang);
  const count = num(params.count) ?? 0;
  const name = achievementNameFor(lang, str(params.line), str(params.tier), params);
  return { title: t("notify.summaryTitle", { count }), body: name ? t("notify.summaryBody", name) : t("notify.batchTail") };
};

/** A curator's kudos for a day (and a trade of it). */
const kudosReceived: NotificationRenderer = ({ params, lang }) => {
  const t = questsT.tFor(lang);
  const curator = str(params.curator);
  if (!curator) return null;
  const note = str(params.note);
  return { title: t("notify.kudosTitle", { curator }), body: note ? t("notify.kudosBodyNote", { note }) : t("notify.kudosBody") };
};

export const questsRenderers: Record<string, NotificationRenderer> = {
  quest_done: questDone,
  quest_failed: questFailed,
  quest_assigned: questAssigned,
  quest_cancelled: questCancelled,
  achievement_earned: achievementEarned,
  achievement_summary: achievementSummary,
  kudos_received: kudosReceived,
};
