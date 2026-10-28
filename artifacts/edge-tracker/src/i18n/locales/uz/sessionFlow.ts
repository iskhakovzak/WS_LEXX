import type { Messages } from "../../core";
import type ru from "../ru/sessionFlow";

export default {
  panel: {
    title: "Takroriy kirishlar va kun oqimi",
    hint: "PropReports ijrolari boʻyicha oʻzi hisoblanadi: kun davomida tiker va tomonga nechanchi kirish, stopdan keyin quvish, kun choʻqqisidan qaytarish va minusga oʻtgandan keyin tezlashish.",
    loadFailed: "Kun oqimi yuklanmadi",
    empty: "Davrda yopilgan savdolar yoʻq.",
    col: { bucket: "Kirish", trades: "Savdolar", winRate: "Winrate", perTrade: "Savdoga", net: "Sof" },
    bucket: { "1": "Birinchi kirish", "2": "2-kirish (qayta)", "3": "3-kirish", "4+": "4-va keyingilar" },
    insight: "{bucket}: {trades} da {net} — ikkinchi qayta kirishdan keyin himoya tikerga yumshoq stop qoʻyadi.",
    allGood: "Qayta kirishlar pul turmaydi: «{max} tadan ortiq qayta kirmaslik» qoidasini saqlang.",
    chase: "Stopdan keyin quvish (premarket, ochilish, aftermarket): {trades}, sof {net}",
    noChase: "Bu davrda stopdan keyin quvish yoʻq.",
    giveback: "Choʻqqidan ≥ {threshold} stop qaytarilgan kunlar: {count}",
    givebackDay: "{day}: choʻqqi {peak}, yopildi {close} — {amount} qaytarildi ({units})",
    stopsUnit: "{value} stop",
    rUnit: "{value}R",
    greenToRed: "Minusga oʻtgandan keyin hajm yoki tezlik oshgan kunlar: {cross} dan {count}",
    greenToRedDay: "{day}: minusga oʻtgandan keyin hajm ×{size}, tezlik ×{pace}",
    toRisk: "Limitlar va himoya — «Mening riskim»",
  },
  robust: {
    col: "Top-3 siz",
    hint: "Uchta eng yaxshi savdosiz sof · mediana {median} · top-3 ulushi {share}",
    outliers: "Chetlanishlarda",
    outliersHint: "Natija uchta eng yaxshi savdoga tayangan: ularsiz {exTop3}. Bu hali edge emas.",
  },
} satisfies Messages<typeof ru>;
