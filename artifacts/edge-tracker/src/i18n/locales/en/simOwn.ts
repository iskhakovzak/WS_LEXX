import type { Messages } from "../../core";
import type ru from "../ru/simOwn";

export default {
  banner: {
    pill: "Your trade · {ticker} · {date}",
    lead: "Bars are playing up to your entry. You may enter earlier too",
    decision: "This is where you entered. Decide again: entry, size, stop — or skip it",
    after: "The day now plays on as it did",
  },
  chartEntry: "Your entry",
  hudRiskUnit: "1R = {value} per share — as in the real trade",
  hudFee: "Your trade's fee: {value} per share",
  result: {
    title: "Then and now",
    real: "What you did",
    sim: "In the simulator",
    trade: "{side} {qty} · {entry} → {exit}",
    skipped: "Stayed out",
    simTrades: { one: "{count} trade", other: "{count} trades" },
    diff: {
      better: "{value} better than the real trade",
      worse: "{value} worse than the real trade",
      same: "About the same as real ({value})",
      skipped: "Skipping would have saved {value}",
    },
    risk: "1R = {value} · {source}",
    riskSource: { trade: "risk of the real trade", stop: "from the real trade's stop", atr: "ATR-based — the trade had no risk set" },
    mistakeTitle: "What went wrong in the real trade",
    noMistake: "No clear mistake found in the real trade",
    again: "Another of my days",
    deskDay: "How the desk traded this day",
    toStart: "Back to modes",
    legsTitle: "Your real trade",
    cols: { role: "Action", time: "Time ET", price: "Price", qty: "Shares" },
    deskTitle: "Your {ticker} trades that day",
  },
  progressLabel: "My day",
  errors: {
    noBars: "No saved 1-minute candles for this trade",
    notReplayable: "This trade cannot be replayed: it must be your own losing intraday trade with that day's candles",
    noOwnTrades: "Nothing to replay yet: no losing trades of yours with candles",
  },
  sheet: {
    replay: "Replay this day",
    replayHint: "Simulator: play up to your entry and decide again",
    continue: "Continue {ticker}",
    continueHint: "The game on this day is not finished — continue where you stopped",
  },
} satisfies Messages<typeof ru>;
