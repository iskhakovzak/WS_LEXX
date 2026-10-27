/**
 * The assistant's one-line suggestion chip («Review this trade?») — on the orb, and next to the trade sheet's assistant
 * button (the orb sits under the sheet there). A click asks the question at once with the page's context; × dismisses
 * it. Dismissals (and used suggestions) are remembered per browser for that subject (trade / day / page); the orb's
 * floating hint shows at most once per session (claimSessionChip).
 */
import * as React from "react";
import { X } from "lucide-react";
import { assistantI18n } from "@/i18n/ns/assistant";
import { cn } from "@/lib/utils";
import { openAssistant } from "@/lib/assistant/bus";
import type { PageContext, Suggestion } from "@/lib/assistant/model";
import { WsMark } from "./ws-mark";

const DISMISSED_KEY = "ws_assistant_chips_dismissed";
const MAX_DISMISSED = 200;
const listeners = new Set<() => void>();

function read(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch { return []; }
}

let cache: string[] | null = null;
const snapshot = () => (cache ??= read());

export function dismissSuggestion(id: string): void {
  const next = [...snapshot().filter((x) => x !== id), id].slice(-MAX_DISMISSED);
  cache = next;
  try { localStorage.setItem(DISMISSED_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
  listeners.forEach((l) => l());
}

export function useDismissed(id: string | null | undefined): boolean {
  const list = React.useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, snapshot, () => [] as string[]);
  return !!id && list.includes(id);
}

const SESSION_KEY = "ws_assistant_chip_session";

/**
 * The floating hint over the orb shows at most once per browser session: the first subject that gets it keeps it (it
 * may re-appear on that same trade / day), every other page stays quiet until the next session. True = may show.
 */
export function claimSessionChip(id: string): boolean {
  try {
    const shown = sessionStorage.getItem(SESSION_KEY);
    if (shown && shown !== id) return false;
    if (!shown) sessionStorage.setItem(SESSION_KEY, id);
    return true;
  } catch { return true; }
}

export function SuggestionChip({ suggestion, context, className }: { suggestion: Suggestion; context?: PageContext | null; className?: string }) {
  const { t } = assistantI18n.useT();
  return (
    <div className={cn("ws-orb-chip", className)} role="status">
      <button
        type="button"
        className="inline-flex min-w-0 items-center gap-1.5 rounded-full py-1 pr-1 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => {
          dismissSuggestion(suggestion.id);
          openAssistant({ prompt: t(`chips.${suggestion.key}.prompt`), send: true, intent: suggestion.intent, context: context ?? undefined });
        }}
      >
        <WsMark className="h-3.5 w-3.5" still />
        <span className="truncate">{t(`chips.${suggestion.key}.label`)}</span>
      </button>
      <button
        type="button"
        onClick={() => dismissSuggestion(suggestion.id)}
        aria-label={t("chips.dismiss")}
        title={t("chips.dismiss")}
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-[var(--glass-hover-bg)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
