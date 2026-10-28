/**
 * Live leak guard notices (lib/leakGuard/notify.ts), rendered per reader (texts: `notifications` namespace,
 * `leak_guard.*`):
 *   trader   { patternCode, levelCode, usd ($ preformatted), minutes?, until? (HH:MM New York) }
 *   ignored  { trader, patternCode, reasonCode: noAck | traded, minutes }
 *   risk     { trader, patternCode, usd, until? }
 * Names are data (shown as this reader sees them).
 */
import type { NotificationRenderer } from "../notificationText";
import { personNameFor } from "../people/latinNames";

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const leakGuard: NotificationRenderer = ({ params, lang, tr, variant }) => {
  const pattern = str(params.patternCode);
  if (!pattern) return null;
  const what = tr(`leak_guard.pattern.${pattern}`);
  if (!what) return null;
  const until = str(params.until);
  const minutes = typeof params.minutes === "number" ? params.minutes : 0;
  const usd = str(params.usd) ?? "";
  let title: string | undefined;
  let body: string | undefined;
  // Rule patterns (reentry, green_to_red, open_window, idea_limit) name a ticker, an entry count or a $ limit.
  const ticker = str(params.ticker) ?? "";
  const entries = typeof params.entries === "number" ? params.entries : 0;
  const limit = str(params.limit) ?? "";
  if (variant === "trader") {
    title = tr(`leak_guard.trader.${pattern}.title`, { minutes, until: until ?? "", ticker, entries, limit });
    const level = str(params.levelCode);
    const tail = level ? tr(`leak_guard.level.${level}`) : undefined;
    body = [tr(`leak_guard.trader.${pattern}.body`, { usd, ticker, entries, limit }), tail].filter(Boolean).join(" ");
  } else {
    const trader = str(params.trader);
    if (!trader) return null;
    const who = personNameFor(trader, lang);
    if (variant === "ignored") {
      title = tr("leak_guard.ignored.title", { trader: who });
      body = tr(`leak_guard.ignored.${str(params.reasonCode) === "traded" ? "traded" : "noAck"}`, { trader: who, pattern: what, minutes });
    } else if (variant === "risk") {
      title = tr(until ? "leak_guard.risk.title" : "leak_guard.risk.titleDay", { trader: who, until: until ?? "" });
      body = tr("leak_guard.risk.body", { pattern: what, usd });
    }
  }
  if (!title) return null;
  return { title, body: body ?? "", telegram: body ? `<b>${esc(title)}</b>\n${esc(body)}` : `<b>${esc(title)}</b>` };
};

export const leakGuardRenderers: Record<string, NotificationRenderer> = {
  leak_guard: leakGuard,
};
