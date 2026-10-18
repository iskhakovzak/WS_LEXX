import type { Messages } from "../../core";
import type ru from "../ru/simOwn";

export default {
  banner: {
    pill: "Sizning savdongiz · {ticker} · {date}",
    lead: "Shamlar kirishingiz lahzasigacha yurmoqda. Oldinroq ham kirish mumkin",
    decision: "Siz shu yerda kirgansiz. Qaytadan qaror qiling: kirish, hajm, stop — yoki oʻtkazib yuboring",
    after: "Kun endi oʻsha paytdagidek davom etadi",
  },
  chartEntry: "Kirishingiz",
  hudRiskUnit: "1R = aksiyaga {value} — haqiqiy savdodagidek",
  hudFee: "Savdongiz komissiyasi: aksiyaga {value}",
  result: {
    title: "Qanday edi va hozir qanday",
    real: "Qanday edi",
    sim: "Simulyatorda",
    trade: "{side} {qty} · {entry} → {exit}",
    skipped: "Kirmadingiz",
    simTrades: { one: "{count} ta savdo", other: "{count} ta savdo" },
    diff: {
      better: "Haqiqiy savdodan {value} yaxshiroq",
      worse: "Haqiqiy savdodan {value} yomonroq",
      same: "Deyarli haqiqatdagidek ({value})",
      skipped: "Oʻtkazib yuborish {value} tejagan boʻlardi",
    },
    risk: "1R = {value} · {source}",
    riskSource: { trade: "haqiqiy savdo riski", stop: "haqiqiy savdo stopi boʻyicha", atr: "ATR boʻyicha — savdoda risk belgilanmagan" },
    mistakeTitle: "Haqiqiy savdoda nima notoʻgʻri boʻlgan",
    noMistake: "Haqiqiy savdoda aniq xato topilmadi",
    again: "Yana bir kunim",
    deskDay: "Desk bu kuni qanday savdo qilgan",
    toStart: "Rejim tanloviga",
    legsTitle: "Haqiqiy savdongiz",
    cols: { role: "Harakat", time: "Vaqt ET", price: "Narx", qty: "Aksiya" },
    deskTitle: "Shu kungi {ticker} savdolaringiz",
  },
  progressLabel: "Mening kunim",
  errors: {
    noBars: "Bu savdo uchun saqlangan 1 daqiqalik shamlar yoʻq",
    notReplayable: "Bu savdoni qayta oʻynab boʻlmaydi: oʻsha kun shamlari bor oʻz zararli intraday savdongiz boʻlishi kerak",
    noOwnTrades: "Hozircha qayta oʻynaydigan narsa yoʻq: shamlari bor zararli savdolaringiz yoʻq",
  },
  sheet: {
    replay: "Bu kunni qayta oʻynash",
    replayHint: "Simulyator: kirish lahzasigacha borib, qaytadan qaror qilish",
    continue: "{ticker} oʻyinini davom ettirish",
    continueHint: "Bu kun boʻyicha oʻyin tugamagan — toʻxtagan joydan davom ettirish",
  },
} satisfies Messages<typeof ru>;
