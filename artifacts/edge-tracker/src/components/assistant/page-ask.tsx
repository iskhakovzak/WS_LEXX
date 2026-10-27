/**
 * The one desktop way into the assistant (design audit, wave 2B): a button at the end of every page header that asks
 * this screen's question — «Где мой edge и где утечки?» on /analytics, «Разобрать этот день?» on /day-report, «Как
 * прошёл этот период?» on /stats … — with the page's published context (period, trader, day, trade). A screen without
 * its own question gets «Спросить WS». Ctrl/⌘+J and the header ✦ open the same panel; phones use the round orb. No
 * floating hints or toasts: the question lives here, where the eye already reads the page's actions.
 * Registered into the design system's PageHeader slot by assistant-launcher.tsx (ds cannot import features).
 */
import * as React from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/auth-context";
import { assistantI18n } from "@/i18n/ns/assistant";
import { getPageContext, openAssistant, subscribePageContext, type OpenRequest } from "@/lib/assistant/bus";
import { headerQuestionOf, pageKeyOf, suggestionFor } from "@/lib/assistant/model";
import { WsMark } from "@/components/shared/ws-mark";
import { ASSISTANT_KEYS } from "./keys";

export function PageAskButton() {
  const { user, can } = useAuth();
  const { t } = assistantI18n.useT();
  const [location] = useLocation();
  const published = React.useSyncExternalStore(subscribePageContext, getPageContext, () => null);
  if (!user || user.role === "guest" || !can("assistant.use")) return null;

  const page = pageKeyOf(location, published);
  const q = headerQuestionOf(location, page, suggestionFor(page, published));
  const label = q.kind === "chip" ? t(`chips.${q.key}.label`) : q.kind === "header" ? t(`headerAsk.${q.key}.label`) : q.kind === "starter" ? t(`starters.${q.key}.a`) : t("orb.label");
  const req: OpenRequest = q.kind === "chip"
    ? { prompt: t(`chips.${q.key}.prompt`), send: true, intent: q.intent }
    : q.kind === "header"
      ? { prompt: t(`headerAsk.${q.key}.prompt`), send: true, intent: "analysis" }
      : q.kind === "starter"
        ? { prompt: t(`starters.${q.key}.a`), intent: q.intent }
        : {};
  const title = t("openTitle", { keys: ASSISTANT_KEYS });
  return (
    <button
      type="button"
      onClick={() => openAssistant({ ...req, ...(published ? { context: published } : {}) })}
      onPointerEnter={() => { void import("./panel").catch(() => {}); }}
      aria-haspopup="dialog"
      aria-keyshortcuts="Control+J Meta+J"
      title={title}
      data-testid="page-ask"
      className="glass-field hidden h-9 max-w-[22rem] items-center gap-2 rounded-full pl-2.5 pr-2 text-sm font-medium text-foreground transition-colors duration-[var(--dur-1)] hover:bg-[var(--glass-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:inline-flex print:hidden"
    >
      <WsMark className="h-4 w-4 shrink-0" still />
      <span className="min-w-0 truncate">{label}</span>
      <kbd className="hidden shrink-0 rounded-md border border-border/60 px-1.5 py-px font-sans text-2xs font-medium text-muted-foreground xl:inline">{ASSISTANT_KEYS}</kbd>
    </button>
  );
}
