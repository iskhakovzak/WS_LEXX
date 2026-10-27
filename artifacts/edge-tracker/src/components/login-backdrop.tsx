/**
 * The sign-in page's living background, the lock screen's twin: the last «Вид» scene saved on this browser (a «WS
 * originals» photo or the smoke; an own image stays private to its account, so it falls back to the smoke), drifting
 * slowly and leaning in 3D under the pointer (hooks/use-ambient-drift writes --px / --py on the page root; the layers
 * here read them). A soft vignette keeps the glass card readable.
 * Lives at the top of components/ (like lock-screen.tsx) because it joins appearance (scenes) and auth (the smoke).
 *
 * `useSignInMotion()`: the account is not known yet, so motion follows this browser's last look — its «Движение и
 * анимации» is put on <html data-motion> (when the boot script did not already replay it) so CSS, framer-motion and
 * lib/motion all agree on this screen, then read back through lib/motion.
 */
import * as React from "react";
import { LoginSmoke } from "@/components/auth/login-smoke";
import { useTheme } from "@/contexts/theme-context";
import { readLastBg } from "@/lib/appearance/api";
import { isLightTheme, type ThemeId } from "@/lib/appearance/model";
import { isScene, type SceneId } from "@/lib/appearance/scenes";
import { useReducedMotion } from "@/lib/motion";

const SceneBackdrop = React.lazy(() => import("@/components/appearance/scenes/scene-backdrop"));

const LEAN = "translate3d(calc(var(--px, 0) * -26px), calc(var(--py, 0) * -16px), 0) perspective(1200px) rotateY(calc(var(--px, 0) * 2.75deg)) rotateX(calc(var(--py, 0) * -2.75deg)) scale(1.08)";

export function useSignInMotion(): boolean {
  React.useLayoutEffect(() => {
    const root = document.documentElement;
    const pref = readLastBg().motion;
    if (pref === "off" && !root.hasAttribute("data-motion")) root.setAttribute("data-motion", "off");
  }, []);
  return !useReducedMotion();
}

export function LoginBackdrop({ sceneRef }: { sceneRef: React.RefObject<HTMLDivElement | null> }) {
  const { theme } = useTheme();
  const [{ kind, motion }] = React.useState(readLastBg);
  const scene: SceneId | null = isScene(kind) && kind !== "smoke" ? kind : null;
  const light = isLightTheme(theme);
  const smoke = <div className="absolute inset-0" style={{ transform: LEAN }}><LoginSmoke /></div>;
  return (
    <div ref={sceneRef} aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden">
      {scene ? (
        <React.Suspense fallback={smoke}>
          <div className="absolute inset-0" style={{ "--scene-vis": light ? "0.8" : "0.9" } as React.CSSProperties}>
            <SceneBackdrop scene={scene} theme={theme as ThemeId} motion={motion} ambient />
          </div>
        </React.Suspense>
      ) : smoke}
      <div
        className="absolute inset-0"
        style={{ background: light ? "radial-gradient(120% 90% at 50% 45%, transparent 35%, hsl(var(--background) / 0.55) 100%)" : "radial-gradient(120% 90% at 50% 45%, rgba(0,0,0,0.05) 30%, rgba(0,0,0,0.6) 100%)" }}
      />
    </div>
  );
}
