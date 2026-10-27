/**
 * Assistant — the slide-over panel (right sheet on desktop, full-screen sheet on phones; the backdrop dims the page,
 * motion follows the system's reduced-motion setting). It knows the page it was opened on: the route plus whatever the
 * page published (selected trade / day / period / filters, lib/assistant/bus.ts), sent as structured context.
 * Lazy chunk: loaded on the first open (assistant-launcher.tsx).
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { assistantI18n } from "@/i18n/ns/assistant";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { getPageContext, subscribePageContext, type OpenRequest } from "@/lib/assistant/bus";
import { budgetLeftPct, pageKeyOf, type PageContext, type Starter } from "@/lib/assistant/model";
import { statusQuery } from "./api";
import { useAssistantChat } from "./use-assistant-chat";
import { Starters, Thread } from "./thread";
import { Composer } from "./composer";
import { Unavailable } from "./not-configured";
import { WsMark } from "@/components/shared/ws-mark";
import { BoostSwitch, BudgetExhausted, BudgetMeter } from "./boost";

function currentRoute(location: string): string {
  return `${location}${typeof window !== "undefined" ? window.location.search : ""}`.slice(0, 300);
}

export default function AssistantPanel({ open, onOpenChange, request }: { open: boolean; onOpenChange: (v: boolean) => void; request: (OpenRequest & { n: number }) | null }) {
  const { t } = assistantI18n.useT();
  const [location] = useLocation();
  const isMobile = useIsMobile();
  const status = useQuery({ ...statusQuery(), enabled: open });
  const ready = !!status.data?.allowed;
  const chat = useAssistantChat(open && ready);
  const published = React.useSyncExternalStore(subscribePageContext, getPageContext, () => null);
  const [text, setText] = React.useState("");
  const [boost, setBoost] = React.useState(false);
  const [confirmClear, setConfirmClear] = React.useState(false);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const extra = React.useRef<{ context?: PageContext; intent?: Starter["intent"] }>({});

  const contextNow = React.useCallback((): PageContext => ({ ...(published ?? {}), ...(extra.current.context ?? {}), route: currentRoute(location) }), [published, location]);
  const page = pageKeyOf(location, contextNow());

  const send = React.useCallback((question: string, intent?: Starter["intent"]) => {
    if (!question.trim()) return;
    void chat.send(question, { boost, intent: intent ?? extra.current.intent, context: contextNow() });
    setText("");
    setBoost(false); // the boost is for one question
    extra.current = { context: extra.current.context };
  }, [chat, boost, contextNow]);

  // A request from a page button / the palette: prefill (and maybe send) once per request.
  const handled = React.useRef(0);
  React.useEffect(() => {
    if (!open || !request || handled.current === request.n || !ready) return;
    handled.current = request.n;
    extra.current = { context: request.context, intent: request.intent };
    if (request.prompt && request.send) send(request.prompt, request.intent);
    else if (request.prompt) setText(request.prompt);
  }, [open, request, ready, send]);

  // Focus the box on open; keep the newest message in view while it streams.
  React.useEffect(() => { if (open && ready) window.setTimeout(() => inputRef.current?.focus(), 60); }, [open, ready]);
  const last = chat.messages[chat.messages.length - 1];
  // Opening (or the history arriving) shows the newest message, not the top of the thread.
  React.useEffect(() => {
    if (!open || chat.loading) return;
    const id = window.setTimeout(() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; }, 50);
    return () => window.clearTimeout(id);
  }, [open, chat.loading]);
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTop = el.scrollHeight;
  }, [last?.text, last?.chips.length, last?.drafts.length, chat.messages.length]);

  const s = status.data;
  const budget = s?.budget;
  const exhausted = !!budget && budget.limit > 0 && !budget.left;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className={cn("flex flex-col gap-0 overflow-hidden p-0 data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:duration-[420ms] data-[state=open]:ease-[cubic-bezier(0.2,0.9,0.2,1)]", isMobile ? "w-full max-w-none border-l-0" : "w-full sm:max-w-[30rem]")}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <header className="overlay-bar overlay-bar-top flex shrink-0 items-center gap-2 px-4 pb-3 pr-14 pt-[max(1rem,env(safe-area-inset-top))]">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-foreground text-background"><WsMark className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <SheetTitle className="truncate text-base">{t("name")}</SheetTitle>
            <SheetDescription className="truncate text-2xs">{s?.mock ? t("mock") : t("subtitle")}</SheetDescription>
          </div>
          {ready && chat.messages.length ? (
            confirmClear ? (
              <Button size="sm" variant="destructive" onClick={() => { setConfirmClear(false); void chat.clear(); }} onBlur={() => setConfirmClear(false)} title={t("clearConfirm")}>
                {t("clear")}?
              </Button>
            ) : (
              <Button size="icon-sm" variant="ghost" onClick={() => setConfirmClear(true)} title={t("clear")} aria-label={t("clear")}><Trash2 aria-hidden="true" /></Button>
            )
          ) : null}
        </header>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
          {status.isLoading ? <p className="text-sm text-muted-foreground">{t("thinking")}</p>
            : s && !s.allowed ? <Unavailable status={s} />
            : chat.messages.length ? <Thread messages={chat.messages} onRetry={(q) => send(q)} onNavigate={() => { if (isMobile) onOpenChange(false); }} />
            : <Starters page={page} onPick={(q, st) => send(q, st.intent)} />}
        </div>

        {ready ? (
          <footer className="overlay-bar overlay-bar-bottom shrink-0 space-y-2 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
            {exhausted ? <BudgetExhausted /> : null}
            <Composer value={text} onChange={setText} onSend={() => send(text)} onStop={chat.stop} busy={chat.busy} inputRef={inputRef} />
            <div className="flex items-center justify-between gap-2 px-1">
              <BoostSwitch on={boost} onChange={setBoost} multiplier={budget?.multiplier ?? 5} disabled={exhausted} />
              <BudgetMeter pct={budgetLeftPct(budget)} />
            </div>
          </footer>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
