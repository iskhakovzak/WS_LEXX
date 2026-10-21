/** Server `newsChannel` (lib/newsChannel/render.ts): WS_NEWS channel briefs (the channel posts `ru`; en for preview parity). */
import type { Messages } from "../core";
import type ru from "../ru/newsChannel";

export default {
  title: {
    premarket: "Premarket",
    open: "From the open",
    close: "Day recap",
  },
  section: {
    gapUp: "Gapping up",
    gapDown: "Gapping down",
    leaders: "Themes: leaders",
    laggards: "Themes: laggards",
    earnings: "Earnings today",
    macro: "Macro today",
    movers: "Biggest moves from the open",
    afterHours: "After hours",
  },
  earnings: {
    bmo: "Before the open",
    amc: "After the close",
    more: "and {count} more",
  },
  label: {
    rvol: "RVOL {value}",
    float: "float {value}",
  },
  footer: "Market themes on the site",
} satisfies Messages<typeof ru>;
