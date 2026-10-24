/**
 * Opening intro, in English for every language: «Welcome, Trader» (sign-in screen) or «Good morning, Zakir» (first signed-in
 * load of the NY day) over slowly drifting smoke, then it fades away to the app, which renders underneath the whole
 * time (nothing waits on it). When it plays and when it never does: lib/welcome-intro.ts.
 *
 * Timing: words blur-to-sharp and fade in over 1.2 s (from 0.1 s), hold 1 s, the overlay fades out over 0.6 s from
 * 2.3 s → gone at ~2.9 s (the clock starts at the first painted frame, see holdRef). A click or any key skips it at
 * once (0.15 s fade). prefers-reduced-motion: one still frame, no text motion, a 0.3 s fade at 1.2 s. The overlay holds no focusable element and never traps focus;
 * pointer events pass through as soon as it starts leaving.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useTheme } from "@/contexts/theme-context";
import { BASE } from "@/lib/api";
import {
  dayPartNY, decideIntro, firstName, markIntroShown, type IntroEnv, type IntroKind, type KeyValueStore,
} from "@/lib/welcome-intro";
import { readLastBgMotion } from "@/lib/appearance/api";
import { personNameFor } from "@/i18n";
import { rich, slots } from "@/i18n/rich";
import { shellI18n } from "@/i18n/ns/shell";
import { latinizeName } from "@workspace/text-search";
import { startSmoke } from "@/lib/smoke";

/** Hold after the words are in (their CSS animation: 0.1 s delay + 1.2 s, index.css `.intro-text`). */
const HOLD_MS = 1000;
/** Leave by this time whatever happens. */
const MAX_MS = 6000;
const OUT_MS = 600;
const SKIP_MS = 150;
const REDUCED_HOLD_MS = 1200;
const REDUCED_OUT_MS = 300;

/** Italic serif for the name: the app's accent stack (index.css --app-font-serif, the `type-accent` utility). */
const SERIF = "var(--app-font-serif)";

/** The intro is English in every language (owner, 2026-10-24): the Latin display name, else a transliteration. */
function latinShown(stored: string | null | undefined): string {
  const v = personNameFor(stored, "en");
  return /[Ѐ-ӿ]/.test(v) ? latinizeName(v).trim() || v : v;
}

function storage(kind: "sessionStorage" | "localStorage"): KeyValueStore | null {
  try { return window[kind]; } catch { return null; }
}

function readEnv(authed: boolean): IntroEnv {
  const path = window.location.pathname;
  return {
    authed,
    path: BASE && path.startsWith(BASE) ? path.slice(BASE.length) : path,
    search: window.location.search,
    now: new Date(),
    automated: navigator.webdriver === true,
    printing: typeof window.matchMedia === "function" && window.matchMedia("print").matches,
    session: storage("sessionStorage"),
    local: storage("localStorage"),
  };
}

