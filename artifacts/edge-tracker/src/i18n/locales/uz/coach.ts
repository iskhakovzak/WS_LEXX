import type { Messages } from "../../core";
import type ru from "../ru/coach";

export default {
  fees: {
    title: "Komissiyalar",
    share: "{days} savdo kunida komissiyalar gross ning {pct} qismini oldi",
    noGross: "{days} savdo kunida komissiyalar {fees}, gross {gross}: foydasiz toʻlangan.",
    bandLoses: "{band} aksiyalarda komissiyaga gross daromaddan koʻproq toʻlaysiz.",
    bandThin: "{band} aksiyalarda gross komissiyadan atigi {ratio}× koʻp — zaxira deyarli yoʻq.",
    action: "Qoidani tekshirish: narx ≥ ${min}",
    actionTitle: "«Agar» sahifasini savdolaringizda «${min} dan arzon aksiyalarni olmaslik» qoidasi bilan ochadi",
    bandsAria: "Narx diapazonlari boʻyicha bir aksiyaga komissiya va gross",
    bandRow: "{band}: gross {gps}/aksiya, komissiya {fps}/aksiya (×{ratio})",
  },
  breakeven: {
    title: "Vinreyt va zararsizlik",
    line: "Vinreyt {wr} · zararsiz {be} · zaxira {margin} p.p.",
    hint: "Oʻrtacha foydangiz {avgWin} va zararingiz {avgLoss} boʻlganda {be} vinreytda nolga chiqasiz. {days} savdo kuni, komissiyadan keyin sof.",
    few: "Savdolar kam: {days} savdo kunida kamida 5 ta foydali va 5 ta zararli savdo kerak.",
  },
  plan: {
    title: "Tarif: agar (faqat xodimlar uchun)",
    description: "Shu savdolarning boshqa broker tarifidagi komissiyalari. Tarif boʻyicha qarorni desk egasi qabul qiladi.",
    perShare: "Bir aksiya uchun, $",
    minPerOrder: "Order uchun min., $",
    ecnPerShare: "ECN bir aksiya uchun, $",
    run: "Hisoblash",
    result: "Davr uchun sof {delta}: komissiyalar {before} → {after}",
    failed: "Hisoblab boʻlmadi",
  },
} satisfies Messages<typeof ru>;
