/**
 * Onboarding host (mounted once by the layout through components/onboarding-mount.tsx): starts the per-user store,
 * runs the guided tour on the dashboard when it is due (after the welcome intro has gone, never over an open dialog),
 * notices the checklist's «seen» steps (the playbook opened, a trade card opened — `data-onboarding-seen`), and hosts
 * «Помощь» (opened by OPEN_HELP_EVENT or the «?» key outside text fields).
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/auth-context";
import { onboardingI18n } from "@/i18n/ns/onboarding";
import {
  HINT_IDS, HINT_PAGES, isNewcomer, seenFromPath, shouldStartTour, tourRole, tourSteps, type HintId, type SeenKey, type TourStep,
} from "@/lib/onboarding/model";
import {
  OPEN_HELP_EVENT, finishTour, getOnboarding, markSeen, reopenHint, requestTour, startOnboarding, useOnboarding,
} from "@/lib/onboarding/store";
import { Tour } from "./tour";
import type { GoShortcut } from "./help-hub";

const HelpHub = lazy(() => onboardingI18n.ready().then(() => import("./help-hub")));
const PHONE = "(max-width: 767px)";
/** After the intro has gone and the dashboard has painted. */
const START_DELAY_MS = 900;

function isTyping(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}

const busy = () => !!document.querySelector("[data-welcome-intro], [role='dialog'][data-state='open'], [role='alertdialog']");

export function OnboardingHost({ canOpen, goKeys }: { canOpen: (href: string) => boolean; goKeys: GoShortcut[] }) {
  const { user, isCurator, permissions } = useAuth();
  const guest = !user || user.role === "guest";
  const me = guest ? null : user?.traderName ?? null;
  const [location, navigate] = useLocation();
  const ob = useOnboarding();
  const [steps, setSteps] = useState<TourStep[] | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpMounted, setHelpMounted] = useState(false);
  const autoTried = useRef(false);
  const handledRequest = useRef(0);

  useEffect(() => { startOnboarding(me, { guest }); autoTried.current = false; }, [me, guest]);

  const buildSteps = useCallback(() => {
    const phone = window.matchMedia?.(PHONE).matches ?? false;
    // The server's effective role and ladder tier (GET /api/permissions/me), the session role until it answers.
    return tourSteps(tourRole(permissions.role ?? user?.role, permissions.tier), phone, canOpen);
  }, [permissions.role, user?.role, permissions.tier, canOpen]);

  // Start once the screen is calm: no intro, no open dialog, the dashboard painted. One pending start at a time; it
  // survives re-renders (status refreshes) and is cancelled only by a newer start or unmount.
  const pending = useRef<(() => void) | null>(null);
  const pathRef = useRef("/");
  const startWhenCalm = useCallback(() => {
    pending.current?.();
    let timer = 0;
    let cancelled = false;
    const attempt = (left: number) => {
      if (cancelled) return;
      if (busy() && left > 0) { timer = window.setTimeout(() => attempt(left - 1), 400); return; }
      pending.current = null;
      // Left the dashboard meanwhile: try again on the next visit to it.
      if (pathRef.current !== "/") { autoTried.current = false; return; }
      setSteps(buildSteps());
    };
    timer = window.setTimeout(() => attempt(40), START_DELAY_MS);
    pending.current = () => { cancelled = true; window.clearTimeout(timer); };
  }, [buildSteps]);
  useEffect(() => () => pending.current?.(), []);

  // Automatic first-visit tour.
  const path = location.split("?")[0];
  pathRef.current = path;
  const statusKnown = ob.mode === "force" || ob.state.again === true || !!ob.status;
  useEffect(() => {
    if (autoTried.current || !me || !ob.ready || !statusKnown || steps) return;
    const input = { mode: ob.mode, stage: ob.status?.stage ?? null, state: ob.state, path, search: window.location.search };
    if (!shouldStartTour(input)) return;
    autoTried.current = true;
    startWhenCalm();
  }, [me, ob.ready, ob.mode, ob.status, ob.state, statusKnown, path, steps, startWhenCalm]);

  // «Пройти знакомство заново»: to the dashboard, then the tour.
  useEffect(() => {
    if (!ob.tourRequest || ob.tourRequest === handledRequest.current) return;
    if (path !== "/") { navigate("/"); return; }
    handledRequest.current = ob.tourRequest;
    setSteps(null);
    startWhenCalm();
  }, [ob.tourRequest, path, navigate, startWhenCalm]);

  // «Первые шаги» signals the web notices: the playbook opened, a trade card opened.
  const watching = !!me && isNewcomer({ mode: ob.mode, stage: ob.status?.stage ?? null, state: ob.state }) && ob.state.checklist == null;
  useEffect(() => {
    if (!watching) return;
    const k = seenFromPath(path);
    if (k) markSeen(k);
  }, [watching, path]);
  useEffect(() => {
    if (!watching) return;
    const check = () => {
      for (const el of document.querySelectorAll("[data-onboarding-seen]")) {
        const key = el.getAttribute("data-onboarding-seen");
        if ((key === "trade" || key === "playbook") && !getOnboarding().state.seen?.includes(key)) markSeen(key as SeenKey);
      }
    };
    const mo = new MutationObserver(check);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [watching]);

  // «Помощь»: the event (user menu, palette) and the «?» key.
  useEffect(() => {
    const open = () => { setHelpMounted(true); setHelpOpen(true); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "?" || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || isTyping(e.target) || busy()) return;
      e.preventDefault();
      open();
    };
    window.addEventListener(OPEN_HELP_EVENT, open);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener(OPEN_HELP_EVENT, open); window.removeEventListener("keydown", onKey); };
  }, []);

  const hints = useMemo(
    () => HINT_IDS.filter((id) => (!HINT_PAGES[id].staff || isCurator) && !(id === "risk" && isCurator) && canOpen(HINT_PAGES[id].href)),
    [isCurator, canOpen],
  );
  const onHint = useCallback((id: HintId) => {
    setHelpOpen(false);
    navigate(HINT_PAGES[id].href);
    window.setTimeout(() => reopenHint(id), 0);
  }, [navigate]);
  const onRestart = useCallback(() => { setHelpOpen(false); requestTour(); }, []);

  const onFinish = useCallback((kind: "done" | "skipped") => { setSteps(null); finishTour(kind); }, []);

  return (
    <>
      {steps && steps.length > 0 && <Tour steps={steps} onFinish={onFinish} />}
      {helpMounted && (
        <Suspense fallback={null}>
          <HelpHub open={helpOpen} onOpenChange={setHelpOpen} hints={hints} goKeys={goKeys} onRestart={onRestart} onHint={onHint} />
        </Suspense>
      )}
    </>
  );
}
