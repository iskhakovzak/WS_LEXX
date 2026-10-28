import type { Messages } from "../../core";
import type ru from "../ru/deskPulse";

export default {
  family: {
    gap_up_long: "Yuqoriga gep — long",
    gap_up_short: "Yuqoriga gep — short",
    gap_down_long: "Pastga gep — long",
    gap_down_short: "Pastga gep — short",
    flat_long: "Gepsiz — long",
    flat_short: "Gepsiz — short",
  },
  pulse: {
    title: "Desk pulsi: mavsumda nima ishlaydi",
    hint: "Deskning {days} kunlik barcha bitimlari ({from} – {to}): setap oilasi (kun gepi × tomon) × vaqt. Uchta eng yaxshi bitimsiz netto va mediana — chetdagi qiymatlar chalgʻitmasin. Kulrang kataklar — {trades} tadan kam bitim yoki {people} kishidan kam: ular baholanmaydi.",
    loadFailed: "Desk pulsini yuklab boʻlmadi",
    empty: "Oynada deskda kun arxivi bor yopilgan bitimlar yoʻq.",
    line: "Bu mavsumda: {works} — ishlaydi; {fails} — ishlamaydi.",
    lineWorks: "Bu mavsumda ishlaydi: {works}.",
    lineFails: "Bu mavsumda ishlamaydi: {fails}.",
    lineNone: "Bu mavsumda hali birorta katak yetarli tanlov toʻplamadi.",
    cellName: "{family} · {timing}",
    family: "Oila",
    cell: "{n} bit. · vinreyt {wr}",
    exTop3: "top-3 siz {value}",
    medianR: "mediana {value}",
    thin: "Maʼlumot kam: {n} bit.",
    hidden: "{people} kishidan kam — raqamlar yashirilgan",
    works: "Ishlaydi",
    fails: "Ishlamaydi",
    mixed: "Aralash",
    outliers: "Chetdagi qiymatlarda",
    unclassified: "Oilasiz (kun arxivi yoki tomon yoʻq): {total} tadan {count} bitim.",
    aria: "{family}, {timing}",
  },
} satisfies Messages<typeof ru>;
