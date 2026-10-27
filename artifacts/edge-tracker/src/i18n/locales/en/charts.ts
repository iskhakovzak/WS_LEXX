import type { Messages } from "../../core";
import type ru from "../ru/charts";

export default {
  tip: {
    day: "Day",
  },
  heat: {
    noTrades: "No trades",
    flat: "Break-even",
    loss: "Loss",
    profit: "Profit",
    scale: "Intensity: size of the day relative to the month",
    week: "Week",
    weekTotal: "Week total",
    keys: "Arrows move by day and week, Home / End jump to the week's start and end, Enter opens the day",
    trades: "Trades",
    result: "Result",
    winLoss: "Wins / losses",
  },
} satisfies Messages<typeof ru>;
