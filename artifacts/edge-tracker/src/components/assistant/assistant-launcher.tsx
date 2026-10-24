/**
 * The header button of «Ассистент WS» + its app-wide ways in: Ctrl/⌘+J (no other binding in the app or the shell uses
 * it; checked by key code so the Russian layout works too), the palette action and the «Спросить ассистента» buttons
 * (openAssistant in lib/assistant/bus.ts). On phones the header has no room for it (the market clock): the palette
 * action and the page buttons open it there; the panel itself mounts here either way. The panel is a lazy chunk mounted on the first open. Hidden for guests and
 * for anyone without the capability assistant.use (roles matrix).
 */
import * as React from "react";
import { Sparkles } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { assistantI18n } from "@/i18n/ns/assistant";
import { cn } from "@/lib/utils";
import { ASSISTANT_OPEN_EVENT, type OpenRequest } from "@/lib/assistant/bus";

const AssistantPanel = React.lazy(() => import("./panel"));

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const ASSISTANT_KEYS = IS_MAC ? "⌘J" : "Ctrl+J";

export function AssistantButton({ className }: { className?: string }) {
  const { user, can } = useAuth();
  const { t } = assistantI18n.useT();
  const allowed = !!user && user.role !== "guest" && can("assistant.use");
  const [open, setOpen] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);
  const [request, setRequest] = React.useState<(OpenRequest & { n: number }) | null>(null);

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
        className={cn("chip relative grid h-10 w-10 shrink-0 place-items-center text-primary focus-visible:ring-2 focus-visible:ring-ring", className)}
      >
        <Sparkles className="h-4 w-4" aria-hidden="true" />
      </button>
      {mounted ? (
        <React.Suspense fallback={null}>
          <AssistantPanel open={open} onOpenChange={setOpen} request={request} />
        </React.Suspense>
      ) : null}
    </>
  );
}
