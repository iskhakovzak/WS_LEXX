import type { Messages } from "../core";
import type ru from "../ru/coach";

export default {
  agenda: {
    title: "Templated 1:1 review: pace below the stage target",
    pace: "Average day {mean} (80%: {lo} … {hi}) against {pace} a day needed; {tenure} trading days at the stage.",
    paceUnknown: "{tenure} trading days at the stage; the pace is not computed yet.",
    lose: "Where they lose: {slice} — {perDay} a day (80%: {lo} … {hi})",
    earn: "Where they earn: {slice} — {perDay} a day (80%: {lo} … {hi})",
    noEdge: "No robust «earn / lose» slices yet.",
    fees: "Commissions: {pct}% of the gross result over the period.",
    close: "Agree on one action for 2 weeks and on how we will check the result.",
  },
  slice: {
    timeRange: "Entry {range}",
    timeBefore: "Entry before 8:30",
    timeAfter: "Entry after 16:00",
    session: { pre: "Premarket entry", rth: "Regular-session entry", ah: "After-hours entry" },
    state: { after_win_10: "Entry within 10 min after a winning trade", after_loss_10: "Entry within 10 min after a losing trade" },
    zone: { le_m2: "Day deep in the red", m2_m05: "Day in the red", flat: "Day near zero", p05_2: "Day in the green", ge_2: "Day well in the green" },
    seqN: "Trade #{n} of the day",
    seq45: "Trades #4–5 of the day",
    seq6: "Trade #6 and later",
    price: "Price {range}",
    side: { long: "Long", short: "Short" },
    size: { lt05: "Size below half the usual", normal: "Usual size", x2: "Size 1.5–3× the usual", x3: "Size 3× the usual or more" },
    familiar: { "0": "New ticker", "1-3": "Ticker traded 1–3 times", "4-30": "Familiar ticker", gt30: "Own ticker" },
    rapid: "Third entry or more within 15 minutes",
  },
} satisfies Messages<typeof ru>;
