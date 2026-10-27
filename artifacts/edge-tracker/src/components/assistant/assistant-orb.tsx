/**
 * The assistant's round orb — the phone way in (design audit, wave 2B: one AI entry point). It sits above the dock on
 * phones only; from 768 px the page header's question button and Ctrl/⌘+J take its place (ws-mark.css hides it). A new
 * member sees it pulse three times once (remembered per browser), then it stays calm. No floating suggestions: the
 * screen's question lives in the page header. Hidden while the panel is open; it sits on the nav layer (z-nav), so
 * sheets and dialogs cover it.
 */
import * as React from "react";
import { assistantI18n } from "@/i18n/ns/assistant";
import { isAssistantPanelOpen, openAssistant, subscribeAssistantPanel } from "@/lib/assistant/bus";
import { WsMark } from "@/components/shared/ws-mark";

const SEEN_KEY = "ws_assistant_orb_seen";

function readSeen(): boolean {
  try { return localStorage.getItem(SEEN_KEY) === "1"; } catch { return true; }
}
function markSeen(): void {
  try { localStorage.setItem(SEEN_KEY, "1"); } catch { /* storage unavailable */ }
}

export function AssistantOrb() {
  const { t } = assistantI18n.useT();
  const panelOpen = React.useSyncExternalStore(subscribeAssistantPanel, isAssistantPanelOpen, () => false);
  const [pulse, setPulse] = React.useState(() => !readSeen());

  // The first-visit pulse runs three times (CSS), then the orb counts as seen for good.
  React.useEffect(() => {
    if (!pulse) return undefined;
    const id = window.setTimeout(() => { markSeen(); setPulse(false); }, 6000);
    return () => window.clearTimeout(id);
  }, [pulse]);

  if (panelOpen) return null;
  return (
    <div className="ws-orb z-nav print:hidden">
      <button
        type="button"
        className="ws-orb-button"
        data-pulse={pulse ? "true" : undefined}
        data-tour="assistant-orb"
        data-testid="assistant-orb"
        onClick={() => { markSeen(); setPulse(false); openAssistant({}); }}
        aria-haspopup="dialog"
        aria-label={t("orb.label")}
        title={t("orb.label")}
      >
        <WsMark className="h-5 w-5" />
      </button>
    </div>
  );
}
