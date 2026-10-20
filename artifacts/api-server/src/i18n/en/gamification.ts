import type { Messages } from "../core";
import type ru from "../ru/gamification";

export default {
  alias: "Trader {n}",
  recognition: {
    achievement: "{name}: achievement “{achievement}” — {tier}",
    streak: { one: "{name}: contract kept {count} day in a row", other: "{name}: contract kept {count} days in a row" },
    season_top: "{name}: place {rank} in the season “{season}”",
    mastery: "{name}: level “{level}” in the setup {setup}",
    reward: "{name} receives the reward “{title}”",
    subtitle: "Desk recognition",
    telegram: "🏆 {text}",
  },
  masteryLevel: { l0: "Novice", l1: "Apprentice", l2: "Practitioner", l3: "Expert", l4: "Master" },
  taskDone: {
    title: "{trader}: the curator task is done — please confirm",
    body: "Task: {note}",
    bodyNoNote: "Mark the task done in the curator cabinet",
  },
  notify: {
    eligibleTitle: "Reward available: “{title}”",
    eligibleBody: "Request it on the “Quests” tab — your curator will hand it over.",
    requestedTitle: "{trader} requests the reward “{title}”",
    requestedBody: "Grant or decline it in the rewards queue.",
    grantedTitle: "Reward “{title}” granted",
    grantedBody: "Congratulations — well deserved.",
    grantedBodyNote: "Congratulations! Note: {note}",
    declinedTitle: "Reward request “{title}” declined",
    declinedBody: "Ask your curator what it takes.",
    declinedBodyNote: "Note: {note}",
  },
} satisfies Messages<typeof ru>;
