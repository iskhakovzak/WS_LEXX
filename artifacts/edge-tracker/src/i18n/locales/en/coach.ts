import type { Messages } from "../../core";
import type ru from "../ru/coach";

export default {
  interventions: {
    title: "Interventions",
    description: "What the desk did for this trader. The effect appears once 40 days have passed after an action.",
    empty: "Nothing logged yet: limits, rules, focus, 1:1s, quests and concerns are logged automatically.",
    effectPending: "effect: no data yet",
    by: "{who} · {date}",
    showAll: "Show all ({count})",
    kind: {
      limit_change: "Limits changed",
      size_change: "Size changed",
      rule_added: "Rule switched on",
      rule_removed: "Rule removed",
      rule_trial: "Rule trial",
      focus_set: "Curator's focus of the day",
      one_on_one: "1:1 meeting",
      pause: "Pause",
      quest: "Curator quest",
      fee_plan: "Commission plan",
      concern_note: "Concern note",
      plateau_review: "Review: pace below target",
      scaling_decision: "Tier decision",
    },
    trigger: {
      scheduled: "scheduled",
      after_bad_period: "after a weak period",
      plateau: "pace below target",
      breach: "after a breach",
      random: "random pick",
      trader_request: "trader's request",
    },
    system: "system",
  },
} satisfies Messages<typeof ru>;
