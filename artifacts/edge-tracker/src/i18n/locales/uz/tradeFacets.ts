import type { Messages } from "../../core";
import type ru from "../ru/tradeFacets";

export default {
  title: "Filtrlar",
  aria: "Savdolarni ustunlar boʻyicha filtrlash",
  open: "Filtrlarni koʻrsatish",
  close: "Filtrlarni yashirish",
  hidden: { one: "{count} ta qiymat yashirilgan", other: "{count} ta qiymat yashirilgan" },
  dims: {
    years: "Yillar",
    months: "Oylar",
    days: "Kunlar",
    times: "Vaqt",
    strategies: "Strategiya",
    types: "Turi",
    gtags: "Umumiy teglar",
    ptags: "Shaxsiy teglar",
  },
  all: "hammasi",
  none: "hech biri",
  reset: "Tozalash",
  empty: "Savdolar yoʻq",
  loadFailed: "Filtrlarni yuklab boʻlmadi",
  bucketAria: "{label}: {count} ta savdo, {net}",
  activeAria: "Yashirilgan filtr qiymatlari",
  restore: "«{label}» ni qaytarish ({dim})",
  imx: {
    toggle: "IMX ni chiqarib tashlash",
    hint: "IMX — yopilish auksioni savdolari (Nyu-York vaqti bilan 15:50–16:00 dagi istalgan ijro, «IMX» tegi). Odatda ular roʻyxat va jamilarda qoladi.",
    line: "Jami {total} · shundan IMX {imx}",
    lineExcluded: "Jami {total} IMXsiz · IMX chiqarilgan: {imx}",
    trades: { one: "{count} ta savdo", other: "{count} ta savdo" },
  },
} satisfies Messages<typeof ru>;
