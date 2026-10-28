import type { Messages } from "../../core";
import type ru from "../ru/sessionFlow";

export default {
  panel: {
    title: "Re-entries and the day's flow",
    hint: "Counted from the PropReports fills by itself: which entry in a ticker and side it was, chasing after a stop, the give-back from the day's peak and speeding up after the day turned red.",
    loadFailed: "The day's flow did not load",
    empty: "No closed trades in this period.",
    col: { bucket: "Entry", trades: "Trades", winRate: "Win rate", perTrade: "Per trade", net: "Net" },
    bucket: { "1": "First entry", "2": "2nd (re-entry)", "3": "3rd", "4+": "4th and later" },
    insight: "{bucket}: {net} over {trades} — after the second re-entry the guard puts a soft stop on the ticker.",
    allGood: "Re-entries cost you nothing: keep the rule «at most {max} re-entries».",
    chase: "Chasing after a stop (pre-market, open, after-market): {trades}, {net} net",
    noChase: "No chasing after a stop in this period.",
    giveback: "Days that gave back ≥ {threshold} stops from the peak: {count}",
    givebackDay: "{day}: peak {peak}, closed {close} — gave back {amount} ({units})",
    stopsUnit: "{value} stops",
    rUnit: "{value}R",
    greenToRed: "Days with bigger size or pace after turning red: {count} of {cross}",
    greenToRedDay: "{day}: size ×{size}, pace ×{pace} after turning red",
    toRisk: "Limits and the guard — «My risk»",
  },
  timing: {
    am: "Pre-market (AM)", opg: "OPG (opening print)", open30: "9:30–10:00", day: "Day", moc: "MOC", pm: "After-market (PM)",
    opg_day: "OPG → day", overnight: "Overnight", swing: "Second day+", none: "No timing",
  },
  matrix: {
    title: "When the setup is allowed",
    hint: "Tick the timings the setup works in. A trade's timing is counted from its fills; an entry outside the matrix is flagged by the mentor in the debrief.",
    intraday: "Intraday",
    holds: "Holds",
    any: "Not restricted — any timing fits",
    count: "Allowed: {list}",
    saveFailed: "The timings were not saved",
    aria: "{timing}: allowed",
  },
  robust: {
    col: "Without top 3",
    hint: "Net without the three best trades · median {median} · top-3 share {share}",
    outliers: "Outliers",
    outliersHint: "The result rests on the three best trades: without them {exTop3}. That is not an edge yet.",
  },
} satisfies Messages<typeof ru>;