/** Still frame when motion is off: «Движение фона» from this browser's last look (auto = the system setting). */
function prefersReducedMotion(): boolean {
  const pref = readLastBgMotion();
  if (pref !== "auto") return pref === "off";
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function WelcomeIntro() {
  const { isAuthenticated, user } = useAuth();
  const { theme } = useTheme();
  // Decided before the first paint, so a signed-in page never flashes before the overlay.
  const [kind, setKind] = useState<IntroKind | null>(() => decideIntro(readEnv(isAuthenticated)));
  const close = useCallback(() => setKind(null), []);

  // Signed in later in this tab (the sign-in screen played no intro): the day's greeting may still be due.
  const [wasAuthed, setWasAuthed] = useState(isAuthenticated);
  if (wasAuthed !== isAuthenticated) {
    setWasAuthed(isAuthenticated);
    if (isAuthenticated) setKind(decideIntro(readEnv(true)));
  }

  useEffect(() => {
    if (kind) markIntroShown(kind, { now: new Date(), session: storage("sessionStorage"), local: storage("localStorage") });
  }, [kind]);

  if (!kind) return null;
  const name = kind === "greeting" && user?.role !== "guest" ? firstName(latinShown(user?.traderName)) : "";
  return <IntroOverlay kind={kind} name={name} light={theme === "light"} onDone={close} />;
}

function IntroOverlay({ kind, name, light, onDone }: { kind: IntroKind; name: string; light: boolean; onDone: () => void }) {
  const { t } = shellI18n.useT();
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const holdRef = useRef<() => void>(() => {});
  const [reduced] = useState(prefersReducedMotion);

  useEffect(() => {
    const canvas = canvasRef.current;
    return canvas ? startSmoke(canvas, { light, still: reduced }) : undefined;
  }, [light, reduced]);

  useEffect(() => {
    const el = rootRef.current;
    let leaving = false;
    let anim: Animation | null = null;
    let hold = 0;
    let safety = 0;
    let fallback = 0;
    const finish = () => onDone();
    const leave = (ms: number) => {
      if (leaving || !el) return;
      leaving = true;
      window.clearTimeout(hold);
      window.clearTimeout(safety);
      el.style.pointerEvents = "none";
      // Web Animations, not a CSS transition: the global reduced-motion rule zeroes CSS transitions,
      // and that mode still gets its short fade.
      if (typeof el.animate === "function") {
        anim = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing: "ease-in-out", fill: "forwards" });
        anim.onfinish = finish;
      }
      // A background tab may never deliver `finish`.
      fallback = window.setTimeout(finish, ms + 120);
    };
    // The hold starts when the words have actually finished appearing (animationend), not at mount: a first load
    // that keeps the main thread busy for a second would otherwise eat the whole intro before it is ever painted.
    holdRef.current = () => {
      if (hold || leaving) return;
      hold = window.setTimeout(() => leave(reduced ? REDUCED_OUT_MS : OUT_MS), reduced ? REDUCED_HOLD_MS : HOLD_MS);
    };
    // Reduced motion: the words have no animation (index.css), the hold starts now.
    if (reduced) holdRef.current();
    // Safety net when animationend never arrives (animations disabled by the browser).
    safety = window.setTimeout(() => leave(OUT_MS), MAX_MS);
    // Skip: any key anywhere (focus stays wherever it is, e.g. the name field) or a click on the overlay.
    const skip = () => leave(SKIP_MS);
    window.addEventListener("keydown", skip);
    el?.addEventListener("click", skip);
    return () => {
      window.clearTimeout(hold);
      window.clearTimeout(safety);
      window.clearTimeout(fallback);
      window.removeEventListener("keydown", skip);
      el?.removeEventListener("click", skip);
      if (anim) anim.onfinish = null;
    };
  }, [reduced, onDone]);

  const who = name || t("intro.trader");
  const text = kind === "welcome"
    ? t("intro.welcome", slots("name"))
    : t(`intro.greeting.${dayPartNY(new Date())}`, slots("name"));

  return (
    <div
      ref={rootRef}
      data-welcome-intro={kind}
      className="fixed inset-0 z-tooltip flex items-center justify-center overflow-hidden select-none print:hidden"
      style={{ background: light ? "#f5f5f4" : "#000", color: light ? "#111113" : "#f5f5f5" }}
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="intro-smoke pointer-events-none absolute"
        style={{ inset: "-8%", width: "116%", height: "116%", filter: "blur(10px)" }}
      />
      <p
        onAnimationEnd={(e) => { if (e.animationName === "intro-text-in") holdRef.current(); }}
        className="intro-text relative px-6 text-center text-[clamp(1.875rem,5.2vw,3.5rem)] font-medium leading-tight tracking-tight [overflow-wrap:anywhere]"
        style={{ textShadow: light ? "0 0 32px rgba(255,255,255,0.75)" : "0 0 32px rgba(0,0,0,0.55)" }}
      >
        {rich(text, {
          name: (
            <em className="font-normal italic" style={{ fontFamily: SERIF, fontSize: "1.08em", letterSpacing: "0" }}>
              {who}
            </em>
          ),
        })}
      </p>
    </div>
  );
}
