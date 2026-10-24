/**
 * «Ассистент WS» — the app-wide hooks of the panel, framework-free:
 *   openAssistant({ prompt?, intent?, send?, context? })   any button / the palette / Ctrl+J opens the panel
 *   publishPageContext(ctx)                                a page says what is on screen (selected trade, day, period,
 *                                                          filters) — the panel sends it as structured context
 * The panel (components/assistant) listens; nothing here imports React.
 */
import type { PageContext, Starter } from "./model";

export const ASSISTANT_OPEN_EVENT = "ws-assistant-open";

export type OpenRequest = {
  /** Text put into the composer (sent at once with `send`). */
  prompt?: string;
  intent?: Starter["intent"];
  send?: boolean;
  /** Extra context of the button that opened it (merged over the page's published context). */
  context?: PageContext;
};

export function openAssistant(req: OpenRequest = {}): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<OpenRequest>(ASSISTANT_OPEN_EVENT, { detail: req }));
}

let current: { owner: symbol; ctx: PageContext } | null = null;
const listeners = new Set<() => void>();

/** Publish the page's context; returns the function that withdraws it (only if it is still the current one). */
export function publishPageContext(ctx: PageContext): () => void {
  const owner = Symbol("page-context");
  current = { owner, ctx };
  listeners.forEach((l) => l());
  return () => {
    if (current?.owner !== owner) return;
    current = null;
    listeners.forEach((l) => l());
  };
}

export function getPageContext(): PageContext | null {
  return current?.ctx ?? null;
}

export function subscribePageContext(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

// ─── is the panel open (the orb hides while it is) ─────────────────────────

let panelOpen = false;
const openListeners = new Set<() => void>();

export function setAssistantPanelOpen(v: boolean): void {
  if (panelOpen === v) return;
  panelOpen = v;
  openListeners.forEach((l) => l());
}

export function isAssistantPanelOpen(): boolean {
  return panelOpen;
}

export function subscribeAssistantPanel(listener: () => void): () => void {
  openListeners.add(listener);
  return () => { openListeners.delete(listener); };
}
