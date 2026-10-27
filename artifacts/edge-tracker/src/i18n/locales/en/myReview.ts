import type { Messages } from "../../core";
import type ru from "../ru/myReview";

export default {
  title: "My review",
  description: "Your trades of the last {days}: where you earn, where you lose and one rule for tomorrow.",
  period: { aria: "Review period" },
  totals: "{trades} · {net} · {winRate} wins",
  totalsR: "{trades} · {net} · {r} · {winRate} wins",
  more: "Details",
  moreHint: "Full analytics: charts, breakdowns, psychology",
  rule: {
    title: "One rule for tomorrow",
    why: "Costliest in the period: {mistake} — {cost}, {times} over {days}",
    planSource: "Tomorrow's plan will suggest this rule — accept it with one tap.",
    toPlan: "Open tomorrow's plan",
    none: "No costly repeating mistakes — keep doing what works.",
  },
  earn: { title: "Where I earn", empty: "No groups in profit yet — a group needs at least 2 trades." },
  lose: { title: "Where I lose", empty: "No losing groups — good.", patterns: "Behaviour", patternLine: "{times} over {days}" },
  dim: { setup: "Setups", ticker: "Tickers", hour: "Entry time" },
  hour: "{from}–{to}",
  bucketAria: "{label}: {net}, {trades}",
  openTrades: "Open the trades: {label}",
  openBehavior: "Open behaviour",
  empty: {
    title: "No trades in {days}",
    description: "The review appears after the first trades from PropReports.",
  },
  loadFailed: "Could not load the review",
  times: { one: "{count} time", other: "{count} times" },
  daysN: { one: "{count} day", other: "{count} days" },
} satisfies Messages<typeof ru>;
