import type { Messages } from "../../core";
import type ru from "../ru/shareCard";

export default {
  button: "Rasm",
  buttonTitle: "Doʻstlar bilan ulashish uchun savdo rasmi",
  rowAria: "{ticker} savdosi rasmi",
  title: "Savdo rasmi",
  description: "Doʻstlaringiz uchun {ticker} kartasi. Brauzerda chiziladi va hech qayerga yuklanmaydi.",
  previewAlt: "{ticker} savdosi rasmining koʻrinishi",
  drawing: "Chizilmoqda…",
  themes: {
    label: "Fon",
    olymp: "Olimp",
    marble: "Marmar",
    night: "Tun",
    photo: "Oʻz rasmingiz",
  },
  art: {
    prev: "Oldingi kartina",
    next: "Keyingi kartina",
    position: "{n} / {total}",
    pick: "Kartina: {credit}",
  },
  photo: {
    pick: "Rasm tanlash",
    change: "Boshqa rasm",
    hint: "Rasm shu qurilmada qoladi va hech qayerga yuklanmaydi.",
    failed: "Bu rasmni ochib boʻlmadi",
  },
  result: {
    label: "Natija",
    usd: "Sof P&L, $",
    r: "R da",
    pct: "Pozitsiyadan %",
    rOnly: "Deskda rasmlardagi $ summalari yashirilgan.",
  },
  toggles: {
    showName: "Ismni koʻrsatish",
    showPrices: "Narxlarni koʻrsatish",
  },
  chart: {
    fallback: "Bu kun uchun daqiqalik shamlar yoʻq — rasmda kirishdan chiqishgacha toʻgʻri chiziq.",
    none: "Shamlar ham, narxlar ham yoʻq — rasm grafiksiz.",
  },
  actions: {
    download: "PNG yuklab olish",
    copy: "Nusxalash",
    share: "Ulashish",
  },
  toast: {
    downloaded: "Rasm saqlandi",
    copied: "Rasm nusxalandi — uni chatga qoʻying",
    copyUnsupported: "Bu brauzer rasmlarni nusxalay olmaydi. «PNG yuklab olish»ni bosing.",
    copyFailed: "Rasmni nusxalab boʻlmadi",
    shareFailed: "Ulashib boʻlmadi. PNG ni yuklab olib, fayl sifatida yuboring.",
    renderFailed: "Rasmni chizib boʻlmadi",
  },
} satisfies Messages<typeof ru>;
