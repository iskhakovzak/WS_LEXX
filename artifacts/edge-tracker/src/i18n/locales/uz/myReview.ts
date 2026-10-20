import type { Messages } from "../../core";
import type ru from "../ru/myReview";

export default {
  title: "Mening tahlilim",
  description: "Soʻnggi {days} kundagi savdolaringiz: qayerda topasiz, qayerda yoʻqotasiz va ertaga uchun bitta qoida.",
  period: { aria: "Tahlil davri", d30: "30 kun", d90: "90 kun" },
  totals: "{trades} · {net} · {winRate} yutuq",
  totalsR: "{trades} · {net} · {r} · {winRate} yutuq",
  more: "Batafsil",
  moreHint: "Toʻliq tahlil: grafiklar, kesimlar, psixologiya",
  rule: {
    title: "Ertaga uchun bitta qoida",
    why: "Davrdagi eng qimmati: {mistake} — {cost}, {days} ichida {times}",
    planSource: "Bu qoidani ertangi reja taklif qiladi — bir bosishda qabul qiling.",
    toPlan: "Ertangi rejani ochish",
    none: "Takrorlanuvchi qimmat xatolar yoʻq — ishlayotganini davom ettiring.",
  },
  earn: { title: "Qayerda topaman", empty: "Hozircha foydadagi guruh yoʻq — guruhda kamida 2 ta savdo kerak." },
  lose: { title: "Qayerda yoʻqotaman", empty: "Zarardagi guruhlar yoʻq — yaxshi.", patterns: "Xulq-atvor", patternLine: "{days} ichida {times}" },
  dim: { setup: "Setaplar", ticker: "Tikerlar", hour: "Kirish vaqti" },
  hour: "{from}–{to}",
  bucketAria: "{label}: {net}, {trades}",
  openTrades: "Savdolarni ochish: {label}",
  openBehavior: "Xulq-atvorni ochish",
  empty: {
    title: "{days} kun ichida savdo yoʻq",
    description: "Tahlil PropReports'dan birinchi savdolar kelgach paydo boʻladi.",
  },
  loadFailed: "Tahlilni yuklab boʻlmadi",
  times: { one: "{count} marta", other: "{count} marta" },
  daysN: { one: "{count} kun", other: "{count} kun" },
} satisfies Messages<typeof ru>;
