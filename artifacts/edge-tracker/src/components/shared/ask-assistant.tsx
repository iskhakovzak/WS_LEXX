/**
 * «Спросить ассистента» — the small contextual button pages put next to what they show (trade sheet, day report,
 * what-if, analytics, playbook), and the hook a page uses to publish its context (selected trade / day / period /
 * filters) for the assistant panel. Hidden for anyone without the capability assistant.use.
 */
import * as React from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/auth-context";
import { assistantI18n } from "@/i18n/ns/assistant";
import { cn } from "@/lib/utils";
import { openAssistant, publishPageContext } from "@/lib/assistant/bus";
import type { PageContext, Starter } from "@/lib/assistant/model";

/** Publish this page's context while it is mounted (re-published when it changes). */
export function useAssistantContext(ctx: PageContext | null | undefined): void {
  const key = ctx ? JSON.stringify(ctx) : "";
  React.useEffect(() => {
    if (!key) return undefined;
    return publishPageContext(JSON.parse(key) as PageContext);
  }, [key]);
}

export function AskAssistantButton({ context, prompt, intent, send, className, compact }: {
  context?: PageContext;
  prompt?: string;
  intent?: Starter["intent"];
  /** Send the prompt at once (default: just prefill it). */
  send?: boolean;
  className?: string;
  /** Icon-only (tight toolbars). */
  compact?: boolean;
}) {
  const { user, can } = useAuth();
  const { t } = assistantI18n.useT();
  if (!user || user.role === "guest" || !can("assistant.use")) return null;
  const onClick = () => openAssistant({ context, prompt, intent, send });
  return compact ? (
    <Button type="button" variant="ghost" size="icon-sm" onClick={onClick} title={t("askTitle")} aria-label={t("ask")} className={className}>
      <Sparkles aria-hidden="true" />
    </Button>
  ) : (
    <Button type="button" variant="outline" size="sm" onClick={onClick} title={t("askTitle")} className={cn("gap-1.5", className)}>
      <Sparkles aria-hidden="true" />
      {t("ask")}
    </Button>
  );
}
