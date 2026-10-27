/**
 * The page header's assistant slot (design audit, wave 2B «одна точка входа в AI»): every PageHeader ends with the one
 * desktop way into the assistant — a button that asks this screen's question (Ctrl+J opens the same panel). The design
 * system cannot import the assistant feature (layers: ds → lib only), so the shell registers the button here once
 * (components/assistant/assistant-launcher.tsx) and PageHeader renders whatever is registered. Nothing registered (tests,
 * the login screen) = nothing drawn.
 */
import * as React from "react";

type AskComponent = React.ComponentType;

let registered: AskComponent | null = null;
const listeners = new Set<() => void>();

/** Called once by the shell; a second call replaces the component (HMR). */
export function registerPageAsk(c: AskComponent | null): void {
  registered = c;
  listeners.forEach((l) => l());
}

function useRegistered(): AskComponent | null {
  return React.useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => registered,
    () => null,
  );
}

/** Rendered by PageHeader at the end of its actions; desktop only (phones keep the round orb). */
export function PageAskSlot() {
  const C = useRegistered();
  return C ? <C /> : null;
}
