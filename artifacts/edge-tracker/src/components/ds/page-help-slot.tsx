/**
 * The page header's «?» slot (owner, 2026-10-30: every tool explains itself): PageHeader draws whatever the shell
 * registered here — the help button of the page the URL belongs to (components/help-mount.tsx → lib/help/registry).
 * The design system cannot import the help feature (layers: ds → lib only), the same way as the assistant's slot
 * (./page-ask-slot.tsx). Nothing registered (tests, the login screen) = nothing drawn.
 */
import * as React from "react";

type HelpComponent = React.ComponentType;

let registered: HelpComponent | null = null;
const listeners = new Set<() => void>();

/** Called once by the shell; a second call replaces the component (HMR). */
export function registerPageHelp(c: HelpComponent | null): void {
  registered = c;
  listeners.forEach((l) => l());
}

function useRegistered(): HelpComponent | null {
  return React.useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => registered,
    () => null,
  );
}

/** Rendered by PageHeader first among its actions. */
export function PageHelpSlot() {
  const C = useRegistered();
  return C ? <C /> : null;
}
