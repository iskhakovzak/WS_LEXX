import type { Messages } from "../../core";
import type ru from "../ru/dayState";

export default {
  stop: {
    title: "Trading is stopped",
    usedOf: "{used} of {limit}",
    lift: {
      drawdown: "Your curator lifts this stop after the drawdown review. Write to them what you reviewed and what changes in the plan.",
      weekly: "It lifts by itself on Monday, with the new week. Until then — review, not new trades.",
      stop: "It lifts by itself for the next session. Today — review, not new trades.",
    },
    closed: "The market is closed — the stop holds for the next session.",
    riskDesk: "Risk desk",
    aria: "Stop: what happened and what's next",
  },
  back: {
    title: "Welcome back",
    lead: "A pause is a normal part of the work. Let's start with one small step.",
    last: "Last trading day — {date}",
    never: "No trades yet",
    step: {
      plan: "Sketch today's plan",
      planHint: "Five minutes: one or two tickers, one setup and the day's limit.",
      warmup: "Warm up in the trainer",
      warmupHint: "The task of the day — a few minutes, no risk.",
    },
    backlog: {
      one: "{count} day without a review, since {date} — close it when you have time",
      other: "{count} days without a review, since {date} — close them when you have time",
    },
    backlogCta: "Journal",
    aria: "Welcome back: where you stopped and one step",
  },
  newcomer: {
    title: "First steps",
    lead: "Conclusions about your edge appear after {target} trades — now {count}.",
    progressAria: "Closed trades: {count} of {target}",
    step: {
      academy: "Next step in the Academy",
      academyHint: "A short lesson — and it is clear what to trade first.",
      trainer: "Trainer",
      plan: "Today's plan",
    },
    edgeNote: "The «Your edge» blocks appear after {target} trades — now {count}.",
    aria: "A trader's first steps",
  },
  mentor: {
    label: "Mentor",
    stop: "the stop comes first: review it with your curator, new trades can wait",
    open: "Open the mentor",
  },
  fold: {
    show: { one: "Show all · {count} more block", other: "Show all · {count} more blocks" },
    hide: "Fold the rest",
    hint: {
      stopped: "While stopped, the plan, quests and streak praise are folded.",
      paused: "After a pause — only the essentials. The rest is here.",
      newcomer: "Empty analytics is folded until the first trades.",
      premarket: "Before the open: the plan, regime, check-in and brief come first.",
      session: "In the session: the day, the limits and where the money goes come first.",
      after_session: "After the close: the day's review comes first.",
    },
  },
  backlogItem: {
    title: { one: "{count} more day without a review", other: "{count} more days without a review" },
    detail: "The oldest — {date}. Close them in one go or skip the old ones.",
    cta: "To the journal",
  },
  team: {
    col: "State",
    colTitle: "Day state: stop, silence (trading days without trades), newcomer",
    stopped: "Stop",
    paused: "Quiet {count} d",
    newcomer: "Newcomer",
    active: "Active",
  },
  silent: {
    aria: "Gone quiet",
    title: { one: "quiet for {count} trading day", other: "quiet for {count} trading days" },
    last: "last trade {date}",
    reviews: { one: "{count} day without a review", other: "{count} days without a review" },
    write: "Write",
    open: "Open the trader's card",
  },
  write: {
    title: "Write to {name}",
    description: "A short personal message — the trader gets it as an in-app notification.",
    label: "Message",
    prefill: "Hi! Haven't seen your trades for a while — how are you? If something's in the way, let's talk about how I can help.",
    send: "Send",
    cancel: "Cancel",
    sent: "Message sent",
    muted: "The trader turned these notifications off",
    failed: "Could not send",
  },
} satisfies Messages<typeof ru>;
