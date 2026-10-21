import type { Messages } from "../../core";
import type ru from "../ru/tradeFacets";

export default {
  title: "Filters",
  aria: "Trade filters by column",
  open: "Show filters",
  close: "Hide filters",
  hidden: { one: "{count} value hidden", other: "{count} values hidden" },
  dims: {
    years: "Years",
    months: "Months",
    days: "Days",
    times: "Time",
    strategies: "Strategy",
    types: "Type",
    gtags: "Global tags",
    ptags: "Personal tags",
  },
  all: "all",
  none: "none",
  reset: "Reset",
  empty: "No trades",
  loadFailed: "Couldn't load the filters",
  bucketAria: "{label}: {count} trades, {net}",
  activeAria: "Hidden filter values",
  restore: "Bring back «{label}» ({dim})",
  exclude: "Exclude «{label}»",
  include: "Bring back «{label}»",
  clickHint: "Click a row to exclude the value, click again to bring it back",
  single: "Single value:",
  imx: {
    toggle: "Exclude IMX",
    hint: "IMX are closing-auction trades (any fill 15:50–16:00 New York time, tag «IMX»). By default they stay in lists and totals.",
    line: "Total {total} · of which IMX {imx}",
    lineExcluded: "Total {total} without IMX · IMX excluded: {imx}",
    trades: { one: "{count} trade", other: "{count} trades" },
  },
} satisfies Messages<typeof ru>;
