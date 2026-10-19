import type { Messages } from "../../core";
import type ru from "../ru/shellExtras";

export default {
  mobile: {
    moreHint: {
      junior: "The other sections. They join the main menu from the Junior level.",
      trader: "The other sections. They join the main menu from the Trader level.",
    },
  },
  clock: {
    nextShort: { toOpen: "open", toClose: "close", toAfterEnd: "end", toPremarket: "premarket" },
  },
} satisfies Messages<typeof ru>;
