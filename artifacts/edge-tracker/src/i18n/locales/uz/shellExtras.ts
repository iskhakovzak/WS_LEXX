import type { Messages } from "../../core";
import type ru from "../ru/shellExtras";

export default {
  mobile: {
    moreHint: {
      junior: "Qolgan boʻlimlar. Ular asosiy menyuga Jun darajasidan qoʻshiladi.",
      trader: "Qolgan boʻlimlar. Ular asosiy menyuga Treyder darajasidan qoʻshiladi.",
    },
  },
  clock: {
    nextShort: { toOpen: "ochilish", toClose: "yopilish", toAfterEnd: "tugash", toPremarket: "premarket" },
  },
} satisfies Messages<typeof ru>;
