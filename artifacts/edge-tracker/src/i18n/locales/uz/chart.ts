import type { Messages } from "../../core";
import type ru from "../ru/chart";

export default {
  view: {
    label: "Grafik masshtabi",
    day: "Kun",
    dayTitle: "Butun savdo kuni: premarket 4:00 → postmarket 20:00 ET — D",
    trade: "Savdo",
    tradeTitle: "Savdo oynasini yaqinlashtirish — Z",
  },
  hotkeys: { day: "butun kun", trade: "savdo oynasi yaqindan" },
  bars: {
    coarse: "{tf} barlar",
    coarseTitle: "Bu kun uchun maydaroq barlar yoʻq: provayder 1 daqiqalik barlarni faqat oxirgi 30 kun, 5 daqiqaliklarni 60 kun saqlaydi. Endi savdo boʻlgan har bir kun 1 daqiqalik barlarda doimiy saqlanadi.",
  },
} satisfies Messages<typeof ru>;
