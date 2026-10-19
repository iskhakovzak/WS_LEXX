import type { Messages } from "../../core";
import type ru from "../ru/chartLab";

export default {
  title: { page: "Chart & review" },
  result: { moveTitle: "Price move from entry to exit", win: "win", loss: "loss", grossTitle: "Net. Gross {gross}, fees {fees}" },
  picker: {
    aria: "Pick a trade",
    placeholder: "Ticker, day (2026-10-14) or both",
    searchAria: "Search trades",
    openTickerDay: "Open the {ticker} chart for {date} without a trade",
    loadFailed: "Couldn't load: {message}",
    nothing: "Nothing found. For a chart without a trade, type a ticker and a day: AAPL 2026-10-14",
    noTrades: "No trades.",
    long: "long",
    short: "short",
    othersInR: "Others' trades are shown in R, without dollars.",
    searching: "Searching…",
    pick: "Pick a trade",
  },
  openInTrades: "Open in Trades",
  openInTradesAria: "Open the trade in Trades",
  dayReview: "Review of this day",
  empty: {
    title: "Pick a trade",
    description: "Find a trade by ticker or day, or open any ticker's chart for a day: the whole day on the chart, a bar-by-bar replay, your fills and the key levels.",
    recent: "Latest trades",
    trainer: "Practice in the Trainer",
  },
  unavailable: "Trade #{id} is unavailable",
  notFound: "Not found",
} satisfies Messages<typeof ru>;
