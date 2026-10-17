import type { Messages } from "../../core";
import type ru from "../ru/chart";

export default {
  view: {
    label: "Chart zoom",
    day: "Day",
    dayTitle: "The whole trading day: premarket 4:00 → after-hours 20:00 ET — D",
    trade: "Trade",
    tradeTitle: "Zoom into the trade window — Z",
  },
  hotkeys: { day: "whole day", trade: "zoom into the trade" },
  bars: {
    coarse: "{tf} bars",
    coarseTitle: "No finer bars exist for this day: the data provider keeps 1-minute bars for 30 days and 5-minute bars for 60. From now on every trading day with trades is stored in 1-minute bars permanently.",
  },
} satisfies Messages<typeof ru>;
