import type { Messages } from "../../core";
import type ru from "../ru/analystSignals";

export default {
  title: "Catalyst strength",
  description: "A cluster of calls in one direction or a big price-target change is a strong catalyst. The mark is filled in, you confirm it.",
  rule: "Cluster: {count}+ firms within {hours} h · target: {pct}+",
  reason: {
    cluster: "{count} firms the same way",
    target: "target {pct}",
  },
  direction: { bull: "Bullish", bear: "Bearish" },
  day: { today: "for today", prev: "yesterday" },
  released: "Out at {time} NY",
  kind: { up: "upgrade", down: "downgrade", init: "initiation", ptUp: "target ↑", ptDown: "target ↓" },
  inWatchlist: "On watchlist",
  inPlan: "In plan",
  marked: "Marked: {mark}",
  markStrong: "Strong {dir}",
  markStrongAria: "Mark the {ticker} catalyst strong: {dir}",
  addPlan: "To plan",
  openWatchlist: "Watchlist",
  saved: "{ticker}: strong catalyst, {dir}",
  empty: "No clusters or big target changes today.",
  loadFailed: "Could not load the analyst signals",
  more: "{count} more",
  less: "Collapse",
} satisfies Messages<typeof ru>;
