import type { Messages } from "../core";
import type ru from "../ru/notifications";

export default {
  mention: {
    title: "Mentioned in a discussion",
    titleWith: "Mentioned in the discussion “{subject}”",
    body: "{actor}: “{preview}”",
  },
  idea_submitted: {
    title: "New idea {idea}",
    body: "New idea from {actor}: {idea}",
    bodyWithSetup: "New idea from {actor}: {idea} — {setup}",
  },
  idea_comment: {
    title: "Comment on idea {ticker}",
    body: "Public comment on idea {ticker} from {actor}: “{preview}”",
    tg: "💬 Public comment on idea <b>#{ideaId} {ticker}</b> from <b>{actor}</b>:\n\n<i>“{preview}”</i>",
  },
  idea_review: {
    status: { approved: "✅ Approved", rejected: "❌ Rejected", needs_work: "🔄 Needs work" },
    title: "Idea {ticker} — {status}",
    body: "Idea {ticker} — {status} (by {actor})",
    bodyWithReason: "Idea {ticker} — {status}: {reason} (by {actor})",
    tg: "Your idea <b>{ticker}</b> — {status}\n(reviewer: {actor})",
    tgWithReason: "Your idea <b>{ticker}</b> — {status}\nComment: <i>{reason}</i>\n(reviewer: {actor})",
  },
  academy_promotion_ready: {
    title: "Ready for promotion",
    body: "{user}: all {total} criteria for “{from}” → “{to}” are met. You can submit a request to your mentor.",
    staffTitle: "Student ready for promotion",
    staffBody: "{user}: all {total} criteria for “{from}” → “{to}” are met.",
  },
  academy_challenge: {
    passedTitle: "Challenge passed: {name}",
    failedTitle: "Challenge failed: {name}",
    expiredTitle: "Challenge expired: {name}",
    staffTitle: "{user}: {title}",
    passedBody: { one: "Result {net} over {count} trading day.", other: "Result {net} over {count} trading days." },
  },
} satisfies Messages<typeof ru>;
