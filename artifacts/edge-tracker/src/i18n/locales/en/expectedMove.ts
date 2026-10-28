import type { Messages } from "../../core";
import type ru from "../ru/expectedMove";

export default {
  em: "EM ±{value}",
  source: {
    implied: "options",
    impliedHint: "ATM straddle of the first expiration after the report (free chain, ~15 min delayed), taken before the report",
    historical: "historical · {count} reports",
    historicalHint: "The average move on past reports from the candle archive — not what the market prices in",
  },
  levels: "{up} / {down}",
  moved: "Moved {value}",
  broken: "EM broken",
  held: "within EM",
} satisfies Messages<typeof ru>;
