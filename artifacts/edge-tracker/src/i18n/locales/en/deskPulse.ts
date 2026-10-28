import type { Messages } from "../../core";
import type ru from "../ru/deskPulse";

export default {
  family: {
    gap_up_long: "Gap up — long",
    gap_up_short: "Gap up — short",
    gap_down_long: "Gap down — long",
    gap_down_short: "Gap down — short",
    flat_long: "No gap — long",
    flat_short: "No gap — short",
  },
  pulse: {
    title: "Desk pulse: what works this season",
    hint: "Every desk trade of {days} days ({from} – {to}): setup family (the day's gap × the side) × timing. Net without the three best trades and the median, so outliers do not mislead. Grey cells have fewer than {trades} trades or fewer than {people} people: they are not judged.",
    loadFailed: "Could not load the desk pulse",
    empty: "No closed desk trades with an archived day in the window.",
    line: "This season: {works} works; {fails} does not.",
    lineWorks: "This season works: {works}.",
    lineFails: "This season does not work: {fails}.",
    lineNone: "This season no cell has a big enough sample yet.",
    cellName: "{family} · {timing}",
    family: "Family",
    cell: "{n} tr. · win rate {wr}",
    exTop3: "ex top 3 {value}",
    medianR: "median {value}",
    thin: "Thin data: {n} tr.",
    hidden: "Fewer than {people} people — numbers hidden",
    works: "Works",
    fails: "Does not work",
    mixed: "Mixed",
    outliers: "On outliers",
    unclassified: "No family (no archived day or side): {count} of {total} trades.",
    aria: "{family}, {timing}",
  },
} satisfies Messages<typeof ru>;
