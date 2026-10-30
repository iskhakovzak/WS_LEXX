/**
 * Onboarding host (mounted once by the layout through components/onboarding-mount.tsx): starts the per-user store,
 * runs the daily-loop tour on the dashboard when it is due (once per user and stage — lib/onboarding/model
 * shouldStartTour; after the welcome intro has gone, never over an open dialog), resumes it at the step it was left on,
 * notices the checklist's «seen» steps (the playbook opened, a trade card opened — `data-onboarding-seen`), and hosts
 * «Помощь» (opened by OPEN_HELP_EVENT or the «?» key outside text fields).
 */
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/auth-context";
import { onboardingI18n } from "@/i18n/ns/onboarding";
import { helpI18n } from "@/i18n/ns/help";
import {
  isNewcomer, resumeIndex, seenFromPath, shouldStartTour, tourRole, tourSeen, tourSteps, type SeenKey, type TourStep,
} from "@/lib/onboarding/model";
import {
  OPEN_HELP_EVENT, finishTour, getOnboarding, markSeen, requestTour, saveTourStep, startOnboarding, useOnboarding,
} from "@/lib/onboarding/store";
import { Tour } from "./tour";
import type { GoShortcut } from "./help-hub";

const HelpHub = lazy(() => onboardingI18n.ready().then(() => import("./help-hub")));
const PHONE = "(max-width: 767px)";
/** After the intro has gone and the dashboard has painted. */
const START_DELAY_MS = 900;
const GUIDE = "/guide";

function isTyping(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}

const busy = () => !!document.querySelector("[data-welcome-intro], [role='dialog'][data-state='open'], [role='alertdialog']");

type Running = { steps: TourStep[]; start: number };

export function OnboardingHost({ canOpen, goKeys }: { canOpen: (href: string) => boolean; goKeys: GoShortcut[] }) {
  const { user, permissions, permissionsLoaded } = useAuth();
  const guest = !user || user.role === "guest";
  const me = guest ? null : user?.traderName ?? null;
  const [location, navigate] = useLocation();
  const ob = useOnboarding();
  const [running, setRunning] = useState<Running | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpMounted, setHelpMounted] = useState(false);
  const autoTried = useRef(false);
  const handledRequest = useRef(0);
  // The server's effective role and ladder tier (GET /api/permissions/me), the session role until it answers.
  const role = tourRole(permissions.role ?? user?.role, permissions.tier);

  useEffect(() => { startOnboarding(me, { guest }); autoTried.current = false; }, [me, guest]);

  // Start once the screen is calm: no intro, no open dialog, the dashboard painted. One pending start at a time; it
  // survives re-renders (status refreshes) and is cancelled only by a newer start or unmount.
  const pending = useRef<(() => void) | null>(null);
  const pathRef = useRef("/");
  const startWhenCalm = useCallback((resume: boolean) => {
    pending.current?.();
    let timer = 0;
    let cancelled = false;
    const attempt = (left: number) => {
      if (cancelled) return;
      if (busy() && left > 0) { timer = window.setTimeout(() => attempt(left - 1), 400); return; }
      pending.current = null;
      // Left the dashboard meanwhile: try again on the next visit to it.
      if (pathRef.current !== "/") { autoTried.current = false; return; }
      const phone = window.matchMedia?.(PHONE).matches ?? false;
      const steps = tourSteps(role, phone, canOpen);
      if (!steps.length) return;
      // The step texts are the help namespace's (lazy in EN / UZ): no flash of Russian on the first card.
      void helpI18n.ready().then(() => {
        if (!cancelled) setRunning({ steps, start: resume ? resumeIndex(getOnboarding().state, role, steps.length) : 0 });
      });
    };
    timer = window.setTimeout(() => attempt(40), START_DELAY_MS);
    pending.current = () => { cancelled = true; window.clearTimeout(timer); };
  }, [role, canOpen]);
  useEffect(() => () => pending.current?.(), []);

  // Automatic: once per user and stage (a promotion brings the next stage's tour once), resumed where it was left.
  const path = location.split("?")[0];
  pathRef.current = path;
  useEffect(() => {
    if (autoTried.current || !me || !ob.ready || !permissionsLoaded || running) return;
    if (!shouldStartTour({ mode: ob.mode, state: ob.state, path, search: window.location.search, role })) return;
    autoTried.current = true;
    startWhenCalm(true);
  }, [me, ob.ready, ob.mode, ob.state, permissionsLoaded, path, role, running, startWhenCalm]);

  // «Пройти знакомство» / «Продолжить»: to the dashboard, then the tour.
  useEffect(() => {
    if (!ob.tourRequest || ob.tourRequest === handledRequest.current) return;
    if (path !== "/") { navigate("/"); return; }
    handledRequest.current = ob.tourRequest;
    setRunning(null);
    startWhenCalm(ob.tourResume);
  }, [ob.tourRequest, ob.tourResume, path, navigate, startWhenCalm]);

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

  const resumable = !!ob.state.loopStep && ob.state.loopStep.r === role && !tourSeen(ob.state, role);
  const onRestart = useCallback((resume: boolean) => { setHelpOpen(false); requestTour({ resume }); }, []);
  const onGuide = useCallback(() => { setHelpOpen(false); navigate(GUIDE); }, [navigate]);
  const onStep = useCallback((i: number) => saveTourStep(role, i), [role]);
  const onFinish = useCallback((kind: "done" | "skipped") => { setRunning(null); finishTour(kind, role); }, [role]);

  return (
    <>
      {running && <Tour steps={running.steps} start={running.start} onStep={onStep} onFinish={onFinish} />}
      {helpMounted && (
        <Suspense fallback={null}>
          <HelpHub
            open={helpOpen}
            onOpenChange={setHelpOpen}
            goKeys={goKeys}
            resumeAt={resumable ? (ob.state.loopStep?.i ?? 0) + 1 : null}
            onRestart={onRestart}
            onGuide={canOpen(GUIDE) ? onGuide : null}
          />
        </Suspense>
      )}
    </>
  );
}
