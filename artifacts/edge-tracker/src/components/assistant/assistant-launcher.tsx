/**
 * The assistant's ways in: the header button (the WS mark), the floating orb (assistant-orb.tsx: «Ask WS» +
 * the shortcut, suggestions on pages with an «ask» context), Ctrl/⌘+J (no other binding in the app or the shell uses
 * it; checked by key code so the Russian layout works too), the palette action and the page buttons (openAssistant in
 * lib/assistant/bus.ts). On phones the header has no room for the button (the market clock): the orb above the dock,
 * the palette and the page buttons open it there. The panel is a lazy chunk mounted on the first open and mounts here
 * either way. Hidden for guests and for anyone without the capability assistant.use (roles matrix).
 */
import * as React from "react";
import { useAuth } from "@/contexts/auth-context";
import { assistantI18n } from "@/i18n/ns/assistant";
import { cn } from "@/lib/utils";
import { ASSISTANT_OPEN_EVENT, setAssistantPanelOpen, type OpenRequest } from "@/lib/assistant/bus";
import { WsMark } from "@/components/shared/ws-mark";
import { AssistantOrb } from "./assistant-orb";
import { ASSISTANT_KEYS } from "./keys";

export { ASSISTANT_KEYS } from "./keys";

const AssistantPanel = React.lazy(() => import("./panel"));

export function AssistantButton({ className }: { className?: string }) {
  const { user, can } = useAuth();
  const { t } = assistantI18n.useT();
  const allowed = !!user && user.role !== "guest" && can("assistant.use");
  const [open, setOpen] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);
  const [request, setRequest] = React.useState<(OpenRequest & { n: number }) | null>(null);

  React.useEffect(() => { setAssistantPanelOpen(open); }, [open]);

  React.useEffect(() => {
    if (!allowed) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === "KeyJ") {
        e.preventDefault();
        setMounted(true);
        setOpen((v) => !v);
      }
    };
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<OpenRequest>).detail ?? {};
      setMounted(true);
      setRequest((r) => ({ ...detail, n: (r?.n ?? 0) + 1 }));
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(ASSISTANT_OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(ASSISTANT_OPEN_EVENT, onOpen);
    };
  }, [allowed]);

  if (!allowed) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => { setMounted(true); setOpen(true); }}
        onPointerEnter={() => { void import("./panel").catch(() => {}); }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-keyshortcuts="Control+J Meta+J"
        title={t("openTitle", { keys: ASSISTANT_KEYS })}
        aria-label={t("openTitle", { keys: ASSISTANT_KEYS })}
        data-tour="assistant"
        className={cn("chip relative grid h-10 w-10 shrink-0 place-items-center text-foreground focus-visible:ring-2 focus-visible:ring-ring", className)}
      >
        <WsMark className="h-5 w-5" />
      </button>
      <AssistantOrb />
      {mounted ? (
        <React.Suspense fallback={null}>
          <AssistantPanel open={open} onOpenChange={setOpen} request={request} />
        </React.Suspense>
      ) : null}
    </>
  );
}
