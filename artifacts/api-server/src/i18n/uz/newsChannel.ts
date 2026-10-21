/** Server `newsChannel` (lib/newsChannel/render.ts): WS_NEWS kanal xabarlari (kanal `ru` da; uz — oldindan koʻrish uchun). */
import type { Messages } from "../core";
import type ru from "../ru/newsChannel";

export default {
  title: {
    premarket: "Premarket",
    open: "Ochilishdan beri",
    close: "Kun yakuni",
  },
  section: {
    gapUp: "Yuqoriga gaplar",
    gapDown: "Pastga gaplar",
    leaders: "Mavzular: yetakchilar",
    laggards: "Mavzular: ortda qolganlar",
    earnings: "Bugungi hisobotlar",
    macro: "Bugungi makro",
    movers: "Ochilishdan beri eng kuchli harakat",
    afterHours: "Aftermarket",
  },
  earnings: {
    bmo: "Ochilishdan oldin",
    amc: "Yopilishdan keyin",
    more: "yana {count} ta",
  },
  label: {
    rvol: "RVOL {value}",
    float: "float {value}",
  },
  footer: "Saytdagi bozor mavzulari",
} satisfies Messages<typeof ru>;
