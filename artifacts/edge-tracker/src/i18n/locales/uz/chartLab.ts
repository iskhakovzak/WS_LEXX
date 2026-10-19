import type { Messages } from "../../core";
import type ru from "../ru/chartLab";

export default {
  title: { page: "Grafik va tahlil" },
  result: { moveTitle: "Kirishdan chiqishgacha narx harakati", win: "foyda", loss: "zarar", grossTitle: "Sof. Yalpi {gross}, komissiyalar {fees}" },
  picker: {
    aria: "Savdoni tanlash",
    placeholder: "Tiker, kun (2026-10-14) yoki ikkalasi",
    searchAria: "Savdoni qidirish",
    openTickerDay: "{ticker} grafigini {date} uchun savdosiz ochish",
    loadFailed: "Yuklab boʻlmadi: {message}",
    nothing: "Hech narsa topilmadi. Savdosiz grafik uchun tiker va kunni kiriting: AAPL 2026-10-14",
    noTrades: "Savdolar yoʻq.",
    long: "long",
    short: "short",
    othersInR: "Boshqalarning savdolari R da, dollarsiz.",
    searching: "Qidirilmoqda…",
    pick: "Savdoni tanlash",
  },
  openInTrades: "«Savdolar»da ochish",
  openInTradesAria: "Savdoni «Savdolar»da ochish",
  dayReview: "Shu kun tahlili",
  empty: {
    title: "Savdoni tanlang",
    description: "Savdoni tiker yoki kun boʻyicha toping yoki istalgan tikerning kunlik grafigini oching: butun kun grafikda, sham-sham replay, ijrolaringiz va asosiy sathlar.",
    recent: "Soʻnggi savdolar",
    trainer: "«Trenajyor»da mashq qilish",
  },
  unavailable: "#{id} savdo mavjud emas",
  notFound: "Topilmadi",
} satisfies Messages<typeof ru>;
