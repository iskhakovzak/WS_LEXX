/**
 * The assistant's floating orb: «Ask WS» + the shortcut, bottom-right on desktop, a round orb above the dock on
 * phones. Inviting, not a banner: a new member sees it pulse three times once (remembered per browser), then it stays
 * calm (a slow sheen, the mark's breathing core). On a page with an «ask» context it offers ONE one-line suggestion
 * (lib/assistant/model suggestionFor: «Review this trade?», «Review this day?»…) after a short pause; the suggestion
 * is dismissible and a dismissal is remembered for that trade / day (suggestion-chip.tsx). Hidden while the panel is
 * open; it sits on the nav layer (z-nav), so sheets and dialogs cover it.
 */
import * as React from "react";
import { useLocation } from "wouter";
import { assistantI18n } from "@/i18n/ns/assistant";
import { getPageContext, isAssistantPanelOpen, openAssistant, subscribeAssistantPanel, subscribePageContext } from "@/lib/assistant/bus";
import { pageKeyOf, suggestionFor } from "@/lib/assistant/model";
import { WsMark } from "@/components/shared/ws-mark";
import { SuggestionChip, useDismissed } from "@/components/shared/assistant-suggestion";
import { ASSISTANT_KEYS } from "./keys";

const SEEN_KEY = "ws_assistant_orb_seen";
const CHIP_DELAY_MS = 1400;

function readSeen(): boolean {
  try { return localStorage.getItem(SEEN_KEY) === "1"; } catch { return true; }
}
function markSeen(): void {
  try { localStorage.setItem(SEEN_KEY, "1"); } catch { /* storage unavailable */ }
}

export function AssistantOrb() {
  const { t } = assistantI18n.useT();
  const [location] = useLocation();
  const panelOpen = React.useSyncExternalStore(subscribeAssistantPanel, isAssistantPanelOpen, () => false);
  const published = React.useSyncExternalStore(subscribePageContext, getPageContext, () => null);
  const suggestion = suggestionFor(pageKeyOf(location, published), published);
  const dismissed = useDismissed(suggestion?.id);
  const [pulse, setPulse] = React.useState(() => !readSeen());
  const [chipReady, setChipReady] = React.useState(false);

  // The suggestion appears after a short pause on the page (not with the first paint), once per subject.
  const sid = suggestion?.id ?? "";
  React.useEffect(() => {
    setChipReady(false);
    if (!sid) return undefined;
    const id = window.setTimeout(() => setChipReady(true), CHIP_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [sid]);

  // The first-visit pulse runs three times (CSS), then the orb counts as seen for good.
  React.useEffect(() => {
    if (!pulse) return undefined;
    const id = window.setTimeout(() => { markSeen(); setPulse(false); }, 6000);
    return () => window.clearTimeout(id);
  }, [pulse]);

  if (panelOpen) return null;
  return (
    <div className="ws-orb z-nav print:hidden">
      {suggestion && chipReady && !dismissed ? <SuggestionChip suggestion={suggestion} context={published} /> : null}
      <button
        type="button"
        className="ws-orb-button"
        data-pulse={pulse ? "true" : undefined}
        data-tour="assistant-orb"
        data-testid="assistant-orb"
        onClick={() => { markSeen(); setPulse(false); openAssistant({}); }}
        aria-haspopup="dialog"
        aria-keyshortcuts="Control+J Meta+J"
        aria-label={t("openTitle", { keys: ASSISTANT_KEYS })}
        title={t("openTitle", { keys: ASSISTANT_KEYS })}
      >
        <WsMark className="h-5 w-5" />
        <span className="ws-orb-label text-sm font-medium">{t("orb.label")}</span>
        <kbd className="ws-orb-keys">{ASSISTANT_KEYS}</kbd>
      </button>
    </div>
  );
}
