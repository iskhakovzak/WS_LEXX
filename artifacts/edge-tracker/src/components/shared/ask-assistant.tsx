/**
 * «Ask the assistant» — the small contextual button pages put next to what they show (trade sheet, day report,
 * what-if, analytics, playbook), and the hook a page uses to publish its context (selected trade / day / period /
 * filters) for the assistant panel. With `suggest`, a one-line suggestion chip sits next to the button (the trade
 * sheet: the floating orb is under the sheet there). Hidden for anyone without the capability assistant.use.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/auth-context";
import { assistantI18n } from "@/i18n/ns/assistant";
import { cn } from "@/lib/utils";
import { openAssistant, publishPageContext } from "@/lib/assistant/bus";
import { suggestionFor, type PageContext, type PageKey, type Starter } from "@/lib/assistant/model";
import { WsMark } from "./ws-mark";
import { SuggestionChip, useDismissed } from "./assistant-suggestion";

/** Publish this page's context while it is mounted (re-published when it changes). */
export function useAssistantContext(ctx: PageContext | null | undefined): void {
  const key = ctx ? JSON.stringify(ctx) : "";
  React.useEffect(() => {
    if (!key) return undefined;
    return publishPageContext(JSON.parse(key) as PageContext);
  }, [key]);
}

export function AskAssistantButton({ context, prompt, intent, send, className, compact, suggest }: {
  context?: PageContext;
  prompt?: string;
  intent?: Starter["intent"];
  /** Send the prompt at once (default: just prefill it). */
  send?: boolean;
  className?: string;
  /** Icon-only (tight toolbars). */
  compact?: boolean;
  /** Show this page's one-line suggestion chip next to the button (desktop widths). */
  suggest?: PageKey;
}) {
  const { user, can } = useAuth();
  const { t } = assistantI18n.useT();
  const suggestion = suggest ? suggestionFor(suggest, context) : null;
  const dismissed = useDismissed(suggestion?.id);
  if (!user || user.role === "guest" || !can("assistant.use")) return null;
  const onClick = () => openAssistant({ context, prompt, intent, send });
  const chip = suggestion && !dismissed ? <SuggestionChip suggestion={suggestion} context={context} className="hidden shadow-none [animation:none] sm:inline-flex" /> : null;
  return compact ? (
    <>
      {chip}
      <Button type="button" variant="ghost" size="icon-sm" onClick={onClick} title={t("askTitle")} aria-label={t("ask")} className={className}>
        <WsMark className="h-[18px] w-[18px]" still />
      </Button>
    </>
  ) : (
    <Button type="button" variant="outline" size="sm" onClick={onClick} title={t("askTitle")} className={cn("gap-1.5", className)}>
      <WsMark className="h-4 w-4" still />
      {t("ask")}
    </Button>
  );
}
