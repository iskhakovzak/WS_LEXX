import type { Messages } from "../../core";
import type ru from "../ru/dayState";

export default {
  stop: {
    title: "Savdo toʻxtatilgan",
    usedOf: "{used} / {limit}",
    lift: {
      drawdown: "Bu stopni kurator drawdown tahlilidan keyin olib tashlaydi. Unga nimani tahlil qilganingiz va rejada nima oʻzgarishini yozing.",
      weekly: "Dushanba kuni, yangi hafta bilan oʻzi olinadi. Ungacha — yangi savdolar emas, tahlil.",
      stop: "Keyingi sessiyaga oʻzi olinadi. Bugun — yangi savdolar emas, tahlil.",
    },
    closed: "Bozor yopiq — stop keyingi sessiyagacha amal qiladi.",
    riskDesk: "Risk-desk",
    aria: "Stop: nima boʻldi va keyin nima",
  },
  back: {
    title: "Xush kelibsiz",
    lead: "Tanaffus — ishning odatiy qismi. Bitta kichik qadamdan boshlaylik.",
    last: "Oxirgi savdo kuni — {date}",
    never: "Hali savdolar boʻlmagan",
    step: {
      plan: "Bugungi rejani chizib chiqish",
      planHint: "Besh daqiqa: bir-ikki tiker, bitta setap va kun limiti.",
      warmup: "Trenajyorda qizish",
      warmupHint: "Kun vazifasi — bir necha daqiqa, risksiz.",
    },
    backlog: {
      one: "{count} kun tahlilsiz, {date} dan beri — vaqtingiz boʻlganda yoping",
      other: "{count} kun tahlilsiz, {date} dan beri — vaqtingiz boʻlganda yoping",
    },
    backlogCta: "Jurnal",
    aria: "Xush kelibsiz: qayerda toʻxtagansiz va bitta qadam",
  },
  newcomer: {
    title: "Ilk qadamlar",
    lead: "Edgeingiz haqidagi xulosalar {target} ta savdodan keyin paydo boʻladi — hozir {count}.",
    progressAria: "Yopilgan savdolar: {count} / {target}",
    step: {
      academy: "Akademiyadagi keyingi qadam",
      academyHint: "Qisqa dars — va birinchi nimani savdo qilish tushunarli boʻladi.",
      trainer: "Trenajyor",
      plan: "Bugungi reja",
    },
    edgeNote: "«Sizning edge» bloklari {target} ta savdodan keyin paydo boʻladi — hozir {count}.",
    aria: "Treyderning ilk qadamlari",
  },
  mentor: {
    label: "Mentor",
    stop: "avval stop: uni kurator bilan tahlil qiling, yangi savdolar kutib turadi",
    open: "Mentorni ochish",
  },
  fold: {
    show: { one: "Hammasini koʻrsatish · yana {count} blok", other: "Hammasini koʻrsatish · yana {count} blok" },
    hide: "Ortiqchasini yigʻish",
    hint: {
      stopped: "Stop paytida reja, kvestlar va seriya maqtovlari yigʻilgan.",
      paused: "Tanaffusdan keyin — faqat asosiysi. Qolgani shu yerda.",
      newcomer: "Boʻsh analitika ilk savdolargacha yigʻilgan.",
      premarket: "Ochilishdan oldin: reja, rejim, chek-in va brif birinchi.",
      session: "Sessiyada: kun, limitlar va pul qayerga ketayotgani birinchi.",
      after_session: "Yopilishdan keyin: kun tahlili birinchi.",
    },
  },
  backlogItem: {
    title: { one: "Yana {count} kun tahlilsiz", other: "Yana {count} kun tahlilsiz" },
    detail: "Eng eskisi — {date}. Birdaniga yoping yoki eskilarini oʻtkazib yuboring.",
    cta: "Jurnalga",
  },
  team: {
    col: "Holat",
    colTitle: "Kun holati: stop, jimlik (savdosiz savdo kunlari), yangi treyder",
    stopped: "Stop",
    paused: "Jim {count} kun",
    newcomer: "Yangi",
    active: "Ishda",
  },
  silent: {
    aria: "Jim qolganlar",
    title: { one: "{count} savdo kuni jim", other: "{count} savdo kuni jim" },
    last: "oxirgi savdo {date}",
    reviews: { one: "{count} kun tahlilsiz", other: "{count} kun tahlilsiz" },
    write: "Yozish",
    open: "Treyder kartasini ochish",
  },
  write: {
    title: "Yozish: {name}",
    description: "Qisqa shaxsiy xabar — treyderga saytda bildirishnoma boʻlib keladi.",
    label: "Xabar",
    prefill: "Salom! Anchadan beri savdolaring koʻrinmayapti — ishlar qanday? Biror narsa xalaqit berayotgan boʻlsa, qanday yordam bera olishimni gaplashaylik.",
    send: "Yuborish",
    cancel: "Bekor qilish",
    sent: "Xabar yuborildi",
    muted: "Treyder bunday bildirishnomalarni oʻchirib qoʻygan",
    failed: "Yuborib boʻlmadi",
  },
} satisfies Messages<typeof ru>;
