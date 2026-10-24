import type { Messages } from "../core";
import type ru from "../ru/coach";

export default {
  agenda: {
    title: "Shablon boʻyicha 1:1 tahlil: surʼat bosqich uchun kerakligidan past",
    pace: "Oʻrtacha kun {mean} (80%: {lo} … {hi}), kerakli — kuniga {pace}; bosqichda {tenure} savdo kuni.",
    paceUnknown: "Bosqichda {tenure} savdo kuni; surʼat hali hisoblanmagan.",
    lose: "Qayerda yoʻqotadi: {slice} — kuniga {perDay} (80%: {lo} … {hi})",
    earn: "Qayerda topadi: {slice} — kuniga {perDay} (80%: {lo} … {hi})",
    noEdge: "Barqaror «topadi / yoʻqotadi» kesimlari hali yoʻq.",
    fees: "Komissiyalar: davr uchun yalpi natijaning {pct}%.",
    close: "2 haftaga bitta harakat va natijani qanday tekshirishimiz haqida kelishib olish.",
  },
  slice: {
    timeRange: "Kirish {range}",
    timeBefore: "8:30 gacha kirish",
    timeAfter: "16:00 dan keyin kirish",
    session: { pre: "Premarketda kirish", rth: "Asosiy sessiyada kirish", ah: "Yopilgandan keyin kirish" },
    state: { after_win_10: "Foydali savdodan keyin 10 daqiqa ichida kirish", after_loss_10: "Zararli savdodan keyin 10 daqiqa ichida kirish" },
    zone: { le_m2: "Kun chuqur minusda", m2_m05: "Kun minusda", flat: "Kun nolga yaqin", p05_2: "Kun plyusda", ge_2: "Kun katta plyusda" },
    seqN: "Kundagi №{n} savdo",
    seq45: "Kundagi №4–5 savdolar",
    seq6: "№6 va undan keyingi savdo",
    price: "Narx {range}",
    side: { long: "Long", short: "Short" },
    size: { lt05: "Hajm odatdagining yarmidan kam", normal: "Odatiy hajm", x2: "Hajm odatdagidan 1,5–3×", x3: "Hajm odatdagidan 3× va koʻproq" },
    familiar: { "0": "Yangi tiker", "1-3": "1–3 marta savdo qilingan tiker", "4-30": "Tanish tiker", gt30: "Oʻz tikeri" },
    rapid: "15 daqiqada uchinchi va undan koʻp kirish",
  },
} satisfies Messages<typeof ru>;
