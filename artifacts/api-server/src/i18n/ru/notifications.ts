/**
 * Server `notifications`: texts of notifications stored as type + params (lib/notificationText.ts renderNotification).
 * Rendered in the reader's language (in-app list: request language; Telegram: recipient's users.locale).
 * Params are data: names, tickers, setup names and stage names are never translated. Keys `tg*` are Telegram HTML
 * (params are HTML-escaped before rendering).
 */
export default {
  mention: {
    title: "Упоминание в обсуждении",
    titleWith: "Упоминание в обсуждении «{subject}»",
    body: "{actor}: «{preview}»",
  },
  idea_submitted: {
    title: "Новая идея {idea}",
    body: "Новая идея от {actor}: {idea}",
    bodyWithSetup: "Новая идея от {actor}: {idea} — {setup}",
  },
  idea_comment: {
    title: "Комментарий к идее {ticker}",
    body: "Публичный комментарий к идее {ticker} от {actor}: «{preview}»",
    tg: "💬 Публичный комментарий к идее <b>#{ideaId} {ticker}</b> от <b>{actor}</b>:\n\n<i>«{preview}»</i>",
  },
  idea_review: {
    status: { approved: "✅ Одобрена", rejected: "❌ Отклонена", needs_work: "🔄 На доработку" },
    title: "Идея {ticker} — {status}",
    body: "Идея {ticker} — {status} (от {actor})",
    bodyWithReason: "Идея {ticker} — {status}: {reason} (от {actor})",
    tg: "Твоя идея <b>{ticker}</b> — {status}\n(ревьюер: {actor})",
    tgWithReason: "Твоя идея <b>{ticker}</b> — {status}\nКомментарий: <i>{reason}</i>\n(ревьюер: {actor})",
  },
  academy_promotion_ready: {
    title: "Готов к переводу",
    body: "{user}: все {total} критериев перевода «{from}» → «{to}» выполнены. Можно подать заявку наставнику.",
    staffTitle: "Ученик готов к переводу",
    staffBody: "{user}: все {total} критериев перевода «{from}» → «{to}» выполнены.",
  },
  academy_challenge: {
    passedTitle: "Экзамен сдан: {name}",
    failedTitle: "Экзамен провален: {name}",
    expiredTitle: "Срок экзамена истёк: {name}",
    staffTitle: "{user}: {title}",
    passedBody: { one: "Итог {net} за {count} торговый день.", few: "Итог {net} за {count} торговых дня.", many: "Итог {net} за {count} торговых дней.", other: "Итог {net} за {count} торгового дня." },
  },
} as const;
