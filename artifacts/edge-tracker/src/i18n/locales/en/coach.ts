import type { Messages } from "../../core";
import type ru from "../ru/coach";

export default {
  fees: {
    title: "Fees",
    share: "Fees took {pct} of the gross over {days} trading days",
    noGross: "Fees {fees} over {days} trading days with a gross of {gross}: paid without a profit.",
    bandLoses: "On {band} stocks you pay more in fees than you make gross.",
    bandThin: "On {band} stocks the gross is only {ratio}× the fees — almost no margin.",
    action: "Test a rule: price ≥ ${min}",
    actionTitle: "Opens What-if with the rule “no stocks under ${min}” on your trades",
    bandsAria: "Fees and gross per share by price band",
    bandRow: "{band}: gross {gps}/sh, fees {fps}/sh (×{ratio})",
  },
  breakeven: {
    title: "Win rate vs breakeven",
    line: "Win rate {wr} · breakeven {be} · margin {margin} pp",
    hint: "With your average win {avgWin} and loss {avgLoss} you break even at a {be} win rate. Over {days} trading days, net of fees.",
    few: "Not enough trades: at least 5 winners and 5 losers over {days} trading days are needed.",
  },
  plan: {
    title: "Commission plan: what if (staff only)",
    description: "These trades' fees under another broker plan. The plan itself is the desk owner's decision.",
    perShare: "Per share, $",
    minPerOrder: "Min per order, $",
    ecnPerShare: "ECN per share, $",
    run: "Calculate",
    result: "Net {delta} over the period: fees {before} → {after}",
    failed: "Could not calculate",
  },
} satisfies Messages<typeof ru>;
