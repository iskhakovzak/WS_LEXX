import type { Messages } from "../core";
import type ru from "../ru/insights";

export default {
  rule: {
    OPG: "Premarketda yoki ochilish auksionida kirish (09:31 gacha), 10:00 gacha chiqish",
    OPGtoDAY: "Ochilishda kirish (premarket / auksion 09:31 gacha), pozitsiya kun ichida ushlab turiladi — 10:00 dan keyin chiqish",
    Day: "Kun ichidagi savdo: 09:31 dan keyin kirish, yopilish auksioni oynasida ijro yoʻq",
    MOC: "Yopilish auksioni (IMX): disbalans oynasidagi istalgan ijro, odatda 15:50–16:00 (shu jumladan)",
    Print: "Print: butun savdo premarketda (kirish va chiqish 09:30 gacha)",
    Adjust: "Broker tuzatishi: nol hajm yoki narx, bozor savdosi emas",
    AfterMarket: "Postmarket: 16:00 dan keyin kirish yoki kun ichidagi pozitsiyadan 16:01 dan keyin chiqish",
    Overnight: "Pozitsiya sessiya yopilishidan oʻtkazilgan (keyingi kuni yoki keyinroq chiqish)",
    OPT: "Opsionlar: OCC formatidagi kontrakt belgisi (masalan, AAPL261016C00230000)",
  },
  order: "OPT → Adjust → Overnight → MOC (oynadagi istalgan ijro) → AfterMarket (kirish) → Print → OPG / OPGtoDAY → AfterMarket (chiqish) → Day",
  facet: {
    time: { before: "8:30 gacha", after: "16:00 dan keyin" },
    type: { long: "Long", short: "Short" },
    none: "Teglarsiz",
    unknown: "Maʼlumot yoʻq",
    prev: { first: "Kundagi birinchi", "after-win": "Foydadan keyin", "after-loss": "Zarardan keyin", "after-be": "Noldan keyin" },
    entry: { single: "Bitta kirish", scaled: "Qoʻshimchalar bilan", reentry: "Qayta kirish" },
    exit: { whole: "Toʻliq", partials: "Qismlab", stopped: "Stop boʻyicha" },
    hold: {
      lt1m: "< 1 daq", "1-5m": "1–5 daq", "5-15m": "5–15 daq", "15-60m": "15–60 daq", "1-4h": "1–4 soat", gt4h: "> 4 soat",
      overnight: "Overnayt",
    },
    manual: "Qoʻlda",
    result: { win: "Foyda", loss: "Zarar", be: "Nol" },
  },
  note: {
    time: "Vaqt — Nyu-York boʻyicha, savdoning birinchi kirishi va oxirgi chiqishi boʻyicha.",
    result: "Kun natijasi — savdo yopilgan sana boʻyicha sof (komissiyalardan keyin).",
    pct: "% — sof ÷ hamkorlar belgilagan ofisning yillik kapitali.",
    volume: "Hajm — barcha ijrolar boʻyicha aksiyalar / kontraktlar soni.",
  },
  bucket: {
    pre: "Premarket",
    post: "Postmarket",
  },
  insight: {
    eff: "{strategy} hajmning {volume} qismi bilan natijaning {net} qismini beradi",
    drag: "{strategy} zararda ({value}), ofis hajmining {volume} qismi",
    negMonths: { one: "{strategy} ketma-ket {count} oy zararda", other: "{strategy} ketma-ket {count} oy zararda" },
    goalDone: "{year} maqsadi ({goal}) allaqachon bajarildi: {value}",
    goalAhead: "Ofis {goal} maqsadi surʼatidan {value} oldinda",
    goalBehind: "{goal} maqsadiga yetish uchun oyiga {need} kerak — surʼatdan {gap} orqada",
    greenStreak: { one: "Ketma-ket {count} ta yashil kun", other: "Ketma-ket {count} ta yashil kun" },
    redStreak: { one: "Ketma-ket {count} ta qizil kun", other: "Ketma-ket {count} ta qizil kun" },
    drawdown: { one: "Ofis {count} savdo kunidan beri choʻqqidan {value} pastda", other: "Ofis {count} savdo kunidan beri choʻqqidan {value} pastda" },
    bestTime: "Eng yaxshi kirish vaqti — {bucket}: foydaning {share} qismi",
    ticker: "{ticker} — davr foydasining {share} qismi",
    yoy: "{prevYear} yilda shu kunga {was}, {year} yilda — {now}",
    bestMonth: "{year} yilning eng yaxshi oyi — {month}: {value}",
  },
} satisfies Messages<typeof ru>;
