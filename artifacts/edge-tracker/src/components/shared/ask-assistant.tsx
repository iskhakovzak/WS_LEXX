/**
 * The hook a page uses to publish its context (selected trade / day / period / filters) for the assistant, and the
 * contextual button for a surface that covers the page header (the trade sheet): the page header's own question button
 * (components/assistant/page-ask.tsx) is the one desktop entry everywhere else (design audit, wave 2B). With
 * `question`, the button asks that subject's question at once («Разобрать эту сделку?»). Hidden for anyone without
 * the capability assistant.use.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/auth-context";
import { assistantI18n } from "@/i18n/ns/assistant";
import { cn } from "@/lib/utils";
import { openAssistant, publishPageContext } from "@/lib/assistant/bus";
import type { PageContext, Suggestion } from "@/lib/assistant/model";
import { WsMark } from "./ws-mark";

/** Publish this page's context while it is mounted (re-published when it changes). */
export function useAssistantContext(ctx: PageContext | null | undefined): void {
  const key = ctx ? JSON.stringify(ctx) : "";
  React.useEffect(() => {
    if (!key) return undefined;
    return publishPageContext(JSON.parse(key) as PageContext);
  }, [key]);
}

export function AskAssistantButton({ context, question, className }: {
  context?: PageContext;
  /** The subject's question as the label; a click sends it with the context. */
  question?: Suggestion["key"];
  className?: string;
}) {
  const { user, can } = useAuth();
  const { t } = assistantI18n.useT();
  if (!user || user.role === "guest" || !can("assistant.use")) return null;
  const onClick = () => openAssistant(question
    ? { context, prompt: t(`chips.${question}.prompt`), send: true, intent: "analysis" }
    : { context });
  return (
    <Button type="button" variant="outline" size="sm" onClick={onClick} title={t("askTitle")} className={cn("gap-1.5 rounded-full", className)}>
      <WsMark className="h-4 w-4" still />
      <span className="truncate">{question ? t(`chips.${question}.label`) : t("ask")}</span>
    </Button>
  );
}
