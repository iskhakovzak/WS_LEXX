import type { Messages } from "../../core";
import type ru from "../ru/riskSignals";

export default {
  signals: {
    stop_proximity: "Stopga yaqin",
    loss_streak: "Zararlar seriyasi",
    revenge: "Zarardan keyin qaytarishga urinish",
    off_plan: "Rejadan tashqari",
    banned_window: "Yangiliklar oynasi",
  },
  severity: { warn: "Diqqat", critical: "Jiddiy" },
  title: {
    stop_proximity: "Kunlik stopning {pct}% ishlatildi",
    revenge_size: "Zarardan darhol keyin odatdagidan katta pozitsiya",
    revenge_pace: "Zarardan darhol keyin tez-tez kirishlar",
    loss_streak: "Ketma-ket zararli savdolar: {losses}",
    off_plan: "{ticker} — kun rejasidan tashqari",
    banned_window: "{time} yangiliklar oynasida kirish",
  },
  body: {
    stop_proximity: "Kun zarari {loss}, limit {limit}. Hajmni kamaytiring yoki stopdan oldin toʻxtang.",
    revenge_size: "{loss} zarardan keyin — odatdagi pozitsiyangizdan {ratio}× katta kirish ({median}). Pauza, keyin odatdagi hajm.",
    revenge_pace: "{loss} zarardan keyin: {minutes} daqiqada {entries} ta kirish, odatda sizda taxminan {usual}. Pauza qiling.",
    loss_streak: "Zararlar seriyasi — jami {loss}. Keyingi kirishdan oldin pauza qiling.",
    off_plan: "{ticker} bugungi rejangizda yoʻq.",
    banned_window: "{ticker}: {event} yonida kirish ({time} NY). Kuchli yangiliklar atrofida kirish taqiqlangan.",
  },
  strip: {
    aria: "Sessiya risk signallari",
    staffTold: "Kurator va risk-menejer xabardor.",
    seen: "Tushunarli",
    seenFailed: "Belgilab boʻlmadi — qayta urinib koʻring",
    more: "Bugun yana signallar: {count}",
  },
  desk: {
    title: "Sessiya risk signallari",
    description: "Butun desk boʻyicha kun signallari: kunlik stopning 70 va 90%, zararlar seriyasi, zarardan keyin qaytarishga urinish, rejadan tashqari savdolar, yangiliklar oynasidagi kirishlar. Jiddiylari darhol kurator va risk-menejerga yuboriladi.",
    empty: "Bugun signallar yoʻq.",
    disabled: "Risk signallari desk sozlamalarida oʻchirilgan.",
    told: "Xabar berildi",
    listAria: "Bugungi signallar",
  },
  saved: {
    title: "Desk tejadi — tarixingizga nisbatan taxmin",
    periodAria: "Davr",
    period: { day: "Kun", week: "Hafta", month: "Oy" },
    better: "Signallardan keyin treyderlar oʻtgan kunlardagi xuddi shunday vaziyatlardan keyingiga qaraganda {usd} yaxshiroq natija qildi.",
    worse: "Signallardan keyin treyderlar oʻtgan kunlardagi xuddi shunday vaziyatlardan keyingiga qaraganda {usd} yomonroq natija qildi.",
    sample: "Taxmindagi signallar: {estimated}; oʻxshash oʻtgan kunlar: {cases}.",
    hidden: "Taxminsiz — tarix kam: {hidden}.",
    pending: "Sessiyadan keyin hisoblanadi (yopilishdan 30 daqiqa oʻtib).",
    small: "Taqqoslash uchun tarix hali kam: kamida {min} ta oʻxshash oʻtgan kun kerak.",
    none: "Bu davrda signallar boʻlmadi.",
    method: "Qanday hisoblaymiz: signaldan keyin sessiyaning qolgan qismida treyder nima qildi, minus uning oʻzining oʻtgan kunlarda signalsiz xuddi shu vaziyatdan keyingi oʻrtacha natijasi. Bu taxmin, fakt emas; manfiy ham boʻlishi mumkin.",
    bySignalAria: "Signallar boʻyicha",
  },
} satisfies Messages<typeof ru>;
