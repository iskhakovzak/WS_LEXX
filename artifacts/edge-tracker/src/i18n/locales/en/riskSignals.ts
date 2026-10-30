import type { Messages } from "../../core";
import type ru from "../ru/riskSignals";

export default {
  signals: {
    stop_proximity: "Close to the stop",
    loss_streak: "Losing streak",
    revenge: "Trading back after a loss",
    off_plan: "Off plan",
    banned_window: "News window",
  },
  severity: { warn: "Heads-up", critical: "Critical" },
  title: {
    stop_proximity: "{pct}% of the daily stop used",
    revenge_size: "Bigger than usual right after a loss",
    revenge_pace: "Fast entries right after a loss",
    loss_streak: "Losing trades in a row: {losses}",
    off_plan: "{ticker} is off today's plan",
    banned_window: "Entry in the {time} news window",
  },
  body: {
    stop_proximity: "Day loss {loss} of the {limit} limit. Size down or stop before the stop does it for you.",
    revenge_size: "After a {loss} loss — an entry {ratio}× your usual position ({median}). Pause, then your normal size.",
    revenge_pace: "After a {loss} loss: {entries} entries in {minutes} min, you usually make about {usual}. Take a pause.",
    loss_streak: "Losing streak — {loss} in total. Take a pause before the next entry.",
    off_plan: "{ticker} is not in your plan for today.",
    banned_window: "{ticker}: an entry next to {event} ({time} NY). Entries around high-impact news are not allowed.",
  },
  strip: {
    aria: "Session risk alerts",
    staffTold: "Your curator and the risk manager know.",
    seen: "Got it",
    seenFailed: "Could not mark it — try again",
    more: "More alerts today: {count}",
  },
  desk: {
    title: "Session risk alerts",
    description: "Today's alerts across the desk: 70 and 90% of the daily stop, losing streaks, trading back after a loss, off-plan trades, entries in a news window. Critical ones go to the curator and the risk manager at once.",
    empty: "No alerts today.",
    disabled: "Risk alerts are off in the desk settings.",
    told: "Told",
    listAria: "Alerts today",
  },
  saved: {
    title: "Desk saved — an estimate vs your history",
    periodAria: "Period",
    period: { day: "Day", week: "Week", month: "Month" },
    better: "After the alerts traders did {usd} better than they usually do after the same situations on past days.",
    worse: "After the alerts traders did {usd} worse than they usually do after the same situations on past days.",
    sample: "Alerts in the estimate: {estimated}; similar past days: {cases}.",
    hidden: "No estimate — too little history: {hidden}.",
    pending: "Counted after the session (30 minutes after the close).",
    small: "Not enough history to compare yet: at least {min} similar past days are needed.",
    none: "No alerts in this period.",
    method: "How: what the trader did in the rest of the session after the alert, minus their own average rest of the session after the same situation on past days without an alert. An estimate, not a fact; it can be negative.",
    bySignalAria: "By signal",
  },
} satisfies Messages<typeof ru>;
