import type { Messages } from "../../core";
import type ru from "../ru/askCurator";

export default {
  button: {
    limits: "Limitlarni soʻrash",
    group: "Guruhga yozishni soʻrash",
    stage: "Bosqichni soʻrash",
    plan: "Desk rejasini soʻrash",
    other: "Kuratordan soʻrash",
  },
  prefill: {
    limits: "Iltimos, risk limitlarimni belgilang",
    group: "Iltimos, meni oʻquv guruhiga yozing",
    stage: "Iltimos, bosqichimni belgilang",
    plan: "Bugun desk rejasi yoʻq — iltimos, eʼlon qiling",
    other: "",
  },
  dialogTitle: "Kuratorga soʻrov",
  dialogHint: "Kurator soʻrovni kabinetida koʻradi va bildirishnoma bilan javob beradi.",
  messageLabel: "Izoh",
  send: "Yuborish",
  cancel: "Bekor qilish",
  sent: "Soʻrov yuborildi — kurator uni kabinetida koʻradi",
  pending: "Soʻrov yuborilgan",
  pendingHint: "Kurator soʻrovni {date} dan beri koʻradi",
  failed: "Soʻrovni yuborib boʻlmadi",
  panel: {
    title: "Soʻrovlar",
    empty: "Yangi soʻrovlar yoʻq",
    kind: {
      limits: "Limitlar",
      group: "Oʻquv guruhi",
      stage: "Bosqich",
      plan: "Desk rejasi",
      other: "Boshqa",
    },
    noMessage: "Izohsiz",
    done: "Bajarildi",
    dismiss: "Yopish",
    notePh: "Treyderga javob (ixtiyoriy)",
    open: "Ochish",
    resolved: "Soʻrov yopildi — treyder bildirishnoma oladi",
    failed: "Soʻrovni yopib boʻlmadi",
  },
} satisfies Messages<typeof ru>;
