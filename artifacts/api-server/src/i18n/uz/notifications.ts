import type { Messages } from "../core";
import type ru from "../ru/notifications";

export default {
  mention: {
    title: "Muhokamada sizni eslatishdi",
    titleWith: "«{subject}» muhokamasida sizni eslatishdi",
    body: "{actor}: «{preview}»",
  },
  idea_submitted: {
    title: "Yangi gʻoya {idea}",
    body: "{actor}dan yangi gʻoya: {idea}",
    bodyWithSetup: "{actor}dan yangi gʻoya: {idea} — {setup}",
  },
  idea_comment: {
    title: "{ticker} gʻoyasiga izoh",
    body: "{actor} {ticker} gʻoyasiga ochiq izoh qoldirdi: «{preview}»",
    tg: "💬 <b>#{ideaId} {ticker}</b> gʻoyasiga <b>{actor}</b> ochiq izoh qoldirdi:\n\n<i>«{preview}»</i>",
  },
  idea_review: {
    status: { approved: "✅ Maʼqullandi", rejected: "❌ Rad etildi", needs_work: "🔄 Qayta ishlashga" },
    title: "{ticker} gʻoyasi — {status}",
    body: "{ticker} gʻoyasi — {status} ({actor})",
    bodyWithReason: "{ticker} gʻoyasi — {status}: {reason} ({actor})",
    tg: "<b>{ticker}</b> gʻoyangiz — {status}\n(tekshiruvchi: {actor})",
    tgWithReason: "<b>{ticker}</b> gʻoyangiz — {status}\nIzoh: <i>{reason}</i>\n(tekshiruvchi: {actor})",
  },
  academy_promotion_ready: {
    title: "Keyingi bosqichga tayyor",
    body: "{user}: «{from}» → «{to}» oʻtishining barcha {total} mezoni bajarildi. Ustozga ariza yuborishingiz mumkin.",
    staffTitle: "Oʻquvchi keyingi bosqichga tayyor",
    staffBody: "{user}: «{from}» → «{to}» oʻtishining barcha {total} mezoni bajarildi.",
  },
  academy_challenge: {
    passedTitle: "Imtihon topshirildi: {name}",
    failedTitle: "Imtihon topshirilmadi: {name}",
    expiredTitle: "Imtihon muddati tugadi: {name}",
    staffTitle: "{user}: {title}",
    passedBody: { one: "{count} savdo kunida natija {net}.", other: "{count} savdo kunida natija {net}." },
  },
} satisfies Messages<typeof ru>;
