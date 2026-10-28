import type { Messages } from "../../core";
import type ru from "../ru/expectedMove";

export default {
  em: "EM ±{value}",
  source: {
    implied: "opsionlar",
    impliedHint: "Hisobotdan keyingi birinchi ekspiratsiyaning ATM-streddli (bepul zanjir, ~15 daq. kechikish), hisobotdan oldin olingan",
    historical: "tarixiy · {count} hisobot",
    historicalHint: "Shamlar arxividan oʻtgan hisobotlardagi oʻrtacha harakat — bozor kutayotgani emas",
  },
  levels: "{up} / {down}",
  moved: "Fakt {value}",
  broken: "EM buzildi",
  held: "EM ichida",
} satisfies Messages<typeof ru>;
