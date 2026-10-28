import type { Messages } from "../../core";
import type ru from "../ru/analystSignals";

export default {
  title: "Katalizator kuchi",
  description: "Bir tomonga baholar klasteri yoki maqsadli narxning katta oʻzgarishi — kuchli katalizator. Belgi qoʻyilgan, siz tasdiqlaysiz.",
  rule: "Klaster: {hours} soatda {count}+ firma · maqsad: {pct}+",
  reason: {
    cluster: "{count} ta firma bir tomonga",
    target: "maqsad {pct}",
  },
  direction: { bull: "Buqa", bear: "Ayiq" },
  day: { today: "bugun uchun", prev: "kecha" },
  released: "{time} NY da chiqdi",
  kind: { up: "koʻtarish", down: "tushirish", init: "qamrov", ptUp: "maqsad ↑", ptDown: "maqsad ↓" },
  inWatchlist: "Kuzatuvda",
  inPlan: "Rejada",
  marked: "Belgilangan: {mark}",
  markStrong: "Kuchli {dir}",
  markStrongAria: "{ticker} katalizatorini kuchli deb belgilash: {dir}",
  addPlan: "Rejaga",
  openWatchlist: "Kuzatuv",
  saved: "{ticker}: kuchli katalizator, {dir}",
  empty: "Bugun klasterlar va maqsadning katta oʻzgarishlari yoʻq.",
  loadFailed: "Tahlilchilar signallarini yuklab boʻlmadi",
  more: "Yana {count}",
  less: "Yigʻish",
} satisfies Messages<typeof ru>;
