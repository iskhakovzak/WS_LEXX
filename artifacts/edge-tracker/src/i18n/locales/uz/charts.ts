import type { Messages } from "../../core";
import type ru from "../ru/charts";

export default {
  tip: {
    day: "Kun uchun",
  },
  heat: {
    noTrades: "Savdo yoʻq",
    flat: "Nolda",
    loss: "Zarar",
    profit: "Foyda",
    scale: "Toʻyinganlik — kunning oyga nisbatan hajmi",
    week: "Hafta",
    weekTotal: "Hafta yakuni",
    keys: "Strelkalar — kunlar va haftalar boʻyicha, Home / End — hafta boshi va oxiri, Enter — kunni ochish",
    trades: "Savdolar",
    result: "Natija",
    winLoss: "Foyda / zarar",
  },
} satisfies Messages<typeof ru>;
